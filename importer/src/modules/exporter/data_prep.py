from functools import cached_property
import logging
import os
import asyncio
from collections.abc import Mapping
from typing import Coroutine, List, cast
import uuid


from pydantic import BaseModel

import asyncpg

from lib.async_db_utils import ConnType, PoolConn, PoolType, execute_log

from modules.params.export_schema import (
    SCHEMA_EXPORT,
    SCHEMA_PREFIX,
    TABLE_COMMON_FIELDS,
)
from modules.params.flask_root_params import GeometryExportParams

# from scripts.export_module.settlement.cte import get_catchments_subquery

# this tells python that asyncpg.Record is a subclass of Mapping,
# meaning the isinstance check within Pydantic will pass
# https://github.com/pydantic/pydantic/issues/9406
Mapping.register(asyncpg.Record)

log = logging.getLogger(__name__)


class Boundary(BaseModel):
    name: str
    global_id: uuid.UUID
    level: int

    partition_id: int

    @cached_property
    def partition_id_str(self) -> str:
        return str(self.partition_id).zfill(5)

    def partition_name(
        self, prefix: SCHEMA_PREFIX, with_schema: bool, is_latest: bool
    ) -> str:
        """
        Each boundary has tables like
        health_facility_point_01234
        and views like
        health_facility_point_01234_latest
        in the respective schemas.

        For the export, we create surrounding data views in the export schema which group the above together
        """
        table_name = f"{prefix.value}_{self.partition_id_str}" + (
            "_latest" if is_latest else ""
        )

        # shared
        if prefix == SCHEMA_PREFIX.EXPORT_B2 or prefix == SCHEMA_PREFIX.EXPORT_B1:
            table_name = f"{prefix.value}" + ("_latest" if is_latest else "")

        if with_schema:
            if SCHEMA_EXPORT in prefix.value:
                return f"{SCHEMA_EXPORT}.{table_name}"
            else:
                return f"partitions_{prefix}.{table_name}"
        else:
            return table_name


async def data_prep_main(params: GeometryExportParams) -> List[Boundary]:
    """
    Main entry point.  Runs in asyncpg the code in a single transaction
    to create the export tables/views using the partition id of the level 3 (operating level)
    boundaries
    """

    async with params.gmt_db.get_asyncpg_pool() as pool:
        assert pool

        # for partition_schema in ["partitions_settlement_name", "partitions_settlement_part",
        #                          "partitions_health_facility_point", "partitions_ri_catchment_item"]:
        #     table_name = partition_schema.replace("partitions_", "") + "_" + str(boundary.partition_id).zfill(5)

        boundaries = await fetch_boundary_ids(pool, params.boundary_guid_list)

        log.info(f"Fetched {len(boundaries)} partition ids")

        await create_export_structure(pool, boundaries, True)

        await import_data(pool, boundaries)

        return boundaries


async def fetch_boundary_ids(
    pool: PoolType, boundary_guids: List[uuid.UUID]
) -> List[Boundary]:
    BOUNDARY_OPERATING_LEVEL = int(os.environ["OPERATIONAL_BOUNDARY_LEVEL"])

    ret: List[Boundary] = []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
                                SELECT bid.id as partition_id, b.name, b.global_id, b.level 
                                FROM partitions.boundary_id bid
                                INNER JOIN boundary.polygon_latest b on b.global_id = bid.global_id
                                --https://github.com/MagicStack/asyncpg/issues/94
                                WHERE b.global_id = any($1::uuid[]) 
                                """,
            boundary_guids,
        )

        for r in rows:
            b = Boundary.model_validate(r)

            if b.level != BOUNDARY_OPERATING_LEVEL:
                log.warning(
                    f"Ignoring boundary {b.name} because not in operating level {BOUNDARY_OPERATING_LEVEL}.  Was={b.level}"
                )
                continue

            ret.append(b)
    #

    return ret


async def create_export_structure(
    pool: PoolType, boundaries: List[Boundary], clean: bool
) -> None:
    async with pool.acquire() as conn:
        # todo either a transaction or not doing this drop for || support
        if clean:
            await conn.execute(f"DROP SCHEMA IF EXISTS {SCHEMA_EXPORT} CASCADE")

        await conn.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA_EXPORT}")

        await conn.execute(f"""
    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_COMMON_FIELDS}
    (
        b1_guid uuid NOT NULL,
        b2_guid uuid NOT NULL,
        b3_guid uuid NOT NULL,
        state_name text NOT NULL,
        lga_name text NOT NULL,
        ward_name text NOT NULL
    );
                           """)

    await create_catchment_sp(pool)

    task_list: List[Coroutine] = []  # type: ignore
    for b in boundaries:
        task_list.append(create_helper_views(pool, b, False))
        task_list.append(create_helper_views(pool, b, True))
        task_list.append(create_settlement_tables_and_views(pool, b))
        task_list.append(create_hf_views(pool, b))
        task_list.append(create_catchment_table(pool, b))
        task_list.append(create_boundary_tables_and_views(pool, b))

    group = asyncio.gather(*task_list)

    await group


async def create_settlement_tables_and_views(
    pool: PoolType, boundary: Boundary
) -> None:
    sql = f"""
        
    CREATE TABLE IF NOT EXISTS {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SN, True, False)}
    (
        LIKE {SCHEMA_EXPORT}.{TABLE_COMMON_FIELDS} INCLUDING ALL,
        id SERIAL PRIMARY KEY,
        global_id_settlement_name uuid NOT NULL,
        global_id_settlement_extent uuid NOT NULL,
        
        version_id int NOT NULL,
        name text NOT NULL,
        geom GEOMETRY(Point, 4326) NOT NULL,
        
        set_with_gps bool NULL,
        comments text NOT NULL,
        
        estimated_pop DOUBLE PRECISION,
        computed_pop DOUBLE PRECISION NOT NULL,
        
        fixed_catchment_perc DOUBLE PRECISION NOT NULL,
        outreach_catchment_perc DOUBLE PRECISION NOT NULL,
        uncovered_catchment_perc DOUBLE PRECISION NOT NULL,
        
        strategy text NOT NULL,
        
        hard_to_reach bool NOT NULL,
        nomadic bool NOT NULL,
        riverine bool NOT NULL,
        uninhabited bool NOT NULL,
        
        uninhabited_reason text NOT NULL,
        
        aka text NOT NULL,
        
        CONSTRAINT sn_global_id_settlement_name_{boundary.partition_id} UNIQUE(global_id_settlement_name),
        CONSTRAINT sn_global_id_settlement_extent_{boundary.partition_id} UNIQUE(global_id_settlement_extent)
    );
    
    CREATE OR REPLACE VIEW  {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SN_MOBILE, True, False)} AS 
    SELECT * FROM 
    {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SN, True, False)} sn
    WHERE sn.uncovered_catchment_perc > 0.5;
    
    CREATE TABLE IF NOT EXISTS {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SP, True, False)}
    (
        LIKE {SCHEMA_EXPORT}.{TABLE_COMMON_FIELDS} INCLUDING ALL,
        id SERIAL PRIMARY KEY,
        global_id_settlement_extent uuid NOT NULL,
        global_id_settlement_name uuid NOT NULL,
        
        version_id int NOT NULL,        
        geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
                
        CONSTRAINT sp_global_id_settlement_name_{boundary.partition_id} UNIQUE(global_id_settlement_name),
        CONSTRAINT sp_global_id_settlement_extent_{boundary.partition_id} UNIQUE(global_id_settlement_extent)
    );
    
    """

    async with pool.acquire() as conn:
        await conn.execute(sql)


async def create_catchment_table(pool: PoolType, boundary: Boundary) -> None:
    """
    Creates the catchment polygons in the database
    """
    async with pool.acquire() as conn:
        sql = f"""
    --temp
    DROP TABLE IF EXISTS
    {boundary.partition_name(SCHEMA_PREFIX.EXPORT_OUT_CATCH, True, False)};
    
    CREATE TABLE IF NOT EXISTS {boundary.partition_name(SCHEMA_PREFIX.EXPORT_OUT_CATCH, True, False)} (
        LIKE {SCHEMA_EXPORT}.{TABLE_COMMON_FIELDS} INCLUDING ALL,
        
        id SERIAL PRIMARY KEY,
        geom GEOMETRY(Polygon, 4326) NOT NULL,
        
        global_id_fixed_post uuid NOT NULL,
        global_id_outreach uuid NOT NULL,
        
        fixed_post_name text NOT NULL,
        outreach_name text NOT NULL,
                
        gis_pop double precision NOT NULL,
        est_gis_pop double precision NOT NULL,
        est_pop double precision NOT NULL,
        
        UNIQUE(global_id_outreach)
    );
    
    DROP TABLE IF EXISTS
    {boundary.partition_name(SCHEMA_PREFIX.EXPORT_FP_CATCH, True, False)};
    
    CREATE TABLE IF NOT EXISTS {boundary.partition_name(SCHEMA_PREFIX.EXPORT_FP_CATCH, True, False)} (
        
        LIKE {SCHEMA_EXPORT}.{TABLE_COMMON_FIELDS} INCLUDING ALL,
        
        id SERIAL PRIMARY KEY,
        geom GEOMETRY(Polygon, 4326) NOT NULL,
        
        global_id_fixed_post uuid NOT NULL,
        
        fixed_post_name text NOT NULL,
        
        gis_pop double precision NOT NULL,
        est_gis_pop double precision NOT NULL,
        est_pop double precision NOT NULL,
        
        UNIQUE(global_id_fixed_post)
    );

    
    """

        await conn.execute(sql)


async def create_catchment_sp(pool: PoolConn) -> None:
    # Create a stored procedure we'll need
    # async with pool.acquire() as conn:
    sql = """
--make raster functions available        
--create extension IF NOT EXISTS postgis_raster;

--converts a bit field into a 2d double array, which we need to set raster values        
CREATE OR REPLACE FUNCTION convert_bit_varying_to_double_precision(bit_data bit varying, raster_width int, raster_height int)
RETURNS double precision[][]
AS $$
DECLARE
    i int;
    j int;
    row_idx int;
    col_idx int;
    result double precision[][];
BEGIN
    -- Initialize the result array with dimensions specified by raster_width and raster_height
    result := array_fill(0.0::double precision, ARRAY[raster_height, raster_width]);

    -- Loop through each byte in the bytea data
    FOR i IN 0 .. length(bit_data) - 1 LOOP
        col_idx := i % raster_width; -- Column index (i mod raster_width)
        row_idx := i / raster_width; -- Row index (i / raster_width)

        --RAISE LOG 'Processed bit at position (%, %)', row_idx, col_idx;
        -- Loop through each bit in the current byte

        --postgresql array 1 based
        result[1+row_idx][1+col_idx] :=
                CASE WHEN get_bit(bit_data, i) > 0 THEN 1.0 ELSE 0.0 END;

    END LOOP;

    RETURN result;
END;
$$
LANGUAGE plpgsql;
"""

    await execute_log(pool, sql)


async def create_hf_views(pool: PoolType, boundary: Boundary) -> None:
    col_list = [
        "version_id",
        "boundary_polygon",
        "name",
        "type",
        "set_with_gps",
        "comments",
    ]

    col_list_str = ", ".join([f"h.{c}" for c in col_list])

    sql = f"""

    --DROP VIEW IF EXISTS {boundary.partition_name(SCHEMA_PREFIX.EXPORT_FIXED_POST, True, False)};

    CREATE OR REPLACE VIEW {boundary.partition_name(SCHEMA_PREFIX.EXPORT_FIXED_POST, True, False)}
    AS 
    SELECT 
        b1.global_id as global_id_state,
        b2.global_id as global_id_lga,
        b3.global_id as global_id_ward,    
        b1.name as state_name,
        b2.name as lga_name,
        b3.name as ward_name,
        h.global_id as global_id_fixed_post, 
        h.geom, 
        array_to_string(h.synonyms, '|') AS aka,
        array_to_string(h.staff_names, '|') AS staff_names,
        array_to_string(
            array(
                SELECT
                    CASE
                    WHEN sp = 'Other' 
                    --json arrays are 0 based
                    THEN COALESCE(((h.properties->'staff_positions_other') ->> i::int - 1)::text, '')
                    ELSE sp
                    END
                FROM unnest(h.staff_positions::text[]) 
                WITH ORDINALITY AS s(sp, i)                
            ), 
        '|') AS staff_positions,
        array_to_string(staff_types, '|') AS staff_types,
        h."mp_status",
        h."level_of_care",
        h."primary_type",
        h."private",
        h."frequency",
        health_facility.describe_operating_hours(h.operating_hours_start, h.operating_hours_stop) as operating_hours,
        {col_list_str} 
    FROM {boundary.partition_name(SCHEMA_PREFIX.HF, True, True)} h
        INNER JOIN boundary.polygon_latest b3 ON b3.global_id = h.boundary_polygon
        INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
        INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon        
    WHERE type = 'fixed_post' ;
        
    CREATE OR REPLACE VIEW {boundary.partition_name(SCHEMA_PREFIX.EXPORT_OUTREACH, True, False)}
    AS 
    SELECT 
        b1.global_id as global_id_state,
        b2.global_id as global_id_lga,
        b3.global_id as global_id_ward,    
        b1.name as state_name,
        b2.name as lga_name,
        b3.name as ward_name,
        h.global_id as global_id_outreach, 
        h.geom,
        --Outreaches don't have synonyms nor staff
        --array_to_string(h.synonyms, ', ') AS aka,
        --array_to_string(h.staff_names, ', ') AS staff_names,
        h.parent as global_id_fixed_post,
        parent_fp.name as "name_fixed_post",
        h."frequency",
        health_facility.describe_operating_hours(h.operating_hours_start, h.operating_hours_stop) as operating_hours,
        {col_list_str} 
    FROM {boundary.partition_name(SCHEMA_PREFIX.HF, True, True)} h
        INNER JOIN boundary.polygon_latest b3 ON b3.global_id = h.boundary_polygon
        INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
        INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon        
    INNER JOIN {boundary.partition_name(SCHEMA_PREFIX.HF, True, True)} parent_fp 
        ON parent_fp.global_id = h.parent
    WHERE h.type = 'outreach' ;
        """

    async with pool.acquire() as p_conn:
        conn = cast(ConnType, p_conn)
        await execute_log(conn, sql)


async def create_boundary_tables_and_views(pool: PoolType, boundary: Boundary) -> None:
    # use tables to have a uniqueness constraint to just have 1 state
    common_boundary_table = "boundary_common"

    table_sql = f"""
    DROP TABLE IF EXISTS {SCHEMA_EXPORT}.{common_boundary_table};
    
    CREATE TABLE {SCHEMA_EXPORT}.{common_boundary_table} (
        
        geom GEOMETRY(MultiPolygon, 4326) NOT NULL,        
        computed_pop DOUBLE PRECISION NOT NULL,
        version_id int NOT NULL        
    );
    
    
    --these are shared so may already exists.  Name will not have bid in it
    CREATE TABLE IF NOT EXISTS {boundary.partition_name(SCHEMA_PREFIX.EXPORT_B1, True, False)} (
        LIKE {SCHEMA_EXPORT}.{common_boundary_table} INCLUDING ALL,
        global_id_state uuid NOT NULL UNIQUE,
        state_name text NOT NULL        
    );
    
    CREATE TABLE IF NOT EXISTS {boundary.partition_name(SCHEMA_PREFIX.EXPORT_B2, True, False)} (
        LIKE {SCHEMA_EXPORT}.{common_boundary_table} INCLUDING ALL,
        global_id_state uuid NOT NULL,
        global_id_lga uuid NOT NULL UNIQUE,
        state_name text NOT NULL,
        lga_name text NOT NULL
    );
    
    --No need to keep this around
    DROP TABLE IF EXISTS {SCHEMA_EXPORT}.{common_boundary_table};
    
    """

    b_cols = ["b.computed_pop", "b.version_id"]

    b_col_str = ", ".join(b_cols)

    view_sql = f"""

    CREATE OR REPLACE VIEW {boundary.partition_name(SCHEMA_PREFIX.EXPORT_B3_EDITED, True, False)}
    AS SELECT  
    b1.global_id as global_id_state,
    b2.global_id as global_id_lga,
    b.global_id as global_id_ward,    
    be.geom,
    b1.name as state_name,
    b2.name as lga_name,
    b.name as ward_name,
    {b_col_str} 
    from boundary.polygon_edited_latest be
inner join boundary.polygon_latest b on b.global_id = be.boundary_polygon
left join boundary.polygon_latest b2 on b2.global_id = b.boundary_polygon
left join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
--approved edits are stored where global_id of edit == the operating level
where be.global_id = b.global_id
and b.global_id = '{boundary.global_id}'
    ;
    
    CREATE OR REPLACE VIEW {boundary.partition_name(SCHEMA_PREFIX.EXPORT_B3, True, False)}
    AS SELECT 
    b1.global_id as global_id_state,
    b2.global_id as global_id_lga,
    b.global_id as global_id_ward,    
     
    b.geom,
    
    b1.name as state_name,
    b2.name as lga_name,
    b.name as ward_name,
    
    {b_col_str} 
    from boundary.polygon_latest b 
inner join boundary.polygon_latest b2 on b2.global_id = b.boundary_polygon
inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
where b.global_id = '{boundary.global_id}';
        
   
        """

    async with pool.acquire() as raw_conn:
        conn = cast(ConnType, raw_conn)
        await conn.execute(table_sql)
        await conn.execute(view_sql)


def get_catchments_subquery(boundary: Boundary) -> str:
    """
    For each sn name, sum of the pop_perc of generate items
    per hf type (outreach/fixed_post)

    use generated only b/c include will create generated entries
    only primary, inhabited settlements considered
    """
    return f"""
    catchments AS (
        SELECT sn.global_id, hf.type, SUM(ci.population_perc) AS pop_perc FROM 
        {boundary.partition_name(SCHEMA_PREFIX.SN, True, True)} sn
        INNER JOIN {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_CI, True, True)} ci ON 
            ci.settlement_part = sn.settlement_part AND 
            ci.type = 'generated'
        INNER JOIN {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_HF, True, True)} hf ON
            ci.health_facility_point = hf.global_id
        WHERE sn.is_primary AND NOT COALESCE(sn.uninhabited, False)
        GROUP BY sn.global_id, hf.type 
    )
    """


async def import_data(conn: PoolConn, boundaries: List[Boundary]) -> None:
    task_list: List[Coroutine[None, None, None]] = []
    for b in boundaries:
        task_list.append(insert_settlements(conn, b))
        task_list.append(insert_catchments(conn, b))
        task_list.append(insert_boundaries(conn, b))

    group = asyncio.gather(*task_list)

    await group


async def insert_settlements(conn: PoolConn, boundary: Boundary) -> None:
    """ """

    name_sql = f"""
    
    WITH 
        {get_catchments_subquery(boundary)}
    INSERT INTO {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SN, True, False)} (

        global_id_settlement_name, 
        global_id_settlement_extent,
        version_id,
        
        name, geom, 
        set_with_gps, comments,

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,
        
        aka,
        
        hard_to_reach,
        nomadic,
        riverine,
        uninhabited,        
        uninhabited_reason,
        
        estimated_pop, computed_pop,
        
        fixed_catchment_perc, 
        outreach_catchment_perc,
        uncovered_catchment_perc,
        
        strategy
    )    
    SELECT 
        sn.global_id,
        sp.global_id,
        sn.version_id,
        
        sn.name, 
        sn.geom, 
        
        sn.set_with_gps,
        sn.comments,

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name,
        
        array_to_string(sn.synonyms, ', ') AS aka,
        
        ('Hard To Reach' = ANY(sn.problematic)) as hard_to_reach,
        ('Nomadic/Fulani' = ANY(sn.problematic)) as nomadic,
        ('Riverine' = ANY(sn.problematic)) as riverine,
        COALESCE(sn.uninhabited, False),
        
        CASE 
            WHEN NOT COALESCE(sn.uninhabited, False) THEN 'N/A'
            WHEN sn.uninhabited_reason = 'Other' THEN 
                'Other - ' || COALESCE(sn.properties->>'uninhabited_other_detail', 'Unknown')
            ELSE
                COALESCE(sn.uninhabited_reason::text, 'Unknown')
        END as uninhabited_reason, 
        
        sn.estimated_pop,
        round( cast(sp.computed_pop as numeric), 2) as computed_pop,
        
        round( CAST(COALESCE(fp_c.pop_perc, 0) as numeric), 2) AS fixed_catchment_perc,
        round( CAST(COALESCE(o_c.pop_perc, 0) as numeric), 2) AS outreach_catchment_perc,
        round( CAST( 100 - COALESCE(fp_c.pop_perc, 0) - COALESCE(o_c.pop_perc, 0) as numeric), 2) AS uncovered_catchment_perc,
        
        
        CASE 
            WHEN COALESCE(fp_c.pop_perc, 0) >= 99.5 THEN 'fixed post' 
            WHEN COALESCE(o_c.pop_perc, 0) >= 99.5 THEN 'outreach' 
            WHEN COALESCE(fp_c.pop_perc, 0) < 0.5 AND COALESCE(o_c.pop_perc, 0) < 0.5 THEN 'mobile' 
            WHEN COALESCE(fp_c.pop_perc, 0) + COALESCE(o_c.pop_perc, 0) >= 99.5 THEN 'fixed post and outreach' 
            WHEN COALESCE(o_c.pop_perc, 0) < 0.5 THEN 'fixed post and mobile' 
            WHEN COALESCE(fp_c.pop_perc, 0) < 0.5 THEN 'outreach and mobile' 
            ELSE 'fixed post, outreach and mobile' 
        END as strategy
    
    FROM {boundary.partition_name(SCHEMA_PREFIX.SN, True, True)} sn 
    INNER JOIN {boundary.partition_name(SCHEMA_PREFIX.SP, True, True)} sp 
        ON sn.settlement_part = sp.global_id
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = sn.boundary_polygon 
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    LEFT JOIN catchments o_c ON o_c.global_id = sn.global_id AND o_c.type = 'outreach'
    LEFT JOIN catchments fp_c ON fp_c.global_id = sn.global_id AND fp_c.type = 'fixed_post'    
    WHERE sn.is_primary
        """

    part_sql = f"""INSERT INTO {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SP, True, False)} (

        global_id_settlement_name, 
        global_id_settlement_extent,
        version_id,
        
        geom, 

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name
    )    
    SELECT 
        sn.global_id,
        sp.global_id,
        sn.version_id,
        
        sp.geom, 

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name
    
    FROM {boundary.partition_name(SCHEMA_PREFIX.SN, True, True)} sn 
    INNER JOIN {boundary.partition_name(SCHEMA_PREFIX.SP, True, True)} sp 
        ON sn.settlement_part = sp.global_id
    INNER JOIN boundary.polygon_latest b3 
        ON b3.global_id = sn.boundary_polygon 
    INNER JOIN boundary.polygon_latest b2 
        ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 
        ON b1.global_id = b2.boundary_polygon
    WHERE sn.is_primary"""

    await conn.execute(name_sql)

    await conn.execute(part_sql)


def get_hf_catchments_subsquery(boundary: Boundary) -> str:
    # Generated are owned by sp
    return f"""
    catchments AS (
        SELECT 
            hf.global_id, 
            SUM(sp.computed_pop * ci.population_perc / 100) AS gis_pop,
            SUM(COALESCE(sn.estimated_pop,0) * ci.population_perc / 100) AS est_pop,
            SUM(COALESCE(sn.estimated_pop, sp.computed_pop) * ci.population_perc / 100) AS est_gis_pop 
        FROM {boundary.partition_name(SCHEMA_PREFIX.HF, True, True)} hf
        --need the view with adj. wards because can influence sp outside boundary
        INNER JOIN {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_CI, True, True)} ci ON 
            ci.health_facility_point = hf.global_id AND
            ci.type = 'generated'
        INNER JOIN {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_SP, True, True)} sp ON
            ci.settlement_part = sp.global_id
        INNER JOIN {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_SN, True, True)} sn ON
            sn.settlement_part = sp.global_id
        WHERE sn.is_primary AND NOT COALESCE(sn.uninhabited, False)
        GROUP BY hf.global_id 
    )
    """


async def insert_catchments(pool: PoolConn, boundary: Boundary) -> None:
    with_sql = f"""
    with hf_raster_fields as (
        select
            hf.catchment_raster,
            hf.raster_width,
            hf.raster_height,
            hf.origin_x,
            hf.origin_y,
            hf.global_id
         from {boundary.partition_name(SCHEMA_PREFIX.HF, True, True)}  hf
    ), hf_raster AS (
        SELECT 
            r.global_id,
            sq.raster_with_values 
        FROM hf_raster_fields r,
        LATERAL (
            SELECT ST_SetValues(
                ST_AddBand(
                    ST_MakeEmptyRaster(
                        r.raster_width,
                        r.raster_height,
                        r.origin_x::float8,
                        r.origin_y::float8,
                        --worldpop pixel size
                        0.000833333330000::float8, 
                        -0.000833333330000::float8, 
                        0::float8, 0::float8, 
                        4326),
                    1, --band
                    '1BB'::text,  -- Pixel type: 1-bit Boolean
                    0, --initial value
                    0 --no data value
                ),
                1, --band,
                1, 1,  -- X, Y (1-based index)
                convert_bit_varying_to_double_precision(r.catchment_raster, r.raster_width, r.raster_height)
            ) as raster_with_values
        ) sq
    ), hulls AS (
        SELECT
            r.global_id,
            ST_ConvexHull(ST_Collect(dp.geom)) AS geom
            --ST_Multi(ST_Collect(dp.geom)) AS geom
        FROM hf_raster r
            CROSS JOIN LATERAL ST_DumpAsPolygons(r.raster_with_values, 1, True) as dp 
        GROUP BY r.global_id
    ), {get_hf_catchments_subsquery(boundary)}
    """

    select_fp_sql = f"""
    SELECT 
        hulls.geom,
        
        hf.global_id AS global_id_fixed_post,        
        hf.name,
        
        COALESCE(c.gis_pop, 0),
        COALESCE(c.est_gis_pop, 0),
        COALESCE(c.est_pop, 0),

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name
        
    from {boundary.partition_name(SCHEMA_PREFIX.HF, True, True)} hf
    INNER JOIN hulls ON hulls.global_id = hf.global_id
    
    LEFT JOIN catchments c ON c.global_id = hf.global_id
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = hf.boundary_polygon
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    WHERE hf.type = 'fixed_post'
    """

    select_out_sql = f"""
    SELECT 
        hulls.geom,
        parent.global_id AS global_id_fixed_post,
         hf.global_id AS global_id_outreach,
        
        parent.name,
        hf.name,
        
        COALESCE(c.gis_pop, 0),
        COALESCE(c.est_gis_pop, 0),
        COALESCE(c.est_pop, 0),

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name
        
    from {boundary.partition_name(SCHEMA_PREFIX.HF, True, True)} hf
    INNER JOIN hulls ON hulls.global_id = hf.global_id
    INNER JOIN {boundary.partition_name(SCHEMA_PREFIX.HF, True, True)} parent ON hf.parent = parent.global_id    
    LEFT JOIN catchments c ON c.global_id = hf.global_id
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = hf.boundary_polygon
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    WHERE hf.type = 'outreach'
    """

    out_sql = f"""
    {with_sql}
    INSERT INTO  {boundary.partition_name(SCHEMA_PREFIX.EXPORT_OUT_CATCH, True, False)} 
    (
        geom,
        
        global_id_fixed_post,
        global_id_outreach,
        
        fixed_post_name,
        outreach_name,
        
        gis_pop,
        est_gis_pop,
        est_pop,

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name
    )
    {select_out_sql}
    """

    fp_sql = f"""
    {with_sql}
    INSERT INTO  {boundary.partition_name(SCHEMA_PREFIX.EXPORT_FP_CATCH, True, False)} 
    (
        geom,
        
        global_id_fixed_post,
        
        fixed_post_name,
        gis_pop,
        est_gis_pop,
        est_pop,

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name
    )
    {select_fp_sql}
    """

    await pool.execute(fp_sql)
    await pool.execute(out_sql)


async def insert_boundaries(pool: PoolConn, boundary: Boundary) -> None:
    """
    Boundaries
    """

    state_sql = f"""
    INSERT INTO {boundary.partition_name(SCHEMA_PREFIX.EXPORT_B1, True, False)}
    (
        geom, computed_pop, version_id,
        global_id_state, state_name
    ) SELECT 
        b1.geom, b1.computed_pop, b1.version_id,
        b1.global_id, b1.name
        
    from boundary.polygon_latest b3 
        inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
        inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
where b3.global_id = '{boundary.global_id}'
    ON CONFLICT (global_id_state) DO NOTHING;
    """

    lga_sql = f"""
    INSERT INTO {boundary.partition_name(SCHEMA_PREFIX.EXPORT_B2, True, False)}
    (
        geom, computed_pop, version_id,
        global_id_state, state_name, 
        global_id_lga, lga_name
    ) SELECT 
        b2.geom, b2.computed_pop, b2.version_id,
        b1.global_id, b1.name,
        b2.global_id, b2.name
    from boundary.polygon_latest b3 
        inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
        inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
where b3.global_id = '{boundary.global_id}'
    ON CONFLICT (global_id_lga) DO NOTHING;
    """

    await pool.execute(state_sql)
    await pool.execute(lga_sql)


async def create_helper_views(
    pool: PoolConn, boundary: Boundary, only_latest: bool
) -> None:
    """
    Creates views partitions.(sn,hf,ci,sp)_view[_latest]

    These are the views that include the surrounding boundaries

    """

    # as 2km is the walking distance, any other boundary at same level within this distance gets included
    extent_padding_meters = 3000

    if only_latest:
        only_latest_sql = "|| '_latest)'"

    else:
        only_latest_sql = "|| ')'"

    sql = f"""

do $$
    declare
    myrow record;
begin
        drop view if exists {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_SP, True, only_latest)} ;
        drop view if exists {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_HF, True, only_latest)} ;
        drop view if exists {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_SN, True, only_latest)} ;
        drop view if exists {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_CI, True, only_latest)} ;
for myrow in
SELECT
    'create view {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_SP, True, only_latest)} as ' || string_agg(sp, ' union all ') as spv,
    'create view {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_SN, True, only_latest)} as ' || string_agg(sn, ' union all ') as snv,
    'create view {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_HF, True, only_latest)} as ' || string_agg(hf, ' union all ') as hfv,
    'create view {boundary.partition_name(SCHEMA_PREFIX.EXPORT_SURROUNDING_CI, True, only_latest)} as ' || string_agg(ci, ' union all ') as civ

FROM (

    WITH extended_extent AS
    (
        SELECT ST_Transform(ST_SetSRID(
            ST_MakeBox2D(
                ST_Point(
                    ST_XMin(sb.geom_envelope) - {extent_padding_meters},
                    ST_YMin(sb.geom_envelope) - {extent_padding_meters}
                ),
                ST_Point(
                    ST_XMax(sb.geom_envelope) + {extent_padding_meters},
                    ST_YMax(sb.geom_envelope) + {extent_padding_meters}
                )
            ), 3857), 4326) as geom 
        FROM boundary.polygon_latest b
        CROSS JOIN LATERAL (
            SELECT ST_Transform(ST_Envelope(b.geom), 3857) 
            as geom_envelope
        ) sb
        WHERE b.global_id = '{boundary.global_id}' 
    )
    select '(select * from partitions_settlement_part.settlement_part_' || lpad(id::text, 5, '0') {only_latest_sql} as sp,
        '(select * from partitions_settlement_name.settlement_name_' || lpad(id::text, 5, '0') {only_latest_sql} as sn,
        '(select * from partitions_ri_catchment_item.ri_catchment_item_' || lpad(id::text, 5, '0') {only_latest_sql} as ci,
        '(select * from partitions_health_facility_point.health_facility_point_' || lpad(id::text, 5, '0') {only_latest_sql} as hf
    from partitions.boundary_id b
    inner join boundary.polygon_latest p
    on p.global_id = b.global_id
    where p.level = {boundary.level} and
    b.global_id IN (
                    SELECT b.global_id
        from boundary.polygon_latest b,
             extended_extent ee
        where ST_Intersects(ee.geom, b.geom)


    )
) sq
loop
execute myrow.spv;
execute myrow.snv;
execute myrow.hfv;
execute myrow.civ;
end loop;
end;
$$;
"""

    await execute_log(pool, sql)
