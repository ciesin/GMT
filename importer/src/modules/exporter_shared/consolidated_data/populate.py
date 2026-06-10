import logging
from typing import List

from psycopg.sql import SQL, Identifier

from lib.async_db_utils import (
    ConnType,
    PoolConn,
    create_index,
    drop_table,
    execute_log,
    get_column_names,
)
from modules.exporter.data_prep import create_catchment_sp
from modules.exporter_shared.gmt_db_objects import ExportDbNames, GeneralDbNames


from modules.exporter_shared.operating_boundaries import OperatingBoundary

log = logging.getLogger(__name__)

# IMPORTANT these are from
# https://github.com/novelt/GMT/tree/main/importer/src/modules/exporter_api
# main branch
# ExportDbNames => ExportDbNames
# BoundaryToExport => BoundaryToExport

# Another change is this uses the boundary table to know what to export, what is a surrounding boundary


async def add_settlements(conn: PoolConn) -> None:
    sql = (
        SQL("""
WITH catchments AS (
    SELECT 
        sn.global_id, 
        hf.type, 
        SUM(ci.population_perc) AS pop_perc 
    FROM 
    {sn_raw} sn
    INNER JOIN {ci_raw} ci ON 
        ci.settlement_part = sn.settlement_part AND 
        ci.type = 'generated'
    INNER JOIN {hf_raw} hf ON
        ci.health_facility_point = hf.global_id
    --hf can be in a surrounding boundary
    INNER JOIN {e_boundary} eb 
        ON sn.boundary_polygon = eb.global_id        
    WHERE 
        sn.is_primary 
        AND NOT COALESCE(sn.uninhabited, False)
        AND NOT eb.is_surrounding
    GROUP BY sn.global_id, hf.type 
)    
INSERT INTO {TABLE_SETTLEMENTS} (

    global_id, 
    version_id,
    last_sync_time_gmt,
    ward_global_id,
    lga_global_id,
    state_global_id,
    ward_name,
    lga_name,
    state_name,
    lon_x,
    lat_y,
    set_with_gps,

    name,
    synonyms,

    is_primary,


    estimated_pop,
    computed_pop,
    settlement_type,
    reason_for_attention,
    uninhabited,
    uninhabited_reason,
    fixed_catchment_perc,
    outreach_catchment_perc,
    uncovered_catchment_perc,

    geom,
    export_time_gmt,
    type,
    comments
)    
SELECT 
    s.global_id,
    s.version_id,
    GREATEST(c_s.timestamp, c_p.timestamp) AS last_sync_time_gmt,
    s.boundary_polygon AS ward_global_id,
    eb.hierarchy_guids[2],
    eb.hierarchy_guids[3],
    eb.hierarchy_names[1] as "ward_name",
    eb.hierarchy_names[2] as "lga_name",
    eb.hierarchy_names[3] as "state_name",
    ST_X(s.geom) AS lon_x,
    ST_Y(s.geom) AS lat_y,
    CASE WHEN s.set_with_gps IS NULL THEN 'Unknown' WHEN s.set_with_gps THEN 'Yes' Else 'No' end,    

    s.name,
    array_to_string(s.synonyms, '|') AS synonyms,

    is_primary,    

    estimated_pop,
    COALESCE(p.computed_pop, 0) as computed_pop,
    p.type AS settlement_type,
    array_to_string(problematic, '|') AS problems,
    COALESCE(uninhabited, false) as uninhabited,

    CASE 
        WHEN NOT COALESCE(s.uninhabited, False) THEN 'N/A'
        WHEN s.uninhabited_reason = 'Other' THEN 
            'Other - ' || COALESCE(s.uninhabited_other_detail, 'Unknown')
        ELSE
            COALESCE(s.uninhabited_reason::text, 'Unknown')
    END as uninhabited_reason, 

    round( CAST(COALESCE(fp_c.pop_perc, 0) as numeric), 2) AS fixed_catchment_perc,
    round( CAST(COALESCE(o_c.pop_perc, 0) as numeric), 2) AS outreach_catchment_perc,
    round( CAST( 100 - COALESCE(fp_c.pop_perc, 0) - COALESCE(o_c.pop_perc, 0) as numeric), 2) AS uncovered_catchment_perc,
    p.geom,
    now() at time zone 'utc' as export_time_gmt,
    p.type,
    s.comments
FROM {sn_raw}  s
INNER JOIN {sp_raw} p 
    ON s.settlement_part = p.global_id
INNER JOIN master.commits c_s ON c_s.id = s.version_id    
INNER JOIN master.commits c_p ON c_p.id = p.version_id
INNER JOIN {e_boundary} eb 
    ON s.boundary_polygon = eb.global_id
LEFT JOIN catchments o_c 
    ON o_c.global_id = s.global_id AND o_c.type = 'outreach'
LEFT JOIN catchments fp_c 
    ON fp_c.global_id = s.global_id AND fp_c.type = 'fixed_post'   
WHERE NOT eb.is_surrounding 
    """)
        .format(
            TABLE_SETTLEMENTS=ExportDbNames.SET.as_identifier(),
            sn_raw=ExportDbNames.RAW_SN.as_identifier(),
            sp_raw=ExportDbNames.RAW_SP.as_identifier(),
            ci_raw=ExportDbNames.RAW_CI.as_identifier(),
            hf_raw=ExportDbNames.RAW_HF.as_identifier(),
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
            schema=Identifier(ExportDbNames.TEMP_SCHEMA),
        )
        .as_string()
    )

    r = await execute_log(conn, sql, log_return=True)

    log.info(f"Inserted {r} into {ExportDbNames.SET.as_identifier()}")


async def add_ci(conn: PoolConn) -> None:
    """
    Adds the hf from the latest view

    This is used as the base table by views for many of the

    """

    # fp
    sql = (
        SQL("""
INSERT INTO {TABLE_CI} as i (
    ci_global_id,
    version_id,

    last_sync_time_gmt,

    hf_global_id,
    hf_name,

    hf_ward_global_id,
    hf_lga_global_id,
    hf_state_global_id,
    hf_ward_name,
    hf_lga_name,
    hf_state_name,

    sn_global_id,
    sn_name,

    sn_ward_global_id,
    sn_lga_global_id,
    sn_state_global_id,
    sn_ward_name,
    sn_lga_name,
    sn_state_name,

    population_perc,
    type
)
SELECT 
    ci.global_id,
    ci.version_id,
    c.timestamp AS last_sync_time_gmt,

    h.global_id,
    h.name,

    h_b.hierachy_guids[1],  --containing boundary (ward)
    h_b.hierachy_guids[2],  --parent (lga)
    h_b.hierachy_guids[3],
    h_b.hierachy_names[1],
    h_b.hierachy_names[2],
    h_b.hierachy_names[3],

    sn.global_id,
    sn.name,

    s_b.hierachy_guids[1],  --containing boundary (ward)
    s_b.hierachy_guids[2],  --parent (lga)
    s_b.hierachy_guids[3],
    s_b.hierachy_names[1],
    s_b.hierachy_names[2],
    s_b.hierachy_names[3],

    CASE WHEN ci.type in ('include', 'exclude') then 0 else ci.population_perc end ,
    ci.type

FROM 
{ci_raw} as ci
INNER JOIN {hf_raw} h 
    ON ci.health_facility_point = h.global_id 
INNER JOIN {sp_raw} sp 
    ON ci.settlement_part = sp.global_id
INNER JOIN {sn_raw} AS sn 
    ON sn.settlement_part = sp.global_id AND sn.is_primary
INNER JOIN master.commits c 
    ON c.id = ci.version_id    
INNER JOIN {e_boundary} h_b 
    ON h_b.global_id = h.boundary_polygon
INNER JOIN {e_boundary} s_b 
    ON s_b.global_id = sn.boundary_polygon
WHERE 
    --one must be directly targetted
    NOT h_b.is_surrounding
    OR NOT s_b.is_surrounding
;
""")
        .format(
            TABLE_CI=ExportDbNames.CI.as_identifier(),
            sn_raw=ExportDbNames.RAW_SN.as_identifier(),
            sp_raw=ExportDbNames.RAW_SP.as_identifier(),
            ci_raw=ExportDbNames.RAW_CI.as_identifier(),
            hf_raw=ExportDbNames.RAW_HF.as_identifier(),
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
            schema=Identifier(ExportDbNames.TEMP_SCHEMA),
        )
        .as_string()
    )

    r = await execute_log(conn, sql, log_return=False)

    log.info(f"Inserted {r} into {ExportDbNames.CI}")


async def add_catchment_polygons(conn: PoolConn) -> None:
    await create_catchment_sp(conn)

    sql = (
        SQL("""
WITH hf_raster_fields AS 
(
    SELECT
        hf.catchment_raster,
        hf.raster_width,
        hf.raster_height,
        hf.origin_x,
        hf.origin_y,
        hf.global_id
    FROM {hf_raw} hf
    INNER JOIN {e_boundary} eb 
        ON hf.boundary_polygon = eb.global_id
    WHERE NOT eb.is_surrounding
), 
hf_raster AS (
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
), catchments AS (
    SELECT 
        hf.global_id, 
        SUM(sp.computed_pop * ci.population_perc / 100) AS gis_pop,
        SUM(COALESCE(sn.estimated_pop,0) * ci.population_perc / 100) AS est_pop,
        SUM(COALESCE(sn.estimated_pop, sp.computed_pop) * ci.population_perc / 100) AS est_gis_pop 
    FROM {hf_raw} hf
    --need the view with adj. wards because can influence sp outside boundary
    INNER JOIN {ci_raw} ci ON 
        ci.health_facility_point = hf.global_id AND
        ci.type = 'generated'
    INNER JOIN {sp_raw} sp ON
        ci.settlement_part = sp.global_id
    INNER JOIN {sn_raw} sn ON
        sn.settlement_part = sp.global_id
    INNER JOIN {e_boundary} eb 
        ON hf.boundary_polygon = eb.global_id 
    WHERE 
        sn.is_primary 
        AND NOT COALESCE(sn.uninhabited, False)
        AND NOT eb.is_surrounding
    GROUP BY hf.global_id 
)   
INSERT INTO {TABLE_CP}
(
    export_time_gmt,

    hf_global_id,
    hf_name,
    strategy_type,

    hf_state_global_id,
    hf_lga_global_id,
    hf_ward_global_id,

    hf_state_name,
    hf_lga_name,
    hf_ward_name,

    gis_pop,
    est_pop,
    est_gis_pop,

    geom
)
SELECT
    now() at time zone 'utc' as export_time_gmt, 

    h.global_id AS hf_global_id,
    h.name,
    h.type,

    b1.global_id,
    b2.global_id,
    h.boundary_polygon AS ward_global_id,

    b1.name,
    b2.name,
    b3.name,

    COALESCE(catchments.gis_pop, 0),
    COALESCE(catchments.est_pop, 0),
    COALESCE(catchments.est_gis_pop, 0),

    hulls.geom
FROM {hf_raw} h
    LEFT JOIN catchments catchments ON h.global_id = catchments.global_id
    LEFT JOIN hulls ON hulls.global_id = h.global_id
    INNER JOIN master.commits c_h ON c_h.id = h.version_id    
    INNER JOIN {e_boundary} eb ON h.boundary_polygon = eb.global_id
    WHERE NOT eb.is_surrounding 

    """)
        .format(
            TABLE_CP=ExportDbNames.CP.as_identifier(),
            sn_raw=ExportDbNames.RAW_SN.as_identifier(),
            sp_raw=ExportDbNames.RAW_SP.as_identifier(),
            ci_raw=ExportDbNames.RAW_CI.as_identifier(),
            hf_raw=ExportDbNames.RAW_HF.as_identifier(),
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
            schema=Identifier(ExportDbNames.TEMP_SCHEMA),
        )
        .as_string()
    )

    await execute_log(conn, sql, log_return=True)


async def add_hf_related_data(conn: PoolConn) -> None:
    await create_catchments_table(conn)

    await add_fp(conn)
    await add_outreach(conn)

    await add_hf(conn)


async def create_catchments_table(conn: PoolConn) -> None:
    await drop_table(conn, ExportDbNames.CATCHMENTS)

    sql = (
        SQL("""
CREATE TABLE {catchments} AS 
    SELECT 
        hf.global_id, 
        SUM(sp.computed_pop * ci.population_perc / 100) AS gis_pop,
        SUM(COALESCE(sn.estimated_pop,0) * ci.population_perc / 100) AS est_pop,
        SUM(COALESCE(sn.estimated_pop, sp.computed_pop) * ci.population_perc / 100) AS est_gis_pop 
    FROM {hf_raw} hf
    --need the view with adj. wards because can influence sp outside boundary
    INNER JOIN {ci_raw} ci ON 
        ci.health_facility_point = hf.global_id AND
        ci.type = 'generated'
    INNER JOIN {sp_raw} sp ON
        ci.settlement_part = sp.global_id
    INNER JOIN {sn_raw} sn ON
        sn.settlement_part = sp.global_id
    INNER JOIN {e_boundary} eb 
        ON hf.boundary_polygon = eb.global_id        
    WHERE 
        sn.is_primary 
        AND NOT eb.is_surrounding
    GROUP BY hf.global_id 
       """)
        .format(
            catchments=ExportDbNames.CATCHMENTS.as_identifier(),
            sn_raw=ExportDbNames.RAW_SN.as_identifier(),
            sp_raw=ExportDbNames.RAW_SP.as_identifier(),
            ci_raw=ExportDbNames.RAW_CI.as_identifier(),
            hf_raw=ExportDbNames.RAW_HF.as_identifier(),
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
        )
        .as_string()
    )

    await execute_log(conn, sql, log_return=True)

    await create_index(
        conn, ExportDbNames.CATCHMENTS.with_column_name("global_id"), is_geom=False
    )


async def add_fp(conn: PoolConn) -> None:
    """
    Adds the hf from the latest view

    This is used as the base table by views for many of the


    """

    # fp
    sql = (
        SQL("""

INSERT INTO {TABLE_FP} (
    fp_global_id,
    version_id,
    
    last_sync_time_gmt,
    ward_global_id,
    lga_global_id,
    state_global_id,
    ward_name,
    lga_name,
    state_name,
    
    lon_x,
    lat_y,
    set_with_gps,
    name,
    synonyms,
    
    services,
    mp_status,
    level_of_care,
    
    primary_type,
    ownership,
    operating_hours_start,
    operating_hours_stop,
    staff_names,
    staff_positions,
    staff_types,
    
    transport,
    frequency,
    type,
    custom_catchment,
    gis_catchment_pop,
    estimated_catchment_pop,
    estimated_gis_catchment_pop,
    geom,
    export_time_gmt,
    comments
)
SELECT 
    h.global_id AS hf_global_id,
    h.version_id,
    c_h.timestamp AS last_sync_time_gmt,
    h.boundary_polygon AS ward_global_id,
    b2.global_id,
    b1.global_id,
    b3.name,
    b2.name,
    b1.name,
    
    ST_X(h.geom) AS lon_x,
    ST_Y(h.geom) AS lat_y,
    CASE WHEN h.set_with_gps IS NULL THEN 'Unknown' WHEN h.set_with_gps THEN 'Yes' Else 'No' end,
    h.name,
    array_to_string(synonyms, '|') AS synonyms,
    
    array_to_string(services, '|') AS services,
    mp_status,
    level_of_care,
    
    primary_type,
    CASE WHEN private IS NULL THEN 'Unknown'
    WHEN private IS TRUE THEN 'Private'
    ELSE 'Public' END::{schema}.hf_ownership as ownership,
    array_to_string(operating_hours_start, '|') AS operating_hours_start,
    array_to_string(operating_hours_stop, '|') AS operating_hours_stop,
    array_to_string(staff_names, '|') AS staff_names,
    --we want to replace 'Other' with the value in the staff_positions_other json array
    --note on problems this will return blank
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
    
    array_to_string(transport, '|') AS transport,
    
    CASE WHEN frequency IS NULL THEN 'unknown'
    WHEN frequency = 'Unknown' THEN 'unknown'
    ELSE frequency END::{schema}.hf_frequency,    
    type,
    EXISTS (
                SELECT 1 FROM {ci_raw} ci 
                WHERE ci.type IN ('include', 'exclude')
                    AND ci.health_facility_point = h.global_id
    ) AS has_explicit_include,
    COALESCE(catchments.gis_pop, 0) as computed_catchment_pop,
    COALESCE(catchments.est_pop, 0) as computed_est_gis_pop,
    COALESCE(catchments.est_gis_pop, 0) as computed_est_gis_pop,
    h.geom,
    now() at time zone 'utc' as export_time_gmt,
    h.comments
FROM {hf_raw} h
LEFT JOIN {catchments} catchments 
    ON h.global_id = catchments.global_id
INNER JOIN {commits} c_h ON c_h.id = h.version_id    
INNER JOIN {e_boundary} eb ON h.boundary_polygon = eb.global_id
WHERE NOT eb.is_surrounding AND h.type = 'fixed_post'
ORDER BY b1.name, b2.name, b3.name, h.name;
""")
        .format(
            catchments=ExportDbNames.CATCHMENTS.as_identifier(),
            TABLE_FP=ExportDbNames.FP.as_identifier(),
            ci_raw=ExportDbNames.RAW_CI.as_identifier(),
            hf_raw=ExportDbNames.RAW_HF.as_identifier(),
            schema=Identifier(ExportDbNames.TEMP_SCHEMA),
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
            commits=GeneralDbNames.COMMITS.as_identifier(),
        )
        .as_string()
    )

    r = await execute_log(conn, sql, log_return=True)

    log.info(f"Inserted {r} into {ExportDbNames.FP}")


async def add_hf(conn: PoolConn) -> None:
    """
    Adds the hf from the latest view

    This is used as the base table by views for many of the


    """

    sql = (
        SQL("""

INSERT INTO {TABLE_HF} (
    fp_global_id,
    version_id,
    
    last_sync_time_gmt,
    ward_global_id,
    lga_global_id,
    state_global_id,
    ward_name,
    lga_name,
    state_name,
    
    lon_x,
    lat_y,
    set_with_gps,
    name,
    synonyms,
    
    services,
    mp_status,
    level_of_care,
    
    primary_type,
    ownership,
    operating_hours_start,
    operating_hours_stop,
    staff_names,
    staff_positions,
    staff_types,
    
    transport,
    frequency,
    type,
    custom_catchment,
    gis_catchment_pop,
    estimated_catchment_pop,
    estimated_gis_catchment_pop,
    geom,
    export_time_gmt,
    comments
)
SELECT 
    fp.fp_global_id,
    fp.version_id,
    
    fp.last_sync_time_gmt,
    
    fp.ward_global_id,
    fp.lga_global_id,
    fp.state_global_id,
    
    fp.ward_name,
    fp.lga_name,
    fp.state_name,
    
    fp.lon_x,
    fp.lat_y,
    
    fp.set_with_gps,
    fp.name,
    fp.synonyms,
    
    fp.services,
    fp.mp_status,
    fp.level_of_care,
    
    fp.primary_type,
    fp.ownership,
    
    fp.operating_hours_start,
    fp.operating_hours_stop,
    
    fp.staff_names,
    fp.staff_positions,
    fp.staff_types,
    
    fp.transport,
    fp.frequency,    
    fp.type,
    fp.custom_catchment,
    
    
    COALESCE(fp.gis_catchment_pop, 0) + COALESCE(SUM(o.gis_catchment_pop), 0),
    COALESCE(fp.estimated_catchment_pop, 0) + COALESCE(SUM(o.estimated_catchment_pop), 0),
    COALESCE(fp.estimated_gis_catchment_pop, 0) + COALESCE(SUM(o.estimated_gis_catchment_pop), 0),
    fp.geom,
    now() at time zone 'utc' as export_time_gmt,
    fp.comments
FROM {TABLE_FP} fp
LEFT JOIN {TABLE_OUTREACH} o
    ON o.fixed_post_parent_global_id = fp.fp_global_id
GROUP BY fp.fp_global_id
ORDER BY fp.state_name, fp.lga_name, fp.ward_name, fp.name;
;
""")
        .format(
            TABLE_HF=ExportDbNames.HF.as_identifier(),
            TABLE_FP=ExportDbNames.FP.as_identifier(),
            TABLE_OUTREACH=ExportDbNames.OUTREACH.as_identifier(),
        )
        .as_string()
    )

    r = await execute_log(conn, sql, log_return=True)

    log.info(f"Inserted {r} into {ExportDbNames.FP} ")


async def add_outreach(conn: PoolConn) -> None:
    """
    Adds the hf from the latest view

    This is used as the base table by views for many of the


    """

    sql = (
        SQL("""

INSERT INTO {TABLE_OUTREACH} (
    outreach_global_id,
    version_id,
    
    last_sync_time_gmt,
    ward_global_id,
    lga_global_id,
    state_global_id,
    ward_name,
    lga_name,
    state_name,
    
    lon_x,
    lat_y,
    set_with_gps,
    name,
    
    operating_hours_start,
    operating_hours_stop,
    
    fixed_post_parent_global_id,
    transport,
    frequency,
    type,
    custom_catchment,
    gis_catchment_pop,
    estimated_catchment_pop,
    estimated_gis_catchment_pop,
    geom,
    export_time_gmt,
    comments
)
SELECT 
    h.global_id AS hf_global_id,
    h.version_id,
    c_h.timestamp AS last_sync_time_gmt,
    h.boundary_polygon AS ward_global_id,
    b2.global_id,
    b1.global_id,
    b3.name,
    b2.name,
    b1.name,
    
    ST_X(h.geom) AS lon_x,
    ST_Y(h.geom) AS lat_y,
    CASE WHEN h.set_with_gps IS NULL THEN 'Unknown' WHEN h.set_with_gps THEN 'Yes' Else 'No' end,
    h.name,
    
    array_to_string(operating_hours_start, '|') AS operating_hours_start,
    array_to_string(operating_hours_stop, '|') AS operating_hours_stop,
    
    
    parent AS fixed_post_parent_global_id,
    array_to_string(transport, '|') AS transport,
    
    CASE WHEN frequency IS NULL THEN 'unknown'
    WHEN frequency = 'Unknown' THEN 'unknown'
    ELSE frequency END::{schema}.hf_frequency,    
    type,
    EXISTS (
                SELECT 1 FROM {ci_raw} ci 
                WHERE ci.type IN ('include', 'exclude')
                    AND ci.health_facility_point = h.global_id
    ) AS has_explicit_include,
    COALESCE(catchments.gis_pop, 0) as computed_catchment_pop,
    COALESCE(catchments.est_pop, 0) as computed_est_gis_pop,
    COALESCE(catchments.est_gis_pop, 0) as computed_est_gis_pop,
    h.geom,
    now() at time zone 'utc' as export_time_gmt,
    h.comments
FROM {hf_raw} h
LEFT JOIN {catchments} catchments 
    ON h.global_id = catchments.global_id
INNER JOIN {commits} c_h ON c_h.id = h.version_id    
INNER JOIN {e_boundary} eb 
        ON h.boundary_polygon = eb.global_id   
WHERE b1.global_id = {state_guid}
    AND h.type = 'outreach'
ORDER BY b1.name, b2.name, b3.name, h.name;    

""")
        .format(
            catchments=ExportDbNames.CATCHMENTS.as_identifier(),
            TABLE_OUTREACH=ExportDbNames.OUTREACH.as_identifier(),
            hf_raw=ExportDbNames.RAW_HF.as_identifier(),
            schema=Identifier(ExportDbNames.TEMP_SCHEMA),
            ci_raw=ExportDbNames.RAW_CI.as_identifier(),
            commits=GeneralDbNames.COMMITS.as_identifier(),
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
        )
        .as_string()
    )

    r = await execute_log(conn, sql, log_return=True)

    log.info(f"Inserted {r} into {ExportDbNames.OUTREACH}")

    await create_index(
        conn,
        ExportDbNames.OUTREACH.with_column_name("outreach_global_id"),
        is_geom=False,
    )


async def populate_raw_hf_table(
    conn: ConnType,
    b_list: List[OperatingBoundary],
) -> None:
    log.info(f"Importing hfs from {len(b_list)} partitions to {ExportDbNames.RAW_HF}")

    column_names = await get_column_names(conn, ExportDbNames.RAW_HF)
    column_names.remove("services")
    column_names.remove("mp_status")

    column_names.remove("level_of_care")
    column_names.remove("maturity_level")
    column_names.remove("primary_type")
    column_names.remove("staff_positions")
    column_names.remove("staff_types")
    column_names.remove("transport")
    column_names.remove("type")

    for b_idx, boundary in enumerate(b_list):
        if b_idx % 1000 == 0:
            log.info(
                f"Importing health facilities from partition {boundary.partition_id} - {boundary.name}.  Idx {b_idx + 1}/{len(b_list)}"
            )

        import_query_str = (
            SQL(
                """
INSERT INTO {target}
(
    {cols}, 
    "services",
    "mp_status",
    "level_of_care",
    "maturity_level",
    "primary_type",
    "staff_positions",
    "staff_types",
    "transport",
    "type"
)
SELECT 
    {selCols}, 
    src.services::text[]::{schema}.hf_services[], 
    src.mp_status::text::{schema}.hf_microplan_status,
    src.level_of_care::text::{schema}.hf_level_of_care,
    src.maturity_level::text::{schema}.hf_maturity_level,
    src.primary_type::text::{schema}.hf_primary_type,
    src.staff_positions::text[]::{schema}.hf_staff_position[],
    src.staff_types::text[]::{schema}.hf_staff_type[],
    src.transport::text[]::{schema}.hf_means_of_transport[],
    src.type::text::{schema}.hf_type
FROM {src} src
                  """
            )
            .format(
                cols=SQL(", ").join([Identifier(c) for c in column_names]),
                selCols=SQL(", ").join([Identifier("src", c) for c in column_names]),
                src=GeneralDbNames.SCHEMA_HF.get_table_as_identifier(
                    boundary.partition_id, is_latest=True
                ),
                target=ExportDbNames.RAW_HF.as_identifier(),
                schema=Identifier(ExportDbNames.RAW_HF.schema_name),
            )
            .as_string()
        )

        await execute_log(conn, import_query_str, log_return=False)
