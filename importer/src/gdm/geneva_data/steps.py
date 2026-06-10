import logging
from pathlib import Path
import queue
from functools import partial
from typing import List

from lib.thread_utils import run_process_stream_output

from lib import db_utils, file_utils, thread_utils
from config import Config as cfg, check_clean_work_file, check_clean_work_dir

log = logging.getLogger(__name__)

def step_import_raw_data(conn):
    """
    We want to create a table with an integer so we can burn that into a raster
    """

    if cfg.CLEAN:
        db_utils.drop_schema(conn, cfg.SCHEMA_GENEVA_RAW_DATA)
        
    
    db_utils.create_schema(conn, cfg.SCHEMA_GENEVA_RAW_DATA)

    label_points = Path("/data") / "europe" / "COMM_LB_2016_4326" / "COMM_LB_2016_4326.shp"
    
    cmd_parts = [
        'ogr2ogr',
        f"-lco SCHEMA={cfg.SCHEMA_GENEVA_RAW_DATA}",
        "-lco GEOMETRY_NAME=geom",
        "-nln labels",
        "-progress",
        f'PG:"{db_utils.get_ogr_connection_string(cfg.util_cfg)}"',
        f"\"{label_points}\"",
        
    ]


    ogr2ogr_cmd = ' '.join(cmd_parts)

    run_process_stream_output(ogr2ogr_cmd, cwd="/rust")

    

    regions = Path("/data") / "europe" / "COMM_RG_01M_2016_4326" / "COMM_RG_01M_2016_4326.shp"
    
    cmd_parts = [
        'ogr2ogr',
        f"-lco SCHEMA={cfg.SCHEMA_GENEVA_RAW_DATA}",
        "-lco GEOMETRY_NAME=geom",
        "-nln region",
        "-nlt MULTIPOLYGON",
        "-nlt PROMOTE_TO_MULTI",
        "-progress",
        f'PG:"{db_utils.get_ogr_connection_string(cfg.util_cfg)}"',
        f"\"{regions}\"",
        
    ]


    ogr2ogr_cmd = ' '.join(cmd_parts)

    run_process_stream_output(ogr2ogr_cmd, cwd="/rust")

    nuts = Path("/data") / "europe" / "NUTS_RG_01M_2021_4326" / "NUTS_RG_01M_2021_4326.shp"
    
    cmd_parts = [
        'ogr2ogr',
        f"-lco SCHEMA={cfg.SCHEMA_GENEVA_RAW_DATA}",
        "-lco GEOMETRY_NAME=geom",
        "-nln nuts",
        "-nlt MULTIPOLYGON",
        "-nlt PROMOTE_TO_MULTI",        
        "-progress",
        f'PG:"{db_utils.get_ogr_connection_string(cfg.util_cfg)}"',
        f"\"{nuts}\"",
        
    ]


    ogr2ogr_cmd = ' '.join(cmd_parts)

    run_process_stream_output(ogr2ogr_cmd, cwd="/rust")

def step_import_hf(conn):
    """
    health facilities
    """

    hf_points = Path("/data") / "europe" / "FR.geojson"
    
    cmd_parts = [
        'ogr2ogr',
        f"-lco SCHEMA={cfg.SCHEMA_GENEVA_RAW_DATA}",
        "-lco OVERWRITE=YES",
        "-lco GEOMETRY_NAME=geom",
        "-nlt POINT",
        "-explodecollections",
        "-nln hf",
        "-progress",
        f'PG:"{db_utils.get_ogr_connection_string(cfg.util_cfg)}"',
        f"\"{hf_points}\"",        
    ]

    ogr2ogr_cmd = ' '.join(cmd_parts)

    run_process_stream_output(ogr2ogr_cmd, cwd="/rust")

    hf_points = Path("/data") / "europe" / "CH.geojson"
    
    cmd_parts = [
        'ogr2ogr',        
        "-append",
        "-update",
        f"-nln {cfg.SCHEMA_GENEVA_RAW_DATA}.hf",
        "-nlt POINT",
        "-explodecollections",
        "-progress",
        f'PG:"{db_utils.get_ogr_connection_string(cfg.util_cfg)}"',
        f"\"{hf_points}\"",        
    ]


    ogr2ogr_cmd = ' '.join(cmd_parts)

    run_process_stream_output(ogr2ogr_cmd, cwd="/rust")

    db_utils.run_sql(conn, f"""
        DELETE FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.hf d WHERE
        NOT EXISTS 
        (
            SELECT 1 FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.nuts n 
            WHERE n.levl_code = 3 AND ST_INTERSECTS(n.geom, d.geom)
        )
    """)

def step_populate_hf_table(conn):
    """
    Populates HF table
    """
    db_utils.run_sql(conn, f"""
    DELETE FROM health_facility.point d 
    WHERE (d.properties->'is_gva')::bool IS TRUE 
    
    """)

    last_version = db_utils.get_single_value(conn, f"""
    SELECT id from master.commits ORDER BY ID DESC
    """)

    db_utils.run_sql(conn, f"""
    INSERT INTO health_facility.point (
        global_id, 
        version_id, 
        properties, 
        boundary_polygon,
        geom,        
        name,
        type,
        services
    )
    SELECT 
        uuid_generate_v4(), 
        {last_version}, 
        '{{"is_gva":true}}'::json,
        p.global_id,
        h.geom,
        h.hospital_name,
        'fixed_post',
        ARRAY['Routine Immunization']::hf_services[]
    FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.hf h 
    INNER JOIN boundary.polygon_latest p ON (p.properties->'is_gva')::bool IS TRUE AND ST_Intersects(p.geom, h.geom) AND p.level = 3    
    """)

    db_utils.run_sql(conn, f"""
    REFRESH MATERIALIZED VIEW health_facility.point_latest
    """)


def step_prune_raw_data(conn):
    """
    Prunes to leave only GVA & FR
    """

    db_utils.run_sql(conn, f"""
    DELETE FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.nuts
    WHERE cntr_code NOT IN ('CH', 'FR')
    """)

    db_utils.run_sql(conn, f"""
    DELETE FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.nuts
    WHERE cntr_code = 'FR'
    AND levl_code = 1
    AND nuts_id NOT IN ('FRC', 'FRK')
    """)

    db_utils.run_sql(conn, f"""
    DELETE FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.nuts
    WHERE cntr_code = 'FR'
    AND levl_code = 3
    AND nuts_id NOT IN ('FRK28', 'FRK21')
    """)

    db_utils.run_sql(conn, f"""
    DELETE FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.nuts
    WHERE cntr_code = 'CH'
    AND levl_code = 3
    AND nuts_id NOT IN ('CH011', 'CH013')
    """)

   
    db_utils.run_sql(conn, f"""
    DELETE FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.region
    WHERE cntr_code NOT IN ('CH', 'FR')
    """)

    db_utils.create_index(conn, cfg.SCHEMA_GENEVA_RAW_DATA, "region", "geom", True)
    

    db_utils.run_sql(conn, f"""
        DELETE FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.region d WHERE
        NOT EXISTS 
        (
            SELECT 1 FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.nuts n 
            WHERE n.levl_code = 3 AND ST_INTERSECTS(n.geom, d.geom)
        )
    """)

    db_utils.run_sql(conn, f"""
        DELETE FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.nuts d WHERE
        NOT EXISTS 
        (
            SELECT 1 FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.nuts n 
            WHERE n.levl_code = 3 AND ST_INTERSECTS(n.geom, d.geom)
        )
    """)

    db_utils.run_sql(conn, f"""
        DELETE FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.labels d WHERE
        NOT EXISTS 
        (
            SELECT 1 FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.nuts n 
            WHERE n.levl_code = 3 AND ST_INTERSECTS(n.geom, d.geom)
        )
    """)

def step_populate_boundary_table(conn):
    """
    Populates the boundary table
    """

    db_utils.run_sql(conn, f"""
    DELETE FROM boundary.polygon_simplified s 
    WHERE EXISTS (
        SELECT 1 FROM boundary.polygon p
        WHERE (p.properties->'is_gva')::bool IS TRUE 
        AND p.global_id = s.global_id
    )
    """)

    db_utils.run_sql(conn, f"""
    DELETE FROM boundary.polygon
    WHERE (properties->'is_gva')::bool IS TRUE 
    """)

    

    last_version = db_utils.get_single_value(conn, f"""
    SELECT id from master.commits ORDER BY ID DESC
    """)

    db_utils.run_sql(conn, f"""
    INSERT INTO boundary.polygon (
        global_id, 
        version_id, 
        properties, 
        boundary_polygon,
        geom,
        level,
        name,
        code
    )
    SELECT 
        uuid_generate_v4(), 
        {last_version}, 
        '{{"is_gva":true}}'::json,
        '3eba1f03-98d4-4335-804e-6c3f9e7d5da1', -- UUID of nigeria level 0
        geom,
        1,
        n.nuts_name,
        n.nuts_id
    FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.nuts n 
    WHERE n.levl_code = 1
    """)

    db_utils.run_sql(conn, f"""
    INSERT INTO boundary.polygon (
        global_id, 
        version_id, 
        properties, 
        boundary_polygon,
        geom,
        level,
        name,
        code
    )
    SELECT 
        uuid_generate_v4(), 
        {last_version}, 
        '{{"is_gva":true}}'::json,
        p.global_id,
        n.geom,
        2,
        n.nuts_name,
        n.nuts_id
    FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.nuts n 
    INNER JOIN boundary.polygon p ON (p.properties->'is_gva')::bool IS TRUE AND starts_with(n.nuts_id, p.code) AND p.level = 1
    WHERE n.levl_code = 2
    """)

    db_utils.run_sql(conn, f"""
    INSERT INTO boundary.polygon (
        global_id, 
        version_id, 
        properties, 
        boundary_polygon,
        geom,
        level,
        name,
        code
    )
    SELECT 
        uuid_generate_v4(), 
        {last_version}, 
        '{{"is_gva":true}}'::json,
        p.global_id,
        n.geom,
        3,
        n.nuts_name,
        n.nuts_id
    FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.nuts n 
    INNER JOIN boundary.polygon p ON (p.properties->'is_gva')::bool IS TRUE AND starts_with(n.nuts_id, p.code) AND p.level = 2
    WHERE n.levl_code = 3
    """)

    

    db_utils.run_sql(conn, f"""
    INSERT INTO boundary.polygon_simplified (global_id, boundary_polygon, geom, name, level)
    SELECT global_id, boundary_polygon, geom, name, level FROM 
    boundary.polygon p 
    WHERE (p.properties->'is_gva')::bool IS TRUE
    """)

    db_utils.run_sql(conn, f"""
    REFRESH MATERIALIZED VIEW boundary.polygon_simplified_latest;
    """)

    db_utils.run_sql(conn, f"""
    REFRESH MATERIALIZED VIEW boundary.polygon_latest;
    """)

def step_create_europe_raster(conn):
    """
    Creates 100m european raster
    """

    merged_ref_raster = Path("/data") / "rasters" / "input" / "europe" / "ref_merged.tif"

    fr_input = merged_ref_raster.parent / "fra_px_area_100m.tif"
    # https://hub.worldpop.org/geodata/summary?id=23728
    ch_input = merged_ref_raster.parent / "che_px_area_100m.tif"

    if not check_clean_work_file(cfg, merged_ref_raster):

        cmd_parts = [
            "gdal_merge.py",
            f"-o \"{merged_ref_raster}\"",
            f"\"{fr_input}\"",
            f"\"{ch_input}\"",
        ]

        cmd = ' '.join(cmd_parts)

        run_process_stream_output(cmd, cwd="/rust")
     
    # JRC https://ec.europa.eu/eurostat/web/gisco/geodata/reference-data/population-distribution-demography/geostat

    input = merged_ref_raster.parent / "JRC_1K_POP_2018.tif"

    resampled = merged_ref_raster.parent / "eu_pop_4326.tif"

    if not check_clean_work_file(cfg, resampled):
        cmd_parts = [
            "cargo",
            "run",
            "--release",
            "--bin=raster_resample",
            '--',
            f'--input="{input}"',
            f'--output="{resampled}"',
            f'--snap="{merged_ref_raster}"',
        ]

        if cfg.CLEAN:
            cmd_parts.append('--clean')

        cmd = ' '.join(cmd_parts)

        run_process_stream_output(cmd, cwd="/rust")


def step_populate_settlement_tables(conn):
    """
    Populates the settlement part table
    """

    db_utils.run_sql(conn, f"""
    DELETE FROM settlement.part
    WHERE (properties->'is_gva')::bool IS TRUE 
    """)


    last_version = db_utils.get_single_value(conn, f"""
    SELECT id from master.commits ORDER BY ID DESC
    """)

    db_utils.run_sql(conn, f"""
    INSERT INTO settlement.part (
        global_id, 
        version_id, 
        properties, 
        boundary_polygon,
        geom,
        type
        
    )
    SELECT 
        uuid_generate_v4(), 
        {last_version}, 
        '{{"is_gva":true}}'::json,
        p.global_id,
        r.geom,
        'bua'
    FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.region r     
    INNER JOIN boundary.polygon_latest p ON (p.properties->'is_gva')::bool IS TRUE AND ST_Intersects(p.geom, ST_Centroid(r.geom)) AND p.level = 3    
    """)

    
    db_utils.run_sql(conn, f"""
    REFRESH MATERIALIZED VIEW settlement.part_latest;
    """)

    db_utils.run_sql(conn, f"""
    INSERT INTO settlement.name (
        global_id, 
        version_id, 
        properties, 
        boundary_polygon,
        geom,
        name,
        settlement_part,
        is_primary,
        uninhabited,
        population_perc
    )
    SELECT 
        uuid_generate_v4(), 
        {last_version}, 
        '{{"is_gva":true}}'::json,
        p.boundary_polygon,
        n.geom,
        n.comm_name,
        p.global_id,
        True,
        False,
        100.0
    FROM {cfg.SCHEMA_GENEVA_RAW_DATA}.labels n 
    INNER JOIN settlement.part_latest p ON (p.properties->'is_gva')::bool IS TRUE AND ST_Intersects(p.geom, n.geom)
    
    """)

   

    db_utils.run_sql(conn, f"""
    REFRESH MATERIALIZED VIEW settlement.name_latest;
    """)

  

def step_calc_boundary_data(conn):
    """
    Recalcs boundary stats
    """

    results = db_utils.get_results(conn, f"""
    SELECT global_id FROM boundary.polygon
    WHERE (properties->'is_gva')::bool IS TRUE AND level = 3
    """)

    global_ids = [r[0] for r in results]

    rust_cmd_parts = [
        'cargo',
        'build',
        '--release',
        '--bin calc_boundary_data',
    ]

    rust_cmd = ' '.join(rust_cmd_parts)

    run_process_stream_output(rust_cmd, cwd="/rust")

    task_queue = queue.Queue()

    tq_count = 0

    eu_pop_raster_path = Path("/data") / "rasters" / "input" / "europe" / "eu_pop_4326.tif"

    for boundaryGuid in global_ids:

        rust_cmd_parts = [
            './calc_boundary_data',
            f"--log-level \"info\"",
            'calc-boundary-data',
            '--gmt-database-pg-conn',
            f'"{db_utils.get_sql_alchemy_connection_string(cfg.util_cfg)}"',
            '--pop-raster',
            f'"{eu_pop_raster_path}"',
            '--boundary-guid',
            f'"{boundaryGuid}"',
            #'--only-boundary'
        ]

        task_queue.put(partial(
            run_process_stream_output,
            ' '.join(rust_cmd_parts),
            cwd="/rust/target/release"))

        tq_count += 1

    thread_utils.finish_threads_with_context(task_queue, None, 1, tq_count)

    conn = db_utils.create_db_connection(cfg.util_cfg)

    db_utils.run_sql(conn, """
    REFRESH MATERIALIZED VIEW boundary.polygon_latest
    """, )

def step_create_partitions(conn):
    """
    Creates partitions for the Geneva data
    """

    nga_max_boundary_id = 10222
    
    db_utils.run_sql(conn, f"DELETE FROM partitions.boundary_id WHERE id > {nga_max_boundary_id}")

    

    results = db_utils.get_results(conn, f"""
    SELECT global_id FROM boundary.polygon
    WHERE (properties->'is_gva')::bool IS TRUE AND level = 3
    ORDER BY global_id
    """)

    boundary_global_ids = [r[0] for r in results]


    # normal max is 10222
    # starting boundary_id is 10223

    db_utils.run_sql(conn, f"ALTER SEQUENCE partitions.boundary_id_id_seq RESTART WITH {1+nga_max_boundary_id}")

    for idx, boundary_global_id in enumerate(boundary_global_ids):

        # Insert boundary id 
        db_utils.run_sql(conn, f"""
        INSERT INTO partitions.boundary_id (global_id)
        VALUES ('{boundary_global_id}')
        """
        )
        

        create_partition(
            conn,
            from_schema = "health_facility",
            from_table = "point",
            boundary_global_id=boundary_global_id,
            boundary_int_id = idx + 1 + nga_max_boundary_id,
            partition_parent_table = cfg.TABLE_HEALTH_FACILITY_POINT,
            partition_schema = cfg.PARTITION_SCHEMA_HEALTH_FACILITY_POINT
        )
        # there is no ri.catchment_item table so we base it off the partition parent instead
        create_partition(
            conn,
            from_schema = "partitions",
            from_table = "ri_catchment_item",
            boundary_global_id=boundary_global_id,
            boundary_int_id = idx + 1 + nga_max_boundary_id,
            partition_parent_table = cfg.TABLE_RI_CATCHMENT_ITEM,
            partition_schema = cfg.PARTITION_SCHEMA_RI_CATCHMENT_ITEM
        )
        create_partition(
            conn,
            from_schema = "settlement",
            from_table = "name",
            boundary_global_id=boundary_global_id,
            boundary_int_id = idx + 1 + nga_max_boundary_id,
            partition_parent_table = cfg.TABLE_SETTLEMENT_NAME,
            partition_schema = cfg.PARTITION_SCHEMA_SETTLEMENT_NAME
        )
        create_partition(
            conn,
            from_schema = "settlement",
            from_table = "part",
            boundary_global_id=boundary_global_id,
            boundary_int_id = idx + 1 + nga_max_boundary_id,
            partition_parent_table = cfg.TABLE_SETTLEMENT_PART,
            partition_schema = cfg.PARTITION_SCHEMA_SETTLEMENT_PART
        )

        

def create_partition(conn, from_schema, from_table, boundary_global_id, boundary_int_id, partition_parent_table, partition_schema, ):
    column_names = db_utils.get_column_names(conn, from_schema, from_table)

    if len(column_names) == 0:
        raise Exception(f"No columns found in {from_schema}.{from_table}")

    partition_table = f"{partition_parent_table}_{boundary_int_id:05d}"

    column_names_str = ", ".join(column_names)
#quoted_column_names_str = ", ".join([f"column_names)

    sql = f"""
    DROP TABLE IF EXISTS {partition_schema}.{partition_table} CASCADE;

    CREATE TABLE {partition_schema}.{partition_table}
    PARTITION OF partitions.{partition_parent_table} 
    FOR VALUES IN ('{boundary_global_id}');
    
    INSERT INTO {partition_schema}.{partition_table} 
    (
        {column_names_str}   
    )
    SELECT {column_names_str} 
    FROM {from_schema}.{from_table}
    WHERE boundary_polygon = '{boundary_global_id}'
    ;
    """

    # log.info(sql)
    db_utils.run_sql(conn, sql, suppress_logging=True)

    db_utils.create_index(conn, partition_schema, partition_table, "global_id", False, False)
    db_utils.create_index(conn, partition_schema, partition_table, "version_id", False, False)

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

    db_utils.run_sql(conn, sql, suppress_logging=True)

    db_utils.create_index(conn, partition_schema, mat_view_name, "global_id", False, False)
    db_utils.create_index(conn, partition_schema, mat_view_name, "version_id", False, False)
    db_utils.create_index(conn, partition_schema, mat_view_name, "boundary_polygon", False, False)