import argparse
import logging
import sys
import warnings

import yaml
from psycopg2.sql import SQL, Identifier, Literal

from importer.constants import DbConstants
from importer.diff.config import YamlConfigConstants
from importer.import_config import UtilConfig
from importer.main import get_version_for_date, get_latest_version_id, create_view_for_specific_version
from importer.util import ConfigException, init_logging
from importer.util import parse_path, parse_date, confirm
from lib import db_utils, thread_utils

# Ignore CSR warnings as pyproj is more recent than geopandas

warnings.simplefilter(action='ignore', category=FutureWarning)

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def main():
    """
    Main entry point for the application.  Parses command line arguments and executes them.
    """
    parser = argparse.ArgumentParser(description='Publish latest version to publication database')

    parser.add_argument('-c', '--config', action='store',
                        dest="config_path",
                        type=parse_path,
                        required=True,
                        help='A file path to the Yaml configuration.  ')

    parser.add_argument('--username', help="Specifies the postgres username to use")

    parser.add_argument('--password', help="Specifies the postgres password to use")

    parser.add_argument('--table', action='append', type=str,
                        help='Optionally specify one or more tables to publish')

    parser.add_argument('--as-of-date', dest="custom_version_date",
                        type=parse_date,
                        help='The data as of this date will be published to the publish schema.  use yyyy-mm-dd format, like 2020-04-30')

    parser.add_argument('--id', dest="custom_version_id",
                        help='The data at this exact version will be used.  Should not be used with --as-of-date')

    parser.add_argument('--force', action='store_true',
                        help='If true, will not prompt for confirmation')

    parser.add_argument('--clean', action='store_true',
                        help='If true, will drop the existing data in the publication schema')

    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Set to add more verbose logging')

    args = parser.parse_args()

    init_logging(args.verbose)

    with open(args.config_path) as file:
        yaml_config = yaml.load(file, Loader=yaml.FullLoader)

    process_publish(yaml_config, args.table, args)


def process_publish(yaml_config, tables, args):
    db_config = yaml_config[YamlConfigConstants.DATABASE]

    # Create a config class containing the database connection info
    util_cfg = UtilConfig(db_config, command_line_args=args)

    publish_schema = DbConstants.SCHEMA_TEMP_PUBLICATION



    log.info(
        f"Publishing to a temporary publication schema in host={util_cfg.POSTGRESQL_HOST} db={util_cfg.POSTGRESQL_DATABASE} username={util_cfg.POSTGRESQL_USERNAME} "
        f" to schema={publish_schema}")

    # connection strings for ogr2ogr
    db_string = db_utils.get_ogr_connection_string(util_cfg)

    views_sql = f"""
select table_name from information_schema.tables
where table_type = 'VIEW'
and table_schema = 'master'
and table_name  NOT IN ('{DbConstants.TEMP_EXPORT_VIEW}')
order by table_name;
"""
    with db_utils.create_db_connection(util_cfg) as conn:

        if args.clean:
            if confirm(
                    f"Drop the {publish_schema} in host={util_cfg.POSTGRESQL_HOST} db={util_cfg.POSTGRESQL_DATABASE} ?"):
                db_utils.drop_schema(conn, schema_name=DbConstants.SCHEMA_TEMP_PUBLICATION)
            else:
                print(
                    "No confirmation, exiting...Removing the --clean option if you do not wish to drop the schema first")
                sys.exit(0)

        # we use the staging schema to create the temporary export views
        db_utils.create_schema(
            conn,
            schema_name=util_cfg.STAGING_SCHEMA
        )

        if args.custom_version_id:
            version_id = int(args.custom_version_id)
        elif args.custom_version_date is not None:
            version_id = get_version_for_date(conn, args.custom_version_date)
        else:
            version_id = get_latest_version_id(conn)

        version_sql = SQL(
            "select id, publish_user, comment, timestamp from {}.{} where id = {}").format(
            Identifier(DbConstants.SCHEMA_MASTER),
            Identifier(DbConstants.TABLE_NAME_VERSIONS),
            Literal(version_id)
        )

        version_row = db_utils.get_results(conn, version_sql)

        if len(version_row) <= 0:
            raise ConfigException(f"No version entry found for version_id {version_id}")

        version_row = version_row[0]

        if not args.force and not confirm(f"\nProceed with publishing version {version_row[0]} from"
                       f"\n\tuser {version_row[1]}"
                       f"\n\tcomment {version_row[2]}"
                       f"\n\tdate {version_row[3]}"
                       f"\n\nFrom database"
                       f"\n\tname {util_cfg.POSTGRESQL_DATABASE}"
                       f"\n\tport {util_cfg.POSTGRESQL_PORT}"
                       f"\n\tdb user [{util_cfg.POSTGRESQL_USERNAME}]"            
                                          f"?"
                       f"\n\nTo same database with"                       
                       f"\n\tschema {publish_schema}?"):
            print("Confirmation not received, not proceeding. Exiting...")
            sys.exit(1)

        sql = SQL("""
            CREATE SCHEMA IF NOT EXISTS {}  
        """).format(
            Identifier(publish_schema)
        )

        db_utils.run_sql(conn, sql)

        recs = db_utils.get_results(conn, views_sql)

        for master_view_name in recs:
            master_view_name = master_view_name[0]

            target_table_name = master_view_name.replace(DbConstants.LATEST_VIEW_SUFFIX, "")

            if tables and not target_table_name in tables:
                log.info(f"Skipping {target_table_name}, not selected for publish")
                continue

            create_view_for_specific_version(conn, target_table_name, version_id, schema_name=util_cfg.STAGING_SCHEMA)

            sql = SQL("""
select type, srid from public.geometry_columns
where f_table_name = {} and f_table_schema = {}
""").format(Literal(target_table_name), Literal(DbConstants.SCHEMA_MASTER))

            geometry_type, geometry_srid = db_utils.get_results(conn, sql)[0]

            cmd_line_parts = [
                "ogr2ogr",
                "-overwrite",
                "-update",
                "--config PG_USE_COPY YES",
                "-f \"PostgreSQL\"",

                f"PG:\"{db_string}\"",

                 "-f \"PostgreSQL\"",
                f"PG:\"{db_string}\"",
                f"{util_cfg.STAGING_SCHEMA}.{DbConstants.TEMP_EXPORT_VIEW}",
                "-lco OVERWRITE=yes",
                "-lco FID=id",
                f"-lco SCHEMA={publish_schema}",
                f"-nln {target_table_name}",
                f"-nlt {geometry_type}",

                "-progress",
            ]

            cmd_line = " ".join(cmd_line_parts)

            log.info(f"Publishing layer {target_table_name} @ version {version_id}")
            thread_utils.run_process(cmd_line)


        log.info(f"Complete, setting version to published")

        sql = SQL("""
    UPDATE {master}.{versions}
    SET is_published = True
    WHERE id = {v_id};
        """).format(
            master=Identifier(DbConstants.SCHEMA_MASTER),
            versions=Identifier(DbConstants.TABLE_NAME_VERSIONS),
            v_id=Literal(version_id)
        )

        db_utils.run_sql(conn, sql)

        # publisher_role
        log.info(f"Ensuring schema owner is {DbConstants.ROLE_NAME_PUBLISHER}")

        sql = SQL("""
            ALTER SCHEMA {} 
OWNER TO {}
                """).format(
            Identifier(DbConstants.SCHEMA_TEMP_PUBLICATION),
            Identifier(DbConstants.ROLE_NAME_PUBLISHER)
        )

        db_utils.run_sql(conn, sql)


if __name__ == "__main__":
    main()
