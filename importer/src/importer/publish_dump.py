import argparse
import logging
import warnings

import yaml

from importer.constants import DirectoryLocations, YamlConfigConstants, DbConstants
from importer.import_config import UtilConfig
from importer.util import init_logging
from importer.util import parse_path
from lib import db_utils, file_utils

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

    parser.add_argument('--clean',
                        action="store_true",
                        required=False,
                        help='If set, will remove the previous database dump if it exists')

    parser.add_argument('--username', help="Specifies the postgres username to use")

    parser.add_argument('--password', help="Specifies the postgres password to use")


    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Set to add more verbose logging')

    args = parser.parse_args()

    init_logging(args.verbose)

    with open(args.config_path) as file:
        yaml_config = yaml.load(file, Loader=yaml.FullLoader)

    if args.clean:
        file_utils.remove_dir(DirectoryLocations.PUBLISH_DUMP_PATH, dir_prefix="/data")

    process_publish_dump(yaml_config, args)


def process_publish_dump(yaml_config, args):
    db_config = yaml_config[YamlConfigConstants.DATABASE]

    # Create a config class containing the database connection info
    util_cfg = UtilConfig(db_config, command_line_args=args)

    log.info(
        f"Publishing host={util_cfg.POSTGRESQL_HOST} db={util_cfg.POSTGRESQL_DATABASE} schema={DbConstants.SCHEMA_TEMP_PUBLICATION}")

    log.info(f"Dumping publication schema to {DirectoryLocations.PUBLISH_DUMP_PATH}")
    db_utils.dump_db_publication_schema(util_cfg, '', DirectoryLocations.PUBLISH_DUMP_PATH,
                                        backup_file_name=DbConstants.SCHEMA_TEMP_PUBLICATION
                                        )
    log.info("Done")


if __name__ == "__main__":
    main()
