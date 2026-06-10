# Produce a SQL file that can be run by hand on prod
# done this way since auto fixes can be dangerous
import sys
import uuid
from dataclasses import dataclass
from typing import IO, Optional, Tuple, List, Set

from lib.async_db_utils import PoolConn, fetch_log, SchemaTable, get_column_names
from lib.logger_utils import get_logger
from modules.db_checks.db_constants import DbCheckNames
from modules.exporter_shared.gmt_db_objects import ModelPartitionSchema, GeneralDbNames
from psycopg.sql import SQL, Identifier, Literal as LiteralSql, Composed

log = get_logger(__name__)

def fixes_write_version(sql_file: Optional[IO[str]], description: str) -> None:

    if sql_file is None:
        return

    sql = f"""
--Insert version information for the fixes needed for {description}
INSERT INTO master.commits
(publish_user, "comment", "timestamp", is_published) VALUES 
( 'eg@novel-t.ch', '{description}', CURRENT_TIMESTAMP, false);

SELECT *  FROM master.commits ORDER BY id DESC ;
"""

    sql_file.write(sql)


async def fixes_dup(
    sql_file: IO[str],
    problems_sql_query: str,
    conn: PoolConn,
    db_check_table: SchemaTable,
) -> None:

    mps: Optional[ModelPartitionSchema] = None

    if db_check_table == DbCheckNames.SP:
        mps = GeneralDbNames.SCHEMA_SP
    elif db_check_table == DbCheckNames.SN:
        mps = GeneralDbNames.SCHEMA_SN
    elif db_check_table == DbCheckNames.HF:
        mps = GeneralDbNames.SCHEMA_HF
    else:
        raise Exception(f"Unhandled check table [{db_check_table}]")

    rows = await fetch_log(conn, problems_sql_query)

    orig_column_names = []

    log.info(f"Query:\n{problems_sql_query}")
    for row in rows:
        log.info(f"Row: {row}")

        # where we need to delete
        partition_id = row["partition_id"]
        global_id = row["global_id"]
        version_id = row["t1_version_id"]

        table = mps.get_table(partition_id, False)
        latest_view = mps.get_table(partition_id, True)

        if len(orig_column_names) == 0:
            orig_column_names = await get_column_names(conn, table)
            # we handle these specifically, the rest are copied as is
            orig_column_names.remove("is_deleted")
            orig_column_names.remove("version_id")

        col_insert = ", ".join([Identifier(c).as_string() for c in orig_column_names])

        sql = f"""
--Soft delete {global_id} from {table}         
        
WITH ver as (
    SELECT max(c.id) AS id FROM master.commits c 
    WHERE c.publish_user = 'eg@novel-t.ch'
)
INSERT INTO {table.as_identifier().as_string()}
(
    "is_deleted",
    "version_id",
    {col_insert}
)
SELECT True, ver.id, {col_insert}
FROM {table.as_identifier().as_string()} t, ver 
WHERE t.global_id = '{global_id}' AND t.version_id = '{version_id}';

--to check
SELECT * 
FROM {table.as_identifier().as_string()} t 
WHERE t.global_id = '{global_id}' ORDER BY t.version_id DESC;

REFRESH MATERIALIZED VIEW {latest_view.as_identifier().as_string()};        
        """

        sql_file.write(sql)


async def fixes_parts_without_primary_name(
    sql_file: IO[str],
    problems_sql_query: str,
    conn: PoolConn
) -> None:


    rows = await fetch_log(conn, problems_sql_query)

    orig_column_names = []

    log.info(f"Query:\n{problems_sql_query}")
    for row in rows:
        log.info(f"Row: {row}")

        # where we need to delete
        partition_id = row["partition_id"]
        global_id = row["sp_global_id"]
        version_id = row["sp_version_id"]

        table = GeneralDbNames.SCHEMA_SP.get_table(partition_id, False)
        latest_view = GeneralDbNames.SCHEMA_SP.get_table(partition_id, True)

        if len(orig_column_names) == 0:
            orig_column_names = await get_column_names(conn, table)
            # we handle these specifically, the rest are copied as is
            orig_column_names.remove("is_deleted")
            orig_column_names.remove("version_id")

        col_insert = ", ".join([Identifier(c).as_string() for c in orig_column_names])

        sql = f"""
--Soft delete unnamed settlement part {global_id} from {table}         

--Checks to see if other named settlement parts cover it
--should have area_perc == 100 for named, not deleted settlement parts

WITH i AS (
    SELECT 
        td.global_id, td.boundary_polygon, td.is_deleted, td.version_id, td.split_type,
        ST_Area(td.geom::geography) AS to_del_area, 
        ST_Area(o.geom::geography) AS other_area, 
        ST_Area(ST_Intersection(td.geom, o.geom)::geography) AS int_area,
        o.global_id AS o_global_id, 
        o.boundary_polygon, 
        o.is_deleted AS o_is_deleted, 
        o.version_id AS o_version_id,
        o.split_type AS o_split_type
    FROM {DbCheckNames.SP.as_identifier().as_string()} td, 
    {DbCheckNames.SP.as_identifier().as_string()} o 
    WHERE ST_Intersects(o.geom, td.geom) 
        AND o.global_id != td.global_id
        AND td.global_id = '{global_id}'
        AND td.version_id = '{version_id}'
)
SELECT 
    100*i.int_area/i.to_del_area  AS area_perc,
    EXISTS (
        SELECT 1 FROM db_check.sn 
        WHERE sn.is_primary
        AND sn.settlement_part = i.o_global_id
    ) AS is_named,
    i.split_type,
    i.o_split_type,
    i.o_is_deleted,
    i.o_global_id,
    i.o_version_id
FROM i 
WHERE int_area > 0;

WITH ver as (
    SELECT max(c.id) AS id FROM master.commits c 
    WHERE c.publish_user = 'eg@novel-t.ch'
)
INSERT INTO {table.as_identifier().as_string()}
(
    "is_deleted",
    "version_id",
    {col_insert}
)
SELECT True, ver.id, {col_insert}
FROM {table.as_identifier().as_string()} t, ver 
WHERE t.global_id = '{global_id}' AND t.version_id = '{version_id}';

--to check
SELECT * 
FROM {table.as_identifier().as_string()} t 
WHERE t.global_id = '{global_id}' ORDER BY t.version_id DESC;

REFRESH MATERIALIZED VIEW {latest_view.as_identifier().as_string()};        
        """

        sql_file.write(sql)


async def fixes_part_name_boundary_mismatch(
    sql_file: IO[str],
    problems_sql_query: str,
    conn: PoolConn
) -> None:

    # TDB see set_settlement_name_part
    pass

#     rows = await fetch_log(conn, problems_sql_query)
#
#     orig_column_names = []
#
#     log.info(f"Query:\n{problems_sql_query}")
#     for row in rows:
#         log.info(f"Row: {row}")
#
#         from_partition_id = row["sp_partition_id"]
#         to_partition_id = row["sn_partition_id"]
#         global_id = row["sp_global_id"]
#         version_id = row["sp_version_id"]
#
#         table_from = GeneralDbNames.SCHEMA_SP.get_table(from_partition_id, False)
#         latest_view_from = GeneralDbNames.SCHEMA_SP.get_table(from_partition_id, True)
#         table_to = GeneralDbNames.SCHEMA_SP.get_table(to_partition_id, False)
#         latest_view_to = GeneralDbNames.SCHEMA_SP.get_table(to_partition_id, True)
#
#         if len(orig_column_names) == 0:
#             orig_column_names = await get_column_names(conn, table_from)
#             # we handle these specifically, the rest are copied as is
#             orig_column_names.remove("is_deleted")
#             orig_column_names.remove("version_id")
#
#         col_insert = ", ".join([Identifier(c).as_string() for c in orig_column_names])
#
#         sql = f"""
# --Update boundary polygon of settlement part {global_id} from {table_from} to {table_to}
#
#
#
#         """
#
#         sql_file.write(sql)


async def get_sp_info(conn: PoolConn, sp_global_id: uuid.UUID) -> Tuple[str, str, str, str, str]:
    sql = (
        SQL("""
        SELECT        
            sp.global_id as sp_global_id,
            sp.version_id as sp_version_id,
            b_sp.partition_id as sp_partition_id,
            b_sp.global_id as sp_boundary_polygon,
            sp.type as sp_type
        FROM {sp} sp        
        INNER JOIN {boundary} b_sp 
            ON sp.boundary_polygon = b_sp.global_id
        WHERE 
            NOT b_sp.is_surrounding
            AND sp.global_id = {global_id}
            """)
        .format(
            sp=DbCheckNames.SP.as_identifier(),
            boundary=DbCheckNames.BOUNDARY.as_identifier(),
            global_id=LiteralSql(sp_global_id),
        )
        .as_string()
    )

    rows = await fetch_log(conn, sql)

    if len(rows) != 1:
        raise Exception(f"Expected 1 row for {sp_global_id}")

    sp_global_id = rows[0]["sp_global_id"]
    sp_version_id = rows[0]["sp_version_id"]
    sp_partition_id = rows[0]["sp_partition_id"]
    sp_boundary_polygon = rows[0]["sp_boundary_polygon"]
    sp_type = rows[0]["sp_type"]

    return sp_global_id, sp_version_id, sp_partition_id, sp_boundary_polygon, sp_type


async def get_ci_info(conn: PoolConn, ci_global_id: uuid.UUID) -> int:
    sql = (
        SQL("""
        SELECT        
            ci.global_id as ci_global_id,
            ci.version_id as ci_version_id,
            b_ci.partition_id as ci_partition_id,
            b_ci.global_id as ci_boundary_polygon
        FROM {ci} ci        
        INNER JOIN {boundary} b_ci 
            ON ci.boundary_polygon = b_ci.global_id
        WHERE 
            NOT b_ci.is_surrounding
            AND ci.global_id = {global_id}
            """)
        .format(
            ci=DbCheckNames.CI.as_identifier(),
            boundary=DbCheckNames.BOUNDARY.as_identifier(),
            global_id=LiteralSql(ci_global_id),
        )
        .as_string()
    )

    rows = await fetch_log(conn, sql)

    if len(rows) != 1:
        raise Exception(f"Expected 1 row for {ci_global_id}")

    ci_global_id = rows[0]["ci_global_id"]
    ci_version_id = rows[0]["ci_version_id"]
    ci_partition_id = rows[0]["ci_partition_id"]
    ci_boundary_polygon = rows[0]["ci_boundary_polygon"]

    return ci_partition_id


@dataclass(frozen=True)
class SnInfo:
    sn_partition_id: int
    sn_boundary_polygon: uuid.UUID
    sp_global_id: Optional[uuid.UUID]
    sp_partition_id: Optional[int]

async def get_sn_info(conn: PoolConn, sn_global_id: uuid.UUID) -> SnInfo:
    sql = (
        SQL("""
        SELECT        
            sn.global_id as sn_global_id,
            sn.version_id as sn_version_id,
            b_sn.partition_id as sn_partition_id,
            b_sn.global_id as sn_boundary_polygon,
            sp.global_id as sp_global_id,
            b_sp.partition_id as sp_partition_id
        FROM {sn} sn        
        LEFT JOIN {sp} sp 
            ON ST_INTERSECTS(sp.geom, sn.geom)
                AND sp.split_type != 'auto_split_parent'
        INNER JOIN {boundary} b_sn 
            ON sn.boundary_polygon = b_sn.global_id
        LEFT JOIN {boundary} b_sp 
            ON sp.boundary_polygon = b_sp.global_id
        WHERE 
            NOT b_sn.is_surrounding
            AND sn.global_id = {global_id}
            """)
        .format(
            sn=DbCheckNames.SN.as_identifier(),
            sp=DbCheckNames.SP.as_identifier(),
            boundary=DbCheckNames.BOUNDARY.as_identifier(),
            global_id=LiteralSql(sn_global_id),
        )
        .as_string()
    )

    rows = await fetch_log(conn, sql)

    if len(rows) != 1:
        raise Exception(f"Expected 1 row for {sn_global_id}\n{sql}")

    sn_global_id = rows[0]["sn_global_id"]
    sn_version_id = rows[0]["sn_version_id"]
    sn_partition_id = rows[0]["sn_partition_id"]
    sn_boundary_polygon = rows[0]["sn_boundary_polygon"]
    sp_global_id = rows[0]["sp_global_id"]
    sp_partition_id = rows[0]["sp_partition_id"]

    return SnInfo(sn_partition_id= sn_partition_id,
                  sp_global_id=sp_global_id,
                  sp_partition_id=sp_partition_id,
                  sn_boundary_polygon=sn_boundary_polygon)

async def v_split_sp(
    sql_file: IO[str], conn: PoolConn, sp_global_id: uuid.UUID
) -> None:
    """
    Will take a sp, make it an auto_split_parent if not already
    then split it among the primary names within its borders

    Also removes any children / intersecting with more than 80% settlement parts
    """

    # Find partition id of settlement part
    sp_global_id, sp_version_id, sp_partition_id, sp_boundary_polygon, sp_type = await get_sp_info(conn, sp_global_id)

    # Find all primary names that intersect it
    sql = (
        SQL("""
        SELECT        
            sn.global_id as sn_global_id,
            sn.version_id as sn_version_id,
            b_sn.partition_id as sn_partition_id
        FROM {sp} sp,
        {sn} sn        
        INNER JOIN {boundary} b_sn 
            ON sn.boundary_polygon = b_sn.global_id
        WHERE 
            sp.global_id = {global_id}
            AND sn.is_primary
            AND ST_Intersects(sn.geom, sp.geom)
            """)
        .format(
            sp=DbCheckNames.SP.as_identifier(),
            sn=DbCheckNames.SN.as_identifier(),
            boundary=DbCheckNames.BOUNDARY.as_identifier(),
            global_id=LiteralSql(sp_global_id),
        )
        .as_string()
    )

    sn_guids = set()
    rows = await fetch_log(conn, sql)
    for sn_row in rows:
        log.info(f"SN Row: {sn_row}")
        sn_guids.add(sn_row["sn_global_id"])

    # Find other settlement parts that intersect 80% +
    sql = (
        SQL("""
        --used to find settlement parts to soft delete
WITH sq AS (
    SELECT        
        sp.global_id as sp_global_id,
        sp.version_id as sp_version_id,
        b_sp.partition_id as sp_partition_id,
        ST_Area(sp_parent.geom::geography) parent_area,
        ST_Area(sp.geom::geography) other_area,
        ST_Area(ST_Intersection(sp.geom, sp_parent.geom)::geography) intersection_area
    FROM 
        {sp} sp_parent
    INNER JOIN {sp} sp 
        ON ST_Intersects(sp_parent.geom, sp.geom)  
            AND sp_parent.global_id != sp.global_id 
    INNER JOIN {boundary} b_sp 
        ON sp.boundary_polygon = b_sp.global_id
    WHERE 
        sp_parent.global_id = {global_id}
)
SELECT * FROM sq
WHERE sq.intersection_area / sq.other_area > 0.8;
            """)
        .format(
            sp=DbCheckNames.SP.as_identifier(),
            sn=DbCheckNames.SN.as_identifier(),
            boundary=DbCheckNames.BOUNDARY.as_identifier(),
            global_id=LiteralSql(sp_global_id),
        )
        .as_string()
    )

    sql_file.write(sql)

    sp_guids_to_del: Set[uuid.UUID] = set()
    rows = await fetch_log(conn, sql)
    for sp_row in rows:
        log.info(f"SP Row: {sp_row}")
        sp_guids_to_del.add(uuid.UUID(str(sp_row["sp_global_id"])))

    # optional part to ensure the split parent geospatially contains all the old split children we are removing
    sp_columns = await get_column_names(conn, GeneralDbNames.SCHEMA_SP.get_table(
        sp_partition_id,
        False
    ))

    columns_to_set = [
    "version_id",
    "is_deleted",
    "split_type",
    "split_parent",
    "original_guids",
    "geom"]

    for c in columns_to_set:
        sp_columns.remove(c)

    sql = (
        SQL("""
--setting geometry to the union of those removed + the original one        
WITH
ver as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch'),
union_geom AS (
    SELECT ST_UNION(geom) as geom 
    FROM {sp_view} spv 
    WHERE spv.global_id IN ({sp_guids})
) 
INSERT INTO {sp_table}
(
    {columns_to_set}, 
    {other_columns}  
)
SELECT 
    ver.id, FALSE, 'auto_split_parent',
    null, array[{sp_guids}],
    ug.geom,
    {other_values}
FROM ver, union_geom ug,
{sp_view} spv 
WHERE spv.global_id = {sp_global_id} ;
        """)
        .format(
            sp_guids=SQL(", ").join(
                [LiteralSql(g) for g in (list(sp_guids_to_del) + [sp_global_id])]
            ),
            columns_to_set=SQL(", ").join([Identifier(c) for c in columns_to_set]),
            other_columns=SQL(", ").join([Identifier(c) for c in sp_columns]),
            other_values=SQL(", ").join([Identifier("spv", c) for c in sp_columns]),
            sp_global_id=LiteralSql(sp_global_id),
            sp_view=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sp_partition_id, True
            ),
            sp_table=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sp_partition_id, False
            ),
        )
        .as_string()
    )

    sql_file.write(sql)

    await soft_delete_sp(sql_file, conn, [g for g in sp_guids_to_del])

    v_poly_sql = (
        SQL("""
    
/*    
WITH v as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')  
DELETE FROM {sp_table} USING v WHERE version_id = v.id;
*/

REFRESH MATERIALIZED VIEW {sp_view};

SELECT * FROM {sp_table} ORDER BY VERSION_ID DESC;
SELECT * FROM {sp_view} ORDER BY VERSION_ID DESC;

/*
WITH v as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')
DELETE FROM {sn_table} USING v WHERE version_id = v.id;
*/

REFRESH MATERIALIZED VIEW {sn_view};

SELECT * FROM {sn_table} ORDER BY VERSION_ID DESC;
SELECT * FROM {sn_view} ORDER BY VERSION_ID DESC;

WITH s_env AS (
    SELECT 
        sp.global_id, 
        ST_Envelope(sp.geom) AS sp_envelope,
        sp.geom AS sp_geom
    FROM {sp_view} sp
    WHERE sp.global_id = {sp_global_id} 
), names_to_split AS (
    SELECT geom, name
    FROM {sn_view} sn
    WHERE sn.global_id IN ( {sn_guids} )
),
sn_points AS (
    SELECT 
        ST_Collect(n.geom) as point_collection, 
        e.sp_envelope
    FROM s_env e, names_to_split n 
    GROUP BY e.sp_envelope
),
sn_v_poly AS (
    SELECT
        --extract individual polygons from the collection of v polygons
        (ST_Dump(
            ST_VoronoiPolygons(
                sn_points.point_collection, 0,
                --Use original fixed settlement geometry for extent of v polygons
                sn_points.sp_envelope
            )
        )).geom as geom
    FROM
    sn_points
),
ver as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')
INSERT INTO {sp_table}
(
    global_id, version_id, is_deleted, 
    boundary_polygon,  
    geom, 
    "type", split_type, split_parent, 
    original_guids,  properties
)
SELECT 
    uuid_generate_v4(), ver.id, FALSE,
    {sp_boundary_polygon} AS boundary_polygon,
    ST_MULTI(ST_COLLECTIONEXTRACT(
        ST_MakeValid(ST_INTERSECTION(s_env.sp_geom, v.geom))
    , 3)) as geom,
        
    {sp_type},
    'auto_split_child' as split_type,
    --original one, normally this would be a new one in the ui
    {sp_global_id} AS split_parent,
    
    array[{sp_global_id}]::uuid[] AS original_guids,
    jsonb_build_object(
        'user_name',  'eg@novel-t.ch'  ,
        'data_comment', 'V polygons recreated by hand to resolve data problem by eg@novel-t.ch',
        'modified_date', now()::text,
        'settlement_name', n.name
    ) AS properties 
FROM sn_v_poly v 
INNER JOIN names_to_split n 
    ON ST_Intersects(n.geom, v.geom)
, ver, s_env;
;

REFRESH MATERIALIZED VIEW {sp_view};

SELECT * FROM {sp_view} ORDER BY VERSION_ID DESC;

    """)
        .format(
            sp_table=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sp_partition_id, False
            ),
            sn_table=GeneralDbNames.SCHEMA_SN.get_table_as_identifier(
                sp_partition_id, False
            ),
            sp_view=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sp_partition_id, True
            ),
            sn_view=GeneralDbNames.SCHEMA_SN.get_table_as_identifier(
                sp_partition_id, True
            ),
            sp_boundary_polygon=LiteralSql(sp_boundary_polygon),
            sp_type=LiteralSql(sp_type),
            sp_global_id=LiteralSql(sp_global_id),
            sp_version_id=LiteralSql(sp_version_id),
            sn_guids=SQL(", ").join([LiteralSql(g) for g in sn_guids]),
        )
        .as_string()
    )

    sql_file.write(v_poly_sql)

    # Now handle the point updates
    sn_columns = await get_column_names(conn, GeneralDbNames.SCHEMA_SN.get_table(
        sp_partition_id, # same partition id as the settlement parts
        False
    ))
    # sn_columns.remove("global_id")
    sn_columns.remove("version_id")
    sn_columns.remove("settlement_part")
    # sn_columns.remove("is_deleted")
    # sn_columns.remove("boundary_polygon")

    v_name_sql = (
        SQL(
            """
--Set settlement part on the primary name points            
WITH ver as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')
INSERT INTO {sn_table}
(
    version_id, settlement_part,
    {sn_cols}
)
SELECT 
    ver.id, sp.global_id,
    {sn_vals}
FROM {sn_view} n 
INNER JOIN 
    {sp_view} sp 
        ON ST_INTERSECTS(sp.geom, n.geom), ver 
WHERE sp.VERSION_id = ver.id 
    AND sp.split_type = 'auto_split_child'
    AND n.is_primary
    AND {sp_global_id} = ANY(sp.original_guids);
    ;
    
REFRESH MATERIALIZED VIEW {sn_view};

SELECT * FROM {sn_view} ORDER BY VERSION_ID DESC;
    """
        )
        .format(
            sn_table=GeneralDbNames.SCHEMA_SN.get_table_as_identifier(
                sp_partition_id, False
            ),
            sn_view=GeneralDbNames.SCHEMA_SN.get_table_as_identifier(
                sp_partition_id, True
            ),
            sp_view=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sp_partition_id, True
            ),
            sn_cols=SQL(", ").join([Identifier(c) for c in sn_columns]),
            sn_vals=SQL(", ").join([Identifier("n", c) for c in sn_columns]),
            sp_global_id=LiteralSql(sp_global_id),
        )
        .as_string()
    )

    sql_file.write(v_name_sql)


async def soft_delete_sp(
    sql_file: IO[str], conn: PoolConn, sp_global_id_list: List[uuid.UUID]
) -> None:

    _, _, sp_partition_id, _, _ = await get_sp_info(conn, sp_global_id_list[0])

    # soft delete the existing auto split children
    sp_columns = await get_column_names(
        conn, GeneralDbNames.SCHEMA_SP.get_table(sp_partition_id, False)
    )

    columns_to_set = [
        "version_id",
        "is_deleted",
    ]

    for c in columns_to_set:
        sp_columns.remove(c)

    sql = (
        SQL("""
/*    
WITH v as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')  
DELETE FROM {sp_table} USING v WHERE version_id = v.id;
*/

REFRESH MATERIALIZED VIEW {sp_view};

SELECT * FROM {sp_table} 
WHERE global_id IN ({sp_guids}) 
ORDER BY VERSION_ID DESC;

SELECT * FROM {sp_view} 
WHERE global_id IN ({sp_guids}) 
ORDER BY VERSION_ID DESC;   
        
    --soft delete a specific sp   
    WITH
    ver as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')   
    INSERT INTO {sp_table}
    (
        {columns_to_set},
        {other_columns}
    ) 
    SELECT 
        ver.id,
        True,
        {other_values}
    FROM ver, 
        {sp_view} spv 
    WHERE spv.global_id IN ({sp_guids}) ;
    
    REFRESH MATERIALIZED VIEW {sp_view};
            """)
        .format(
            columns_to_set=SQL(", ").join([Identifier(c) for c in columns_to_set]),
            other_columns=SQL(", ").join([Identifier(c) for c in sp_columns]),
            other_values=SQL(", ").join([Identifier("spv", c) for c in sp_columns]),
            sp_table=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sp_partition_id, False
            ),
            sp_view=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sp_partition_id, True
            ),
            sp_guids=SQL(", ").join([LiteralSql(g) for g in sp_global_id_list]),
        )
        .as_string()
    )

    sql_file.write(sql)


async def soft_delete_sn(
    sql_file: IO[str], conn: PoolConn, sn_global_id: uuid.UUID, sn_partition_id: Optional[int]
) -> None:

    if sn_partition_id is None:
        sn_info = await get_sn_info(conn, sn_global_id)
        sn_partition_id = sn_info.sn_partition_id

    # soft delete the existing auto split children
    sn_columns = await get_column_names(
        conn, GeneralDbNames.SCHEMA_SN.get_table(sn_partition_id, False)
    )

    columns_to_set = [
        "version_id",
        "is_deleted",
    ]

    for c in columns_to_set:
        sn_columns.remove(c)

    sql = (
        SQL("""
/*    
WITH v as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')  
DELETE FROM {sn_table} USING v WHERE version_id = v.id;
*/

REFRESH MATERIALIZED VIEW {sn_view};

SELECT * FROM {sn_table} 
WHERE global_id IN ({sn_guids}) 
ORDER BY VERSION_ID DESC;

SELECT * FROM {sn_view} 
WHERE global_id IN ({sn_guids}) 
ORDER BY VERSION_ID DESC;   

    --soft delete a specific sp   
    WITH
    ver as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')   
    INSERT INTO {sn_table}
    (
        {columns_to_set},
        {other_columns}
    ) 
    SELECT 
        ver.id,
        True,
        {other_values}
    FROM ver, 
        {sn_view} spv 
    WHERE spv.global_id IN ({sn_guids}) ;

    REFRESH MATERIALIZED VIEW {sn_view};
            """)
        .format(
            columns_to_set=SQL(", ").join([Identifier(c) for c in columns_to_set]),
            other_columns=SQL(", ").join([Identifier(c) for c in sn_columns]),
            other_values=SQL(", ").join([Identifier("spv", c) for c in sn_columns]),
            sn_table=GeneralDbNames.SCHEMA_SN.get_table_as_identifier(
                sn_partition_id, False
            ),
            sn_view=GeneralDbNames.SCHEMA_SN.get_table_as_identifier(
                sn_partition_id, True
            ),
            sn_guids=SQL(", ").join([LiteralSql(g) for g in [sn_global_id]]),
        )
        .as_string()
    )

    sql_file.write(sql)



async def soft_delete_ci(
    sql_file: IO[str], conn: PoolConn, ci_global_id: uuid.UUID
) -> None:

    ci_partition_id = await get_ci_info(conn, ci_global_id)

    # soft delete the existing auto split children
    ci_columns = await get_column_names(
        conn, GeneralDbNames.SCHEMA_CI.get_table(ci_partition_id, False)
    )

    columns_to_set = [
        "version_id",
        "is_deleted",
    ]

    for c in columns_to_set:
        ci_columns.remove(c)

    sql = (
        SQL("""
/*    
WITH v as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')  
DELETE FROM {ci_table} USING v WHERE version_id = v.id;
*/

REFRESH MATERIALIZED VIEW {ci_view};

SELECT * FROM {ci_table} 
WHERE global_id IN ({ci_guids}) 
ORDER BY VERSION_ID DESC;

SELECT * FROM {ci_view} 
WHERE global_id IN ({ci_guids}) 
ORDER BY VERSION_ID DESC;   

    --soft delete a specific sp   
    WITH
    ver as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')   
    INSERT INTO {ci_table}
    (
        {columns_to_set},
        {other_columns}
    ) 
    SELECT 
        ver.id,
        True,
        {other_values}
    FROM ver, 
        {ci_view} spv 
    WHERE spv.global_id IN ({ci_guids}) ;

    REFRESH MATERIALIZED VIEW {ci_view};
            """)
        .format(
            columns_to_set=SQL(", ").join([Identifier(c) for c in columns_to_set]),
            other_columns=SQL(", ").join([Identifier(c) for c in ci_columns]),
            other_values=SQL(", ").join([Identifier("spv", c) for c in ci_columns]),
            ci_table=GeneralDbNames.SCHEMA_CI.get_table_as_identifier(
                ci_partition_id, False
            ),
            ci_view=GeneralDbNames.SCHEMA_CI.get_table_as_identifier(
                ci_partition_id, True
            ),
            ci_guids=SQL(", ").join([LiteralSql(g) for g in [ci_global_id]]),
        )
        .as_string()
    )

    sql_file.write(sql)


async def switch_sp_boundary(sql_file: IO[str], conn: PoolConn, sn_info: SnInfo) -> None:
    # soft delete sp, and readd in sn's ward
    sp_columns = await get_column_names(
        conn, GeneralDbNames.SCHEMA_SP.get_table(sn_info.sp_partition_id, False)
    )

    columns_to_set = [
        "version_id",
        "boundary_polygon",
    ]

    for c in columns_to_set:
        sp_columns.remove(c)

    sql = (
        SQL("""
    --Add to new boundary
    SELECT * FROM {sp_table_old} 
    WHERE global_id = {sp_global_id} 
    ORDER BY VERSION_ID DESC;

    SELECT * FROM {sp_view_old} 
    WHERE global_id = {sp_global_id} 
    ORDER BY VERSION_ID DESC;  

    SELECT * FROM {sp_table_new} 
    WHERE global_id = {sp_global_id} 
    ORDER BY VERSION_ID DESC;

    SELECT * FROM {sp_view_new} 
    WHERE global_id = {sp_global_id} 
    ORDER BY VERSION_ID DESC;  

    WITH
        ver as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')   
    INSERT INTO {sp_table_new}
        (
            {columns_to_set},
            {other_columns}        
        ) 
        SELECT 
            ver.id,
            {boundary_polygon},
            {other_values}
        FROM ver, 
            {sp_view_old} spv 
        WHERE spv.global_id = {sp_global_id};

    REFRESH MATERIALIZED VIEW {sp_view_new};    
        """)
        .format(
            sp_view_new=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sn_info.sn_partition_id, True
            ),
            sp_table_new=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sn_info.sn_partition_id, False
            ),
            sp_view_old=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sn_info.sp_partition_id, True
            ),
            sp_table_old=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sn_info.sp_partition_id, False
            ),
            sp_global_id=LiteralSql(sn_info.sp_global_id),
            boundary_polygon=LiteralSql(sn_info.sn_boundary_polygon),
            columns_to_set=SQL(", ").join([Identifier(c) for c in columns_to_set]),
            other_columns=SQL(", ").join([Identifier(c) for c in sp_columns]),
            other_values=SQL(", ").join([Identifier("spv", c) for c in sp_columns]),
        )
        .as_string()
    )

    sql_file.write(sql)

async def clear_split_type_sp(
    sql_file: IO[str], conn: PoolConn, sp_global_id: uuid.UUID
) -> None:
    (
        sp_global_id,
        sp_version_id,
        sp_partition_id,
        sp_boundary_polygon,
        sp_type,
    ) = await get_sp_info(conn, sp_global_id)

    # soft delete the existing auto split children
    sp_columns = await get_column_names(
        conn, GeneralDbNames.SCHEMA_SP.get_table(sp_partition_id, False)
    )

    columns_to_set = [
        "version_id",
        "is_deleted",
        "split_type"
    ]

    for c in columns_to_set:
        sp_columns.remove(c)

    sql = (
        SQL("""
--setting split type        
/*    
WITH v as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')  
DELETE FROM {sp_table} USING v WHERE version_id = v.id;
*/

REFRESH MATERIALIZED VIEW {sp_view};

SELECT * FROM {sp_table} 
WHERE global_id IN ({sp_guids}) 
ORDER BY VERSION_ID DESC;

SELECT * FROM {sp_view} 
WHERE global_id IN ({sp_guids}) 
ORDER BY VERSION_ID DESC;        

    --soft delete a specific sp   
    WITH
    ver as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')   
    INSERT INTO {sp_table}
    (
        {columns_to_set},
        {other_columns}
    ) 
    SELECT 
        ver.id,
        False,
        'none', 
        {other_values}
    FROM ver, 
        {sp_view} spv 
    WHERE spv.global_id IN ({sp_guids}) ;
    
    REFRESH MATERIALIZED VIEW {sp_view};
            """)
        .format(
            columns_to_set=SQL(", ").join([Identifier(c) for c in columns_to_set]),
            other_columns=SQL(", ").join([Identifier(c) for c in sp_columns]),
            other_values=SQL(", ").join([Identifier("spv", c) for c in sp_columns]),
            sp_table=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sp_partition_id, False
            ),
            sp_view=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sp_partition_id, True
            ),
            sp_guids=SQL(", ").join([LiteralSql(g) for g in [sp_global_id]]),
        )
        .as_string()
    )

    sql_file.write(sql)


async def set_settlement_name_part(
    sql_file: IO[str],
    conn: PoolConn,
    sn_global_id: uuid.UUID,
    is_primary: bool,
) -> None:
    """
    ALso handles case where intersecting sp is in another boundary
    """

    sn_info = await get_sn_info(conn, sn_global_id)

    log.info(
        f"Setting settlement part for name: [{sn_info.sn_partition_id}] [{sn_info.sp_partition_id}]"
    )
    if sn_info.sp_partition_id != sn_info.sn_partition_id and isinstance(sn_info.sp_partition_id, int):

        await switch_sp_boundary(sql_file, conn, sn_info)

        await soft_delete_sp(sql_file, conn, [sn_info.sp_global_id])

    sn_columns = await get_column_names(conn, GeneralDbNames.SCHEMA_SN.get_table(
        sn_info.sn_partition_id, # same partition id as the settlement parts
        False
    ))

    columns_to_set = [
        "version_id",
        "settlement_part",
        "is_primary"
    ]

    for c in columns_to_set:
        sn_columns.remove(c)

    sql = (
        SQL(
            """
--Set settlement part on the primary name points            
WITH ver as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')
INSERT INTO {sn_table}
(
    {columns_to_set},
    {sn_cols}
)
SELECT 
    ver.id, sp.global_id, {is_primary},
    {sn_vals}
FROM {sn_view} n 
INNER JOIN 
    {sp_view} sp 
        ON ST_INTERSECTS(sp.geom, n.geom), ver 
WHERE n.global_id = {sn_global_id};
        
SELECT * FROM {sn_table} 
WHERE global_id = {sn_global_id} 
ORDER BY VERSION_ID DESC;

SELECT * FROM {sn_view} 
WHERE global_id = {sn_global_id} 
ORDER BY VERSION_ID DESC;                
        
REFRESH MATERIALIZED VIEW {sn_view};

SELECT * FROM {sn_view} ORDER BY VERSION_ID DESC;
    """
        )
        .format(
            sn_table=GeneralDbNames.SCHEMA_SN.get_table_as_identifier(
                sn_info.sn_partition_id, False
            ),
            sn_view=GeneralDbNames.SCHEMA_SN.get_table_as_identifier(
                sn_info.sn_partition_id, True
            ),
            sp_view=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                sn_info.sn_partition_id, True
            ),
            columns_to_set=SQL(", ").join([Identifier(c) for c in columns_to_set]),
            sn_cols=SQL(", ").join([Identifier(c) for c in sn_columns]),
            sn_vals=SQL(", ").join([Identifier("n", c) for c in sn_columns]),
            sn_global_id=LiteralSql(sn_global_id),
            is_primary=LiteralSql(is_primary),
        )
        .as_string()
    )

    sql_file.write(sql)