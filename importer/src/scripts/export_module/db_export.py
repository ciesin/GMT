###
# This is a pre/post pilot export done with indicators
# and a view of each indicator showing the exact data matching each one
#
import os
from typing import Tuple, List

import psycopg2
import psycopg2.extensions
import psycopg2.extras

from lib import db_utils
from lib.thread_utils import run_process_stream_output
from scripts.create_views import create_helper_views
from scripts.export_module.boundary.tables import create_boundary_tables_and_populate, create_boundary_edit_tables
from scripts.export_module.boundary.views import create_boundary_edit_views
from scripts.export_module.db_constants import BoundaryRow
from scripts.export_module.hf.inserts import add_before_pilot_hf, add_after_pilot_hf, add_grid3_geopode_hf, \
    add_catchments
from scripts.export_module.hf.tables import create_hf_tables, create_catchment_table
from scripts.export_module.hf.views import create_hf_indicator_views, \
    create_view_health_facilities_fixed_post_after_pilot, create_view_health_facilities_outreach_after_pilot
from scripts.export_module.settlement.adjust import trim_geopode_settlements, remove_changed_boundary_from_deleted, \
    add_set_indexes
from scripts.export_module.settlement.inserts import add_geopode_settlements, add_before_pilot_gmt_settlements, \
    add_current_gmt_settlements, add_deleted_demoted_gmt_settlements
from scripts.export_module.settlement.tables import create_settlement_tables
from scripts.export_module.settlement.views import create_settlement_indicator_views, \
    create_view_settlements_after_pilot

from scripts.export_module.db_constants import *
import scripts.export_module.indicator_constants as ic



# Assume all data from prod has been xfered to local
def db_connect() -> Tuple[psycopg2.extensions.connection, psycopg2.extensions.connection]:
    conn = psycopg2.connect(
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"]
    )

    # the training db has the baseline data, see
    # importer/scripts/clean_training.sh
    baseline_conn = psycopg2.connect(
        dbname=os.environ["BASELINE_DB_NAME"],
        user=os.environ["BASELINE_DB_USER"],
        password=os.environ["BASELINE_DB_PASSWORD"],
        host=os.environ["BASELINE_DB_HOST"],
        port=os.environ["BASELINE_DB_PORT"]
    )
    
    
    # support local only
    assert os.environ["DB_NAME"] == "gmt"
    assert os.environ["DB_HOST"] == "db"
    
    return conn, baseline_conn

def recalc_boundary_catchment(b_guid):
    """
"""
    cmd_line_parts = [
        "cargo run --release --bin calc_boundary_data",
        "-- --log-level \"debug\" calc-boundary-data",
        "--gmt-database-pg-conn",
        "postgresql://${BASELINE_DB_USER}:${BASELINE_DB_PASSWORD}@${BASELINE_DB_HOST}:${BASELINE_DB_PORT}/${BASELINE_DB_NAME}",
        "--pop-raster \"/data/rasters/input/pop_4326.tif\"",
        f"--boundary-guid \"{b_guid}\""
    ]

    run_process_stream_output(" ".join(cmd_line_parts), cwd = "/rust")


def get_boundaries_to_calc(conn: psycopg2.extensions.connection) -> List[BoundaryRow]:
    sql = f"""
    
select w.ward_guid, 
      bid.id as partition_id
       from
       {SCHEMA_EXPORT}.{TABLE_WARDS} w 
inner join partitions.boundary_id bid on bid.global_id = w.ward_guid

"""

    with conn.cursor(cursor_factory=psycopg2.extras.NamedTupleCursor) as cur:
        cur.execute(sql)

        return cur.fetchall() # type: ignore
    
    
def export_to_schema():
    """
    Assumes local database has the production data
    Creates an export schema with some base tables and the indicators as views
    """

    conn, baseline_conn = db_connect()

    set_short_name_map = ic.build_set_short_name_map()
    hf_short_name_map = ic.build_hf_short_name_map()
    # b_short_name_map = ic.build_b_short_name_map()

    db_utils.drop_schema(conn, SCHEMA_EXPORT)

    with conn.cursor() as cur:
        sql = f"""
        DROP TYPE IF EXISTS export_tag;
        """
        cur.execute(sql)
        conn.commit()

    create_settlement_tables(conn)
    create_hf_tables(conn)

    for ind_name in set_short_name_map:
        create_settlement_indicator_views(conn, set_short_name_map, ind_name)

    for ind_name in hf_short_name_map:
        create_hf_indicator_views(conn, hf_short_name_map, ind_name)

    # these are not the edits, but the boundaries whose data we are transfering
    create_boundary_tables_and_populate(conn)
    create_boundary_edit_tables(conn)
    create_boundary_edit_views(conn)

    create_catchment_table(conn, baseline_conn)
    
    create_view_health_facilities_fixed_post_after_pilot(conn, hf_short_name_map)
    create_view_health_facilities_outreach_after_pilot(conn)
    create_view_settlements_after_pilot(conn, set_short_name_map)

    b = get_boundaries_to_calc(conn)

    for idx, row in enumerate(b):
        print(f"Exporting stats from {row}\n{idx+1} of {len(b)}")

        # recalc_boundary_catchment on training
        # This was already done for all Kano
        # conn, baseline close
        # recalc_boundary_catchment(row.ward_guid)
        # conn, baseline_conn = db_connect()

        # we need the adj view in both baseline and current for the ward we are calculating
        create_helper_views(baseline_conn, True, [row.ward_guid])
        create_helper_views(baseline_conn, False, [row.ward_guid])
        create_helper_views(conn, True, [row.ward_guid])
        create_helper_views(conn, False, [row.ward_guid])

        add_geopode_settlements(conn, row)
        add_before_pilot_gmt_settlements(conn, baseline_conn, row)
        add_current_gmt_settlements(conn, row)
        add_deleted_demoted_gmt_settlements(conn, row)

        add_before_pilot_hf(conn, baseline_conn, row)
        add_after_pilot_hf(conn, row)
        add_grid3_geopode_hf(conn, row)

        add_catchments(conn, baseline_conn, row)

    conn.commit()

    trim_geopode_settlements(conn)

    remove_changed_boundary_from_deleted(conn)

    for table_name in [
        TABLE_SETTLEMENTS_GMT_BEFORE_PILOT,
        TABLE_SETTLEMENTS_GMT_AFTER_PILOT,
        TABLE_SETTLEMENTS_GEOPODE
    ]:
        add_set_indexes(conn, table_name)
