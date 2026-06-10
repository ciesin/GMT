import os
import shlex
from pathlib import Path

from lib import file_utils
from lib.thread_utils import run_process_stream_output
from scripts.export_module.db_constants import *
import scripts.export_module.indicator_constants as ic

def export_db_geom_to_files(export_dir: Path):
    """
    Exports all the indicator views to shapefiles
    as well as the context layers (boundaries)
    """

    set_short_name_map = ic.build_set_short_name_map()
    hf_short_name_map = ic.build_hf_short_name_map()
    b_short_name_map = ic.build_b_short_name_map()

    file_utils.remove_dir(export_dir, export_dir.parent)

    ogr_conn_str = f"PG: host='{os.environ['DB_HOST']}' " \
           f"port='{os.environ['DB_PORT']}' " \
           f"dbname='{os.environ['DB_NAME']}' " \
           f"user='{os.environ['DB_USER']}' " \
           f"password='{os.environ['DB_PASSWORD']}' "

    ###############################################################################################
    export_file_path = export_dir / "settlements.gdb"

    for idx, ind_name in enumerate(set_short_name_map):
        view_name = set_short_name_map[ind_name]

        export_to_gdb(idx, export_file_path, ogr_conn_str, view_name)

    export_to_gdb(1, export_file_path, ogr_conn_str, TABLE_SETTLEMENT_PARTS + "_before_pilot")
    export_to_gdb(1, export_file_path, ogr_conn_str, TABLE_SETTLEMENT_PARTS + "_after_pilot")
    
    export_to_gdb(1, export_file_path, ogr_conn_str, VIEW_SETTLEMENTS)
    
    ###############################################################################################
    export_file_path = export_dir / "health_facilities.gdb"

    for idx, ind_name in enumerate(hf_short_name_map):
        view_name = hf_short_name_map[ind_name]

        export_to_gdb(idx, export_file_path, ogr_conn_str, view_name)
    
    export_to_gdb(1, export_file_path, ogr_conn_str, TABLE_CATCHMENT_POLYGONS + "_before_pilot")
    export_to_gdb(1, export_file_path, ogr_conn_str, TABLE_CATCHMENT_POLYGONS + "_after_pilot")
    
    export_to_gdb(1, export_file_path, ogr_conn_str, VIEW_HEALTH_FACILITIES_FIXED_POST)
    export_to_gdb(1, export_file_path, ogr_conn_str, VIEW_HEALTH_FACILITIES_OUTREACH)
    
    ###############################################################################################
    export_file_path = export_dir / "boundary_edits.gdb"

    for idx, ind_name in enumerate(b_short_name_map):
        view_name = b_short_name_map[ind_name]

        export_to_gdb(idx, export_file_path, ogr_conn_str, view_name)
    
    export_to_gdb(1, export_file_path, ogr_conn_str, VIEW_BOUNDARY_ADJ_DIFF, "MULTIPOLYGON")
    ###############################################################################################
    for idx, table_name in enumerate([TABLE_STATES, TABLE_LGAS, TABLE_WARDS]):
        export_file_path = export_dir / "boundary.gdb"

        export_to_gdb(idx, export_file_path, ogr_conn_str, table_name)

def export_to_gdb(idx, export_file_path: Path, ogr_conn_str: str, view_name: str, geom_type: Union[None,str] = None):
    export_file_path.parent.mkdir(exist_ok=True, parents=True)

    cmd_parts = [
        'ogr2ogr',
        "-progress",
        "-f FileGDB",
        f"-oo ACTIVE_SCHEMA={SCHEMA_EXPORT}",
        f"\"{export_file_path}\"",
        shlex.quote(ogr_conn_str),
        shlex.quote(view_name)
    ]

    if geom_type is not None:
        cmd_parts.append(f"-nlt {geom_type}")

    if idx > 0:
        cmd_parts.append("-append")

    cmd_line = " ".join(cmd_parts)
    print(f"Running\n{cmd_line}")
    run_process_stream_output(cmd_line, cwd="/rust")
