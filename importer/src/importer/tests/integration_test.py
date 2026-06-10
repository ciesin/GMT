import sys
from unittest.mock import patch

import importer.main
from .fixtures import *

# Not being run, but shows example how to test as a user the imports
def health_facility_import(db_test, conn):
    """
    Runs through a few quick imports, seeing errors.  Also does a partial import via db transforms
    :param db_test:
    :param conn:
    :return:
    """

    db_utils.run_sql(conn, f"TRUNCATE TABLE {DbConstants.SCHEMA_MASTER}.boundary_wards")
    db_utils.run_sql(conn, f"TRUNCATE TABLE {DbConstants.SCHEMA_MASTER}.fc_poi_health_facilities_raw")

    staging_name = "staging_postgres"

    db_utils.drop_table(conn,
                        schema_name=staging_name,
                        table_name="fc_poi_health_facilities_raw")

    ward_count = db_utils.get_single_value(conn, f"""select count(*) from {DbConstants.SCHEMA_MASTER}.boundary_wards""")
    assert ward_count == 0


    testargs = [
        "prog",
         "--config",
        "/config_files/grid3/shapefile_from_portal/current_structure/transforms.yml",
        "--config",
        "/config_files/docker_local_db.yml",
        "--config",
        "/data/training/initial_data/initial_data.yml",
        "--table",
        "boundary_states",
        "--table",
        "boundary_lgas",
        "--table",
        "boundary_wards",
        "--import",
        "--force",
        "--serial",
        "--comment",
        "Boundary Import"
    ]
    with patch.object(sys, 'argv', testargs):
        setup = importer.main.main()

    ward_count = db_utils.get_single_value(conn, f"""select count(*) from {DbConstants.SCHEMA_MASTER}.boundary_wards""")
    assert ward_count == 310

    hf_count = db_utils.get_single_value(conn, f"""select count(*) from {DbConstants.SCHEMA_MASTER}.fc_poi_health_facilities_raw""")
    assert hf_count == 0


    testargs = [
        "prog",
        "--config",
        "/config_files/training/health_facilities/from_portal.yml",
        "--config",
        "/config_files/training/health_facilities/incorrect_wards.yml",
        "--config",
        "/config_files/docker_local_db.yml",
        "--table",
        "fc_poi_health_facilities_raw",
        "--stage"
    ]
    with patch.object(sys, 'argv', testargs):
        try:
            setup = importer.main.main()
        except SystemExit:
            # stage will exit with sys exit
            pass

    hf_count = db_utils.get_single_value(conn,
                                         f"""select count(*) from {staging_name}.fc_poi_health_facilities_raw""")
    assert hf_count == 859



    expected = "Found 4 where parent entry did not cover child entry"
    output_path = Path("/data/stage_output/stage_fc_poi_health_facilities_raw.md")
    assert output_path.exists()
    with open(output_path, "r") as f:
        output = f.read()

    assert expected in output

    hf_count = db_utils.get_single_value(conn, f"""select count(*) from {DbConstants.SCHEMA_MASTER}.fc_poi_health_facilities_raw""")
    assert hf_count == 0

    conn.commit()

    # now do the normal import
    testargs = [
        "prog",
        "--config",
        "/config_files/training/health_facilities/from_portal.yml",
        "--config",
        "/config_files/training/health_facilities/original.yml",
        "--config",
        "/config_files/docker_local_db.yml",
        "--table",
        "fc_poi_health_facilities_raw",
        "--import",
        "--force",
        "--comment",
        "Health Facilities"
    ]
    with patch.object(sys, 'argv', testargs):
        setup = importer.main.main()

    hf_count = db_utils.get_single_value(conn, f"""select count(*) from {DbConstants.SCHEMA_MASTER}.fc_poi_health_facilities_raw""")
    assert hf_count == 861

    testargs = [
        "prog",
        "--config",
        "/config_files/training/health_facilities/partial.yml",
        "--config",
        "/config_files/docker_local_db.yml",
        "--table",
        "fc_poi_health_facilities_raw",
        "--export-stage",
        "--stage",
        # "--force",
        # "--comment",
        # "Boundary Import"
    ]
    with patch.object(sys, 'argv', testargs):
        setup = importer.main.main()

    hf_count = db_utils.get_single_value(conn,
                                         f"""select count(*) from {staging_name}.fc_poi_health_facilities_raw""")
    assert hf_count == 863
