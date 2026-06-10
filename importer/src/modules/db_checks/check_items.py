from psycopg.sql import SQL, Literal as SqlLiteral
from typing import Union, Optional, IO
import sys
from lib.async_db_utils import PoolConn, fetch_log
from lib.logger_utils import get_logger
from modules.db_checks.db_constants import DbCheckNames
from modules.db_checks.fixes import (
    fixes_dup,
    fixes_parts_without_primary_name,
    fixes_part_name_boundary_mismatch,
)
from modules.db_checks.report_results import run_problem_query
from modules.exporter_shared.gmt_db_objects import GeneralDbNames


log = get_logger(__name__)


async def check_parts_many_pns(conn: PoolConn) -> bool:
    log.info("Check parts with many primary names")
    sql = SQL("""
SELECT 
    b.b1_name as state_name, b.b2_name as lga_name, b.b3_name as ward_name,
    sp.global_id as sp_global_id
FROM {sp} sp
    INNER JOIN {boundary} b 
        ON sp.boundary_polygon = b.global_id
    INNER JOIN {sn} sn1 on sn1.settlement_part = sp.global_id
    INNER JOIN {sn} sn2 on sn2.settlement_part = sp.global_id
WHERE
    NOT b.is_surrounding
    AND sn1.is_primary
    and sn2.is_primary
    and sn1.global_id != sn2.global_id
    """).format(
        sp=DbCheckNames.SP.as_identifier(),
        boundary=DbCheckNames.BOUNDARY.as_identifier(),
        sn=DbCheckNames.SN.as_identifier(),
    )
    return await run_problem_query(conn, sql, "Multiple names to a part")


async def check_dups(conn: PoolConn, fixes_sql_file: Optional[IO[str]]) -> bool:
    check_description = "Check dups; same global_id in different boundary partitions"
    log.info(check_description)

    ok = True
    for table in [
        DbCheckNames.SN,
        DbCheckNames.CI,
        DbCheckNames.SP,
        DbCheckNames.HF,
    ]:
        sql = SQL("""
--t1 is the one to delete
SELECT {table_name} as schema_table, t1.global_id,
        t1.version_id as t1_version_id, t1.boundary_polygon as t1_boundary_polygon,
        t2.version_id as t2_version_id, t2.boundary_polygon as t2_boundary_polygon,
        b.partition_id 
FROM {table} t1
INNER JOIN {table} t2 
    ON t1.global_id = t2.global_id 
        AND t2.boundary_polygon != t1.boundary_polygon
        AND t1.version_id < t2.version_id
INNER JOIN {boundary} b ON b.global_id = t1.boundary_polygon        
        ;
    
            """).format(
            table_name=SqlLiteral(str(table)),
            table=table.as_identifier(),
            commits=GeneralDbNames.COMMITS.as_identifier(),
            boundary=DbCheckNames.BOUNDARY.as_identifier(),
        )

        loop_ok = (
            await run_problem_query(
                conn,
                sql,
                check_description,
            )
        )

        if not loop_ok and fixes_sql_file:
            await fixes_dup(fixes_sql_file, sql.as_string(), conn, table)

        ok = ok and loop_ok

    return ok


async def check_parts_without_a_name(conn: PoolConn, sql_file: IO[str],) -> bool:
    check_desc = "Parts without a primary name"
    log.info(check_desc)

    sql = SQL("""
SELECT
    b.b1_name as b1_name, b.b2_name as b2_name, 
    b.b3_name as b3_name,
    b.global_id as b3_guid,  
    sp.global_id as sp_global_id,
    sp.version_id as sp_version_id,
    b.partition_id
FROM {sp} sp
INNER JOIN {boundary} b 
    ON sp.boundary_polygon = b.global_id
WHERE 
    NOT b.is_surrounding
    AND sp.split_type != 'auto_split_parent'
    AND NOT EXISTS (
        SELECT 1 FROM {sn} sn
        WHERE sn.settlement_part = sp.global_id
            AND sn.is_primary
    )

    """).format(
        sp=DbCheckNames.SP.as_identifier(),
        boundary=DbCheckNames.BOUNDARY.as_identifier(),

        sn=DbCheckNames.SN.as_identifier(),
    )
    ok = await run_problem_query(conn, sql, check_desc)

    if not ok and sql_file:
        await fixes_parts_without_primary_name(sql_file, sql.as_string(), conn)

    return ok



async def check_part_name_boundary_mismatch(conn: PoolConn, sql_file: IO[str],) -> bool:
    check_desc = "Parts whose attributed boundary does not match"
    log.info(check_desc)

    sql = SQL("""
SELECT
    b_sn.b1_name as b1_name, 
    b_sn.b2_name as b2_name, 
    b_sn.b3_name as b3_name,
    b_sn.global_id as b3_guid,  
    sp.global_id as sp_global_id,
    sp.version_id as sp_version_id,
    sn.global_id as sn_global_id,
    sn.version_id as sn_version_id,
    b_sp.partition_id as sp_partition_id,
    b_sn.partition_id as sn_partition_id
FROM {sp} sp
INNER JOIN {boundary} b_sp 
    ON sp.boundary_polygon = b_sp.global_id
INNER JOIN {sn} sn
    ON sn.settlement_part = sp.global_id
        AND sn.is_primary
        AND sn.boundary_polygon != sp.boundary_polygon     
INNER JOIN {boundary} b_sn
    ON sn.boundary_polygon = b_sn.global_id
WHERE 
    NOT b_sn.is_surrounding
    AND sp.split_type != 'auto_split_parent'
    

    """).format(
        sp=DbCheckNames.SP.as_identifier(),
        boundary=DbCheckNames.BOUNDARY.as_identifier(),

        sn=DbCheckNames.SN.as_identifier(),
    )
    ok = await run_problem_query(conn, sql, check_desc)

    if not ok and sql_file:
        await fixes_part_name_boundary_mismatch(sql_file, sql.as_string(), conn)

    return ok


async def check_names_without_a_part(conn: PoolConn, sql_file: IO[str],) -> bool:
    check_desc = "Names without a part"
    log.info(check_desc)

    sql = SQL("""
SELECT
    b_sn.b1_name as b1_name, 
    b_sn.b2_name as b2_name, 
    b_sn.b3_name as b3_name,
    b_sn.global_id as b3_guid,  
    sn.global_id as sn_global_id,
    sn.version_id as sn_version_id,
    b_sn.partition_id as sn_partition_id,
    sp.global_id as sp_global_id,
    sp.version_id as sp_version_id,
    b_sp.partition_id as sp_partition_id
FROM {sn} sn
INNER JOIN {boundary} b_sn 
    ON sn.boundary_polygon = b_sn.global_id
LEFT JOIN {sp} sp
    ON ST_Intersects(sn.geom, sp.geom)    
        AND sp.split_type != 'auto_split_parent'
LEFT JOIN {boundary} b_sp 
    ON sp.boundary_polygon = b_sp.global_id
WHERE 
    NOT b_sn.is_surrounding
    AND sn.is_primary
    AND NOT EXISTS (
        SELECT 1 FROM {sp} sp
        WHERE sn.settlement_part = sp.global_id            
    )

    """).format(
        sp=DbCheckNames.SP.as_identifier(),
        boundary=DbCheckNames.BOUNDARY.as_identifier(),

        sn=DbCheckNames.SN.as_identifier(),
    )
    ok = await run_problem_query(conn, sql, check_desc)

    # if not ok:
        # log.info(f"\n{sql.as_string()}")
        # sys.exit(0)

    return ok


async def check_missing_split_parent(conn: PoolConn) -> bool:
    check_desc = "Checks split_parent exists"
    log.info(check_desc)
    sql = SQL("""  
    --Parents are checked without version history so need the distinct  
SELECT 
    b.b1_name as state_name, b.b2_name as lga_name, b.b3_name as ward_name, sn.name,
    sp_child.boundary_polygon,
    sp_child.global_id, 
    sp_child.split_parent, 

    --if these fields are blank then no parent exists
    sp_parent.version_id, 
    sp_parent.is_deleted, 
    sp_parent.boundary_polygon as parent_bguid,
    
    b_id.id as boundary_partition_id
FROM {sp} sp_child
INNER JOIN {boundary} b 
    ON sp_child.boundary_polygon = b.global_id
INNER JOIN {b_id} b_id
    ON b_id.global_id = sp_child.boundary_polygon
LEFT JOIN {sp} sp_parent ON
    sp_parent.global_id = sp_child.split_parent
LEFT JOIN {sn} sn ON sn.settlement_part = sp_child.global_id   AND sn.is_primary
WHERE sp_child.split_parent is not null
    AND NOT b.is_surrounding
    AND ( sp_parent.global_id IS NULL OR sp_parent.global_id = sp_child.global_id)
    """).format(
        boundary=DbCheckNames.BOUNDARY.as_identifier(),
        sp=DbCheckNames.SP.as_identifier(),
        sn=DbCheckNames.SN.as_identifier(),
        b_id=GeneralDbNames.BOUNDARY_ID.as_identifier(),
    )

    # log.debug(sql.as_string())
    # sys.exit(0)

    return await run_problem_query(conn, sql, check_desc)


async def check_split_parent_no_children(conn: PoolConn) -> bool:
    check_desc = "Check split_parent no children"
    log.info(check_desc)
    sql = SQL("""  
    --Parents are checked without version history so need the distinct  
SELECT 
    b.b1_name as state_name, b.b2_name as lga_name, b.b3_name as ward_name, 
    sp_parent.global_id, 
    b.global_id as boundary_polygon,
    b_id.id as boundary_partition_id,
    ST_X(ST_Centroid(sp_parent.geom)) as lon_x,
    ST_Y(ST_Centroid(sp_parent.geom)) as lat_y,
    sp_parent.version_id
FROM {sp} sp_parent
INNER JOIN {boundary} b 
    ON sp_parent.boundary_polygon = b.global_id
INNER JOIN {b_id} b_id
    ON b_id.global_id = sp_parent.boundary_polygon
WHERE NOT b.is_surrounding
    AND sp_parent.split_type = 'auto_split_parent'
    AND NOT EXISTS (
        SELECT 1 FROM {sp} 
        WHERE sp.split_type = 'auto_split_child'
            AND sp.split_parent = sp_parent.global_id 
    )
    """).format(
        boundary=DbCheckNames.BOUNDARY.as_identifier(),
        sp=DbCheckNames.SP.as_identifier(),
        b_id=GeneralDbNames.BOUNDARY_ID.as_identifier(),
    )

    # Used to auto gen the fixes
    if False:
        await auto_gen_split_parent_no_children(conn)
        # log.debug(sql.as_string())

    return await run_problem_query(conn, sql, check_desc)


async def auto_gen_split_parent_no_children(conn: PoolConn) -> None:
    sql = (
        SQL("""  
                --Parents are checked without version history so need the distinct  
            SELECT 
                b_id.id as boundary_partition_id,
                ARRAY_AGG(sp_parent.global_id) as to_soft_del            
            FROM {sp} sp_parent
            INNER JOIN {boundary} b 
                ON sp_parent.boundary_polygon = b.global_id
            INNER JOIN {b_id} b_id
                ON b_id.global_id = sp_parent.boundary_polygon
            WHERE NOT b.is_surrounding
                AND sp_parent.split_type = 'auto_split_parent'
                AND NOT EXISTS (
                    SELECT 1 FROM {sp} 
                    WHERE sp.split_type = 'auto_split_child'
                        AND sp.split_parent = sp_parent.global_id 
                )
            GROUP BY b_id.id
                """)
        .format(
            boundary=DbCheckNames.BOUNDARY.as_identifier(),
            sp=DbCheckNames.SP.as_identifier(),
            b_id=GeneralDbNames.BOUNDARY_ID.as_identifier(),
        )
        .as_string()
    )

    recs = await fetch_log(conn, sql)

    all_sql = ""
    for r in recs:
        log.info(f"Hello {r[0]} -- {r[1]}")
        partition_id = r[0]
        g_ids = [f"'{u}'" for u in r[1]]
        to_print = f"""
                --soft delete split parent with no children 
    WITH ver as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')
    INSERT INTO partitions_settlement_part.settlement_part_{partition_id:05}
    (
        global_id, version_id, is_deleted, boundary_polygon, 
        "comments", geom, "type", computed_pop, 
        split_type, split_parent, original_guids, 
        raster_width, raster_height, origin_x, origin_y, 
        raster, is_fixed_post, is_outreach, bbox, properties
    )
    SELECT global_id, ver.id, True, 
    boundary_polygon, "comments", geom, "type", computed_pop, 
    split_type, split_parent, original_guids, raster_width, raster_height, 
    origin_x, origin_y, raster, is_fixed_post, is_outreach, bbox, properties
    FROM partitions_settlement_part.settlement_part_{partition_id:05}_latest sp, ver 
    WHERE global_id IN (
        {", ".join(g_ids)}
    );

    REFRESH MATERIALIZED VIEW partitions_settlement_part.settlement_part_{partition_id:05}_latest;
                """

        all_sql += to_print

    log.info(all_sql)

    if len(recs) > 0:
        sys.exit(0)


async def check_split_parent_no_name(conn: PoolConn) -> bool:
    check_desc = "Checks split_parent should have no names associated with it"
    log.info(check_desc)
    sql = SQL("""  
    --Parents are checked without version history so need the distinct  
SELECT 
    b.b1_name as state_name, b.b2_name as lga_name, b.b3_name as ward_name, 
    ST_X(ST_Centroid(sp_parent.geom)) as lon_x,
    ST_Y(ST_Centroid(sp_parent.geom)) as lat_y,
    (
        SELECT count(*) FROM {sn} sn 
        WHERE sn.settlement_part = sp_parent.global_id
        AND sn.is_primary
    ) as count_pn,
    (
        SELECT count(*) FROM {sn} sn 
        WHERE sn.settlement_part = sp_parent.global_id
        AND NOT sn.is_primary
    ) as count_non_pn,    
    sp_parent.version_id
FROM {sp} sp_parent
INNER JOIN {boundary} b 
    ON sp_parent.boundary_polygon = b.global_id
WHERE NOT b.is_surrounding
    AND sp_parent.split_type = 'auto_split_parent'
    AND EXISTS (
        SELECT 1 FROM {sn} sn 
        WHERE sn.settlement_part = sp_parent.global_id and sn.is_primary
    )
    """).format(
        boundary=DbCheckNames.BOUNDARY.as_identifier(),
        sp=DbCheckNames.SP.as_identifier(),
        sn=DbCheckNames.SN.as_identifier(),
    )

    # log.debug(sql.as_string())
    # sys.exit(0)

    return await run_problem_query(conn, sql, check_desc)


async def check_excluded_included(conn: PoolConn) -> bool:
    log.info("Checks custom included settlements that were then excluded")

    sql = SQL("""
        
SELECT
    b.b1_name as state_name, b.b2_name as lga_name, b.b3_name as ward_name,  
    hf.name as hf_name,
    ci_exc.global_id as ci_guid, 
    ci_exc.boundary_polygon as b_guid,
    sp.global_id as sp_guid
FROM {sp} sp
INNER JOIN {boundary} b 
    ON sp.boundary_polygon = b.global_id
INNER JOIN {ci} ci_inc
    ON ci_inc.settlement_part = sp.global_id AND ci_inc.type = 'include'
INNER JOIN {ci} ci_exc
    ON ci_inc.settlement_part = sp.global_id AND ci_inc.type = 'exclude'    
INNER JOIN {hf} hf
    --Any exclude counts, hf does not need to match 
    ON hf.global_id = ci_inc.health_facility_point
WHERE NOT b.is_surrounding    
    
    

        """).format(
        ci=DbCheckNames.CI.as_identifier(),
        hf=DbCheckNames.HF.as_identifier(),
        sp=DbCheckNames.SP.as_identifier(),
        boundary=DbCheckNames.BOUNDARY.as_identifier(),
    )

    return await run_problem_query(conn, sql, "Include/Exclude same settlement part")


async def check_version_id(conn: PoolConn) -> bool:
    log.info("Checks the version_id has an entry in the master commits table")
    ok = True
    for table in [
        DbCheckNames.SN,
        DbCheckNames.CI,
        DbCheckNames.SP,
        DbCheckNames.HF,
    ]:
        sql = SQL("""
        SELECT {table_name} as schema_table, t.global_id, t.version_id, t.boundary_polygon
        FROM {table} t
        LEFT JOIN {commits} c
            ON c.id = t.version_id
        WHERE c.id IS NULL
        """).format(
            table_name=SqlLiteral(str(table)),
            table=table.as_identifier(),
            commits=GeneralDbNames.COMMITS.as_identifier(),
        )

        if table == DbCheckNames.CI:
            sql = SQL("""
                    SELECT {table_name} as schema_table, t.global_id, t.version_id, t.boundary_polygon
                    FROM {table} t
                    LEFT JOIN {commits} c
                        ON c.id = t.version_id
                    WHERE c.id IS NULL  
                        AND t.type != 'generated'
                    """).format(
                table_name=SqlLiteral(str(table)),
                table=table.as_identifier(),
                commits=GeneralDbNames.COMMITS.as_identifier(),
            )

        ok = (
            await run_problem_query(
                conn,
                sql,
                "Version ids that have no matching entry in master commits table",
            )
            and ok
        )

    return ok


async def check_dangling_ci(conn: PoolConn) -> bool:
    log.info("Checks ci sp and hf links point to something")



    sql = SQL("""
    
SELECT 
    b.b1_name as state_name, b.b2_name as lga_name, b.b3_name as ward_name,
    hf_parent.name as fixed_post_name, hf.name as outreach_name,
    b.global_id as boundary_guid, 
    hf.global_id as outreach_guid,
    hf_parent.global_id as fp_guid,
    ci.global_id as ci_dangling,
    ci.settlement_part,
    ci.type
FROM {ci} ci
LEFT JOIN {hf} hf
    ON ci.health_facility_point = hf.global_id
left join {hf} hf_parent 
    on hf.parent = hf_parent.global_id 
inner join {boundary} b 
    on ci.boundary_polygon = b.global_id 
left join {sp} sp 
    ON sp.global_id = ci.settlement_part
where 
    (sp.global_id IS NULL
    OR hf.global_id IS NULL)
    and b.is_surrounding is False
    AND ci.type != 'generated'
    
ORDER BY b.b1_name, b2_name, b3_name, hf.name


    """).format(
        ci=DbCheckNames.CI.as_identifier(),
        hf=DbCheckNames.HF.as_identifier(),
        sp=DbCheckNames.SP.as_identifier(),
        boundary=DbCheckNames.BOUNDARY.as_identifier(),
    )

    # if True:
    #     await auto_gen_dangling_ci_fix(conn)

    return await run_problem_query(conn, sql, "Dangling Includes")


async def auto_gen_dangling_ci_fix(conn: PoolConn) -> None:
    sql = (
        SQL("""
    
SELECT 
    b_id.id as boundary_partition_id,
    ARRAY_AGG(ci.global_id) as to_soft_del                
FROM {ci} ci
LEFT JOIN {hf} hf
    ON ci.health_facility_point = hf.global_id
inner join {boundary} b 
    on ci.boundary_polygon = b.global_id 
inner join {b_id} b_id     
    on ci.boundary_polygon = b_id.global_id
left join {sp} sp 
    ON sp.global_id = ci.settlement_part
where 
    (sp.global_id IS NULL
    OR hf.global_id IS NULL)
    and b.is_surrounding is False
    AND ci.type != 'generated'
GROUP BY b_id.id
    """)
        .format(
            boundary=DbCheckNames.BOUNDARY.as_identifier(),
            sp=DbCheckNames.SP.as_identifier(),
            ci=DbCheckNames.CI.as_identifier(),
            hf=DbCheckNames.HF.as_identifier(),
            b_id=GeneralDbNames.BOUNDARY_ID.as_identifier(),
        )
        .as_string()
    )

    recs = await fetch_log(conn, sql)

    all_sql = ""
    for r in recs:
        log.info(f"Hello {r[0]} -- {r[1]}")
        partition_id = r[0]
        g_ids = [f"'{u}'" for u in r[1]]
        to_print = f"""
            --Dangling ci includes
WITH ver as (
    SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch'
)            
INSERT INTO partitions_ri_catchment_item.ri_catchment_item_{partition_id:05}
(is_deleted, global_id, version_id, settlement_part,
 boundary_polygon, geom, 
health_facility_point, population_perc, properties, "type")
SELECT True, global_id, ver.id, settlement_part,
 boundary_polygon, geom, 
health_facility_point, population_perc, properties, "type"
FROM partitions_ri_catchment_item.ri_catchment_item_{partition_id:05}_latest
, ver 
WHERE global_id IN (
        {", ".join(g_ids)}
    );

    REFRESH MATERIALIZED VIEW partitions_ri_catchment_item.ri_catchment_item_{partition_id:05}_latest;
                """

        all_sql += to_print

    log.info(all_sql)

    if len(recs) > 0:
        sys.exit(0)


async def check_ci_boundary(conn: PoolConn) -> bool:
    log.info("Checks all include/exclude ci items have same boundary as their hf")

    # include/exclude are owned by the boundary of the hf
    # generated owned by the boundary of the sp
    sql = SQL("""
    
select 
    b_hf.b1_name as state_name, 
    b_hf.b2_name as lga_name, 
    b_hf.b3_name as ward_name,
    b_sp.b1_name as state_name_sp, 
    b_sp.b2_name as lga_name_sp, 
    b_sp.b3_name as ward_name_sp,  
    b_ci.b1_name as state_name_ci, 
    b_ci.b2_name as lga_name_ci, 
    b_ci.b3_name as ward_name_ci,
    ci.type as ci_type,
    hf.name as hf_name,
    hf.global_id as hf_guid,
    ci.global_id as ci_guid,
    b_hf.partition_id as hf_partition_id,
    b_ci.partition_id as ci_partition_id
FROM {ci} ci
INNER JOIN {hf} hf 
    ON hf.global_id = ci.health_facility_point
INNER JOIN {sp} sp
    ON sp.global_id = ci.settlement_part        
INNER JOIN {boundary} b_ci
    ON ci.boundary_polygon = b_ci.global_id
INNER JOIN {boundary} b_hf 
    ON hf.boundary_polygon = b_hf.global_id    
INNER JOIN {boundary} b_sp 
    ON sp.boundary_polygon = b_sp.global_id
WHERE
    NOT b_hf.is_surrounding
    AND ( 
        (ci.type = 'generated' AND sp.boundary_polygon != ci.boundary_polygon)
        OR 
        (ci.type != 'generated' AND hf.boundary_polygon != ci.boundary_polygon)    
    )
ORDER BY b_hf.b1_name, b_hf.b2_name, b_hf.b3_name, hf.name

    """).format(
        ci=DbCheckNames.CI.as_identifier(),
        hf=DbCheckNames.HF.as_identifier(),
        sp=DbCheckNames.SP.as_identifier(),
        boundary=DbCheckNames.BOUNDARY.as_identifier(),
    )

    return await run_problem_query(conn, sql, "ci boundary")


async def check_names_missing_sp_in_boundary(dest_conn: PoolConn) -> bool:
    check_desc = "Check names with a settlement part share attributed boundary"
    log.info(check_desc)

    sql = SQL("""
SELECT 
    b.b1_name as b1_name, 
    b.b2_name as b2_name, 
    b.b3_name as b3_name,
    sn.name as sn_name,
    sn.global_id as sn_guid,
    sn.settlement_part,
    sp.global_id as sp_guid,
    sp.boundary_polygon as sp_boundary_polygon,
    sn.boundary_polygon as sn_boundary_polygon,
    sn.is_primary
FROM {sn} sn
INNER JOIN {boundary} b 
    ON sn.boundary_polygon = b.global_id
LEFT JOIN {sp} sp
    ON sn.settlement_part = sp.global_id
WHERE 
    NOT b.is_surrounding
    --We should not have primary names w/o a settlement part
    --AND sn.settlement_part IS NOT NULL 
    AND sn.is_primary --ok for non primary names to not match as when they do get promoted, the boundary is set
    AND 
    (
        sp.global_id IS NULL --meaning left join was empty 
        OR sn.boundary_polygon != sp.boundary_polygon
    )
;
    """).format(
        boundary=DbCheckNames.BOUNDARY.as_identifier(),
        sp=DbCheckNames.SP.as_identifier(),
        sn=DbCheckNames.SN.as_identifier(),
    )
    return await run_problem_query(dest_conn, sql, check_desc)
