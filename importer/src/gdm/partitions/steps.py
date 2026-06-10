import logging
import os
import queue
from functools import partial
from typing import List, Union

from lib.thread_utils import run_process_stream_output

from lib import db_utils, file_utils, thread_utils
from config import Config as cfg, check_clean_work_file, check_clean_work_dir

log = logging.getLogger(__name__)

def step_partition(conn):
    """
    We want to create a table with an integer so we can burn that into a raster
    """

    if cfg.CLEAN:
        db_utils.drop_schema(conn, cfg.PARTITION_SCHEMA_SETTLEMENT_PART)
        db_utils.drop_schema(conn, cfg.PARTITION_SCHEMA_SETTLEMENT_NAME)
        db_utils.drop_schema(conn, cfg.PARTITION_SCHEMA_RI_CATCHMENT_ITEM)
        db_utils.drop_schema(conn, cfg.PARTITION_SCHEMA_HEALTH_FACILITY_POINT)
        db_utils.drop_schema(conn, cfg.SCHEMA_NAME)

    if cfg.CLEAN and db_utils.table_exists(conn, cfg.SCHEMA_NAME,
                                           cfg.TABLE_BOUNDARY_ID):
        return

    db_utils.create_schema(conn, cfg.SCHEMA_NAME)

    db_utils.run_sql(conn, f"""
    CREATE TABLE {cfg.SCHEMA_NAME}.{cfg.TABLE_BOUNDARY_ID}
    (
        id SERIAL PRIMARY KEY,
        global_id uuid NOT NULL 
    );
    
    COMMENT ON TABLE {cfg.SCHEMA_NAME}.{cfg.TABLE_BOUNDARY_ID} IS 'Lookup table to know which partition contains which global id';
    
    INSERT INTO {cfg.SCHEMA_NAME}.{cfg.TABLE_BOUNDARY_ID}
    (global_id)
    SELECT global_id FROM
    boundary.polygon_latest
    ORDER BY level, global_Id DESC
    """)

    db_utils.create_index(conn, cfg.SCHEMA_NAME, cfg.TABLE_BOUNDARY_ID, "global_id", False)

def step_partition_settlement_parts(conn):
    """
    Partition settlement parts
    """

    do_partition_table(conn,
                       create_table_sql=f"""
    create table {cfg.SCHEMA_NAME}.{cfg.TABLE_SETTLEMENT_PART}
  (    
  LIKE settlement.part INCLUDING ALL EXCLUDING INDEXES EXCLUDING IDENTITY    
  )
 PARTITION BY LIST (boundary_polygon);

comment on column {cfg.SCHEMA_NAME}.{cfg.TABLE_SETTLEMENT_PART}.original_guids is 'When a settlement part is merged, this field contains the global_ids that were merged, as well as their original_ids, if any';

comment on column {cfg.SCHEMA_NAME}.{cfg.TABLE_SETTLEMENT_PART}.raster_width is 'The width of the sub raster, aligned to the pop raster.  The bit varying fields will be raster_width*raster_height # of bits';

comment on column {cfg.SCHEMA_NAME}.{cfg.TABLE_SETTLEMENT_PART}.origin_x is 'Origin (top/left) corner of this rasterized settlement part';

                    """,
                       from_schema = "settlement",
                       from_table="part",
                       partition_schema = cfg.PARTITION_SCHEMA_SETTLEMENT_PART,
                       partition_parent_table = cfg.TABLE_SETTLEMENT_PART)


def step_partition_settlement_names(conn):
    """
    Partition settlement names
    """

    do_partition_table(conn,
                       create_table_sql=f"""
    create table {cfg.SCHEMA_NAME}.{cfg.TABLE_SETTLEMENT_NAME}
(
    LIKE settlement.name INCLUDING ALL EXCLUDING INDEXES EXCLUDING IDENTITY    
) PARTITION BY LIST (boundary_polygon);
                    """,
                       from_schema = "settlement",
                       from_table="name",
                       partition_schema = cfg.PARTITION_SCHEMA_SETTLEMENT_NAME,
                       partition_parent_table = cfg.TABLE_SETTLEMENT_NAME)


def step_partition_ri(conn):
    """
    Partition ri tables
    """
    do_partition_table(conn,
                       create_table_sql=f"""
    create table {cfg.SCHEMA_NAME}.{cfg.TABLE_RI_CATCHMENT_ITEM}
(
    global_id             uuid                                                             NOT NULL,
    version_id            bigint                                                           NOT NULL,
    is_deleted            boolean               DEFAULT false                              NOT NULL,
    boundary_polygon      uuid                                                             NOT NULL,
    geom                  geometry(Point, 4326)                                            NOT NULL,
    settlement_part       uuid                                                             NOT NULL,
    health_facility_point uuid                                                             NOT NULL,    
    population_perc       real                  DEFAULT 100.0                              NOT NULL,
    properties            jsonb                 DEFAULT '{{}}'::jsonb                      NOT NULL,
    type                  ci_type               DEFAULT 'generated'::ci_type               NOT NULL
) PARTITION BY LIST (boundary_polygon);
                    """,
                       from_schema = None,
                       from_table = None,
                       partition_schema = cfg.PARTITION_SCHEMA_RI_CATCHMENT_ITEM,
                       partition_parent_table = cfg.TABLE_RI_CATCHMENT_ITEM)


def step_partition_hf(conn):
    """
    Partition health facilities, assumes there is data in the original table (does not use _latest)
    but partions all historical data too from health_facility.point to
    partitions_health_facility_point
    """

    do_partition_table(conn,
                       create_table_sql=f"""    
    create table {cfg.SCHEMA_NAME}.{cfg.TABLE_HEALTH_FACILITY_POINT}
(
  LIKE health_facility.point INCLUDING ALL EXCLUDING INDEXES EXCLUDING IDENTITY
    
) PARTITION BY LIST (boundary_polygon);
                    """,
                       from_schema = "health_facility",
                       from_table="point",
                       partition_schema = cfg.PARTITION_SCHEMA_HEALTH_FACILITY_POINT,
                       partition_parent_table = cfg.TABLE_HEALTH_FACILITY_POINT)

def do_partition_table(
        conn,
        create_table_sql: str,
        from_schema: Union[str, None], from_table: Union[str, None],
        partition_schema: str, partition_parent_table: str):


    if cfg.CLEAN:
        db_utils.drop_schema(conn, partition_schema)
        db_utils.drop_table(conn, cfg.SCHEMA_NAME, partition_parent_table)

    
    if from_schema and from_table:
      db_utils.create_index(conn, from_schema, from_table, "boundary_polygon", False)

    owner = os.environ["DB_USER"]

    sql = f"""
    ALTER TABLE {cfg.SCHEMA_NAME}.{partition_parent_table} OWNER TO {owner};
    """

    db_utils.run_sql(conn, create_table_sql)
    db_utils.run_sql(conn, sql)

    boundary_id_guid = db_utils.get_results(conn, f"""
    SELECT p.id, p.global_id 
    FROM {cfg.SCHEMA_NAME}.{cfg.TABLE_BOUNDARY_ID} p
    ORDER BY id
    """)

    db_utils.create_schema(conn, partition_schema)

    column_names = db_utils.get_column_names(conn, cfg.SCHEMA_NAME, partition_parent_table)

    task_queue = queue.Queue()

    for boundary_int_id, boundary_global_id in boundary_id_guid:

        partition_table = f"{partition_parent_table}_{boundary_int_id:05d}"

        task_queue.put(partial(create_partition,
                               from_schema_table = None if not from_schema else f"{from_schema}.{from_table}",                               
                               partition_parent_table = partition_parent_table,
                               partition_schema = partition_schema,
                               partition_table = partition_table,
                               partition_boundary_global_id = boundary_global_id,
                               column_names = column_names
                               ))

    thread_utils.finish_database_threads(cfg.util_cfg, task_queue, 4)


def create_partition(from_schema_table : Union[str, None],
                     
                     partition_parent_table : str,
                     partition_schema : str,
                     partition_table : str,
                     partition_boundary_global_id,
                     column_names : List[str],
                     connection):

    column_names_str = ", ".join(column_names)
    #quoted_column_names_str = ", ".join([f"column_names)

    sql = f"""
    CREATE TABLE {partition_schema}.{partition_table}
    PARTITION OF {cfg.SCHEMA_NAME}.{partition_parent_table} 
    FOR VALUES IN ('{partition_boundary_global_id}');
    """

    db_utils.run_sql(connection, sql, suppress_logging=True)  
    
    if from_schema_table:
      sql = f"""
      INSERT INTO {partition_schema}.{partition_table} 
      (
          {column_names_str}   
      )
      SELECT {column_names_str} 
      FROM {from_schema_table}
      WHERE boundary_polygon = '{partition_boundary_global_id}';
      """

      db_utils.run_sql(connection, sql, suppress_logging=True)


    db_utils.create_index(connection, partition_schema, partition_table, "global_id", False, False)
    db_utils.create_index(connection, partition_schema, partition_table, "version_id", False, False)

    mat_view_name = f"{partition_table}_latest"
    sql = f"""
    
CREATE MATERIALIZED VIEW {partition_schema}.{mat_view_name} AS
SELECT {column_names_str}
FROM
(
    SELECT DISTINCT ON (global_id) 
        {column_names_str}
    FROM {partition_schema}.{partition_table}
    ORDER BY global_id, version_id DESC
) sq WHERE is_deleted IS False ;
    """

    db_utils.run_sql(connection, sql, suppress_logging=True)

    db_utils.create_index(connection, partition_schema, mat_view_name, "global_id", False, False)
    db_utils.create_index(connection, partition_schema, mat_view_name, "version_id", False, False)
    db_utils.create_index(connection, partition_schema, mat_view_name, "boundary_polygon", False, False)

def step_calculate_catchments(conn):
    """
    Seeds database with coverage data
    """

    b_rows = [r[0] for r in db_utils.get_results(conn, f"""
    SELECT p.global_id, 1 FROM 
    {cfg.SCHEMA_NAME}.{cfg.TABLE_BOUNDARY_ID} p 
    INNER JOIN 
    boundary.polygon_latest b on b.global_id = p.global_id
    INNER JOIN 
        boundary.polygon_latest b2 on b2.global_id = b.boundary_polygon
    INNER JOIN 
        boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
    where b.level = {cfg.BOUNDARY_OPERATING_LEVEL}
    AND b.geom is not null
    AND NOT ST_IsEmpty(b.geom)
    AND (b.properties->'is_gva')::bool IS NOT TRUE 
    ORDER BY b.global_id
   
    """)]

    conn.close()

    rust_cmd_parts = [
        'cargo',
        'build',
        '--release',
        '--bin calc_boundary_data',
    ]

    rust_cmd = ' '.join(rust_cmd_parts)

    run_process_stream_output(rust_cmd, cwd="/rust")

    # b_rows = b_rows[6085:]

    for idx, boundaryGuid in enumerate(b_rows):
        log.info(f"Processing {idx+1}/{len(b_rows)}")
        rust_cmd_parts = [
            './calc_boundary_data',
            f"--log-level \"info\"",
            'calc-boundary-data',
            '--gmt-database-pg-conn',
            f'"{db_utils.get_sql_alchemy_connection_string(cfg.util_cfg)}"',
            '--pop-raster',
            f'"{cfg.POP_RASTER_4326}"',
            '--boundary-guid',
            f'"{boundaryGuid}"',
            # We compute everything since for the indicators we need the settlement pops up to date as well
            #'--only-boundary'
        ]

        #task_queue.put(partial(
        run_process_stream_output(
            ' '.join(rust_cmd_parts),
            cwd="/rust/target/release")

        #tq_count += 1

    #thread_utils.finish_threads_with_context(task_queue, None, 1, tq_count)

    conn = db_utils.create_db_connection(cfg.util_cfg)

    db_utils.run_sql(conn, """
    REFRESH MATERIALIZED VIEW boundary.polygon_latest
    """, )


def step_aggregrate_settlements(conn):
    """
    Experimental step
    """

    b_rows = [r[0] for r in db_utils.get_results(conn, f"""
    SELECT p.global_id, 1 FROM 
    {cfg.SCHEMA_NAME}.{cfg.TABLE_BOUNDARY_ID} p 
    INNER JOIN 
    boundary.polygon_latest b on b.global_id = p.global_id
    where b.level = {cfg.BOUNDARY_OPERATING_LEVEL}
    --and p.global_id = 'f1d983ec-9d7a-4f22-9584-d6654b64b18b'
    """)]

    conn.close()

    rust_cmd_parts = [
        'cargo',
        'build',
        '--release',
        '--bin agg_settlements',
    ]

    rust_cmd = ' '.join(rust_cmd_parts)

    run_process_stream_output(rust_cmd, cwd="/rust")

    task_queue = queue.Queue()

    tq_count = 0

    for boundaryGuid in b_rows:
        rust_cmd_parts = [
            './agg_settlements',
            f"--log-level \"info\"",
            'agg-settlements',
            '--gmt-database-pg-conn',
            f'"{db_utils.get_sql_alchemy_connection_string(cfg.util_cfg)}"',
            '--boundary-guid',
            f'"{boundaryGuid}"',
        ]

        task_queue.put(partial(
            run_process_stream_output,
            ' '.join(rust_cmd_parts),
            cwd="/rust/target/release"))

        tq_count += 1

    thread_utils.finish_threads_with_context(task_queue, None, 4, tq_count)


def step_clean_db(conn):
    """
    Cleans the database of any modifications made by hand
    """
    boundary_id_guid = db_utils.get_results(conn, f"""
        SELECT id, global_id 
        FROM {cfg.SCHEMA_NAME}.{cfg.TABLE_BOUNDARY_ID}
        --where global_id in ('f1d983ec-9d7a-4f22-9584-d6654b64b18b', '451f339f-a467-4ca4-952c-fbc528b8da0c')
        """)

    # found by inspecting commits table
    version_id = 41122

    for boundary_int_id, boundary_global_id in boundary_id_guid:

        log.info(f"Cleaning {boundary_int_id} -- guid {boundary_global_id}")

        hf_p = f"{cfg.PARTITION_SCHEMA_HEALTH_FACILITY_POINT}.{cfg.TABLE_HEALTH_FACILITY_POINT}_{boundary_int_id:05d}"
        sp_p = f"{cfg.PARTITION_SCHEMA_SETTLEMENT_PART}.{cfg.TABLE_SETTLEMENT_PART}_{boundary_int_id:05d}"
        sn_p = f"{cfg.PARTITION_SCHEMA_SETTLEMENT_NAME}.{cfg.TABLE_SETTLEMENT_NAME}_{boundary_int_id:05d}"
        ri_p = f"{cfg.PARTITION_SCHEMA_RI_CATCHMENT_ITEM}.{cfg.TABLE_RI_CATCHMENT_ITEM}_{boundary_int_id:05d}"


        sql = f"""
DELETE FROM {hf_p} WHERE version_id >= {version_id};
REFRESH MATERIALIZED VIEW {hf_p}_latest;

DELETE FROM {sn_p} WHERE version_id >= {version_id};
REFRESH MATERIALIZED VIEW {sn_p}_latest;

DELETE FROM {sp_p} WHERE version_id >= {version_id};
REFRESH MATERIALIZED VIEW {sp_p}_latest;

DELETE FROM {ri_p} WHERE version_id >= {version_id};
REFRESH MATERIALIZED VIEW {ri_p}_latest;
        
        """

        # TRUNCATE TABLE {ri_p};
# TRUNCATE TABLE {rp_p};

# REFRESH MATERIALIZED VIEW {ri_p}_latest;
# REFRESH MATERIALIZED VIEW {rp_p}_latest;

        db_utils.run_sql(conn, sql)

    #db_utils.run_sql(conn, f"DELETE FROM partitions.boundary_id where version_id >= {version_id};")

    #db_utils.run_sql(conn, f"ALTER SEQUENCE partitions.boundary_id_id_seq RESTART WITH {version_id};")

def step_debug_sp(conn):
    """
    Checks for wards with no names, no hf, no sp
    Creates a reporting table
    """
    boundary_id_guid = db_utils.get_results(conn, f"""
        SELECT id, global_id 
        FROM {cfg.SCHEMA_NAME}.{cfg.TABLE_BOUNDARY_ID}
        """)

    db_utils.drop_table(conn, "partitions", "partition_rowcounts")

    db_utils.run_sql(conn, f"""
    CREATE TABLE partitions.partition_rowcounts (
        boundary_int int,
        boundary_guid uuid,
        hf_count int,
        sp_count int,
        sn_count int
    )
    """)

    for boundary_int_id, boundary_global_id in boundary_id_guid:

        log.info(f"What up {boundary_int_id} -- guid {boundary_global_id}")

        hf_p = f"{cfg.PARTITION_SCHEMA_HEALTH_FACILITY_POINT}.{cfg.TABLE_HEALTH_FACILITY_POINT}_{boundary_int_id:05d}"
        sp_p = f"{cfg.PARTITION_SCHEMA_SETTLEMENT_PART}.{cfg.TABLE_SETTLEMENT_PART}_{boundary_int_id:05d}"
        sn_p = f"{cfg.PARTITION_SCHEMA_SETTLEMENT_NAME}.{cfg.TABLE_SETTLEMENT_NAME}_{boundary_int_id:05d}"

        sql = f"""
WITH hf_count AS 
(
    SELECT COUNT(*) as c FROM {hf_p}
), sp_count AS 
(
    SELECT COUNT(*) as c FROM {sp_p}
), sn_count AS 
(
    SELECT COUNT(*) as c FROM {sn_p}
)
INSERT INTO partitions.partition_rowcounts 
(boundary_int, boundary_guid, hf_count, sp_count, sn_count)
SELECT {boundary_int_id}, '{boundary_global_id}',
    hf_count.c, sp_count.c, sn_count.c
FROM hf_count, sp_count, sn_count;
      
        
        """

        db_utils.run_sql(conn, sql)