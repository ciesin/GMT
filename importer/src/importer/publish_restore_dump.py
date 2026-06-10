import argparse
import logging
import os
import warnings

import yaml

from importer.constants import DirectoryLocations, DbConstants
from importer.import_config import UtilConfig
from importer.main import parse_path
from importer.util import init_logging
from lib import db_utils

# Ignore CSR warnings as pyproj is more recent than geopandas

warnings.simplefilter(action='ignore', category=FutureWarning)

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def main():
    """
    Main entry point for the application.  Parses command line arguments and executes them.
    """
    parser = argparse.ArgumentParser(description='Dump Publication schema definition and data to file system')

    parser.add_argument('-c', '--config', action='store',
                        dest="config_path",
                        type=parse_path,
                        required=True,
                        help='A file path to the Yaml configuration.  ')

    parser.add_argument('--username', help="Specifies the postgres username to use")

    parser.add_argument('--password', help="Specifies the postgres password to use")

    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Set to add more verbose logging')

    args = parser.parse_args()

    init_logging(args.verbose)

    with open(args.config_path) as file:
        yaml_config = yaml.load(file, Loader=yaml.FullLoader)

    process_publish_restore_dump(yaml_config, args)


def process_publish_restore_dump(publish_config, args):
    publish_db_config = publish_config['publish-database']

    # Create a config class containing the database connection info
    publish_util_cfg = UtilConfig(publish_db_config, command_line_args=args)

    backup_file_name = DbConstants.SCHEMA_TEMP_PUBLICATION

    log.info(
        f"Publishing host={publish_util_cfg.POSTGRESQL_HOST} db={publish_util_cfg.POSTGRESQL_DATABASE} schema={DbConstants.SCHEMA_PORTAL_GEOSERVER}")

    log.info(f"restoring")
    db_utils.restore_publication_dump(publish_util_cfg, DirectoryLocations.PUBLISH_DUMP_PATH,
                                      backup_file_name=backup_file_name)

    log.info("Setting permissions")

    db_geoserver_username = os.environ.get("DB_GEOSERVER_DATABASE_USERNAME", "gridgeoserver")

    with db_utils.create_db_connection(publish_util_cfg) as conn:
        db_utils.run_sql(conn, f"""
         GRANT SELECT ON ALL TABLES IN SCHEMA {DbConstants.SCHEMA_PORTAL_GEOSERVER} TO "{db_geoserver_username}";
        """)

        db_utils.run_sql(conn, f"""
         GRANT USAGE ON SCHEMA {DbConstants.SCHEMA_PORTAL_GEOSERVER} TO "{db_geoserver_username}";
        """)

    log.info("Done")


if __name__ == "__main__":
    main()
