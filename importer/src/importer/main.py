import argparse
import contextlib
import logging
import os
import sys
import warnings
from datetime import datetime
from pathlib import Path
from typing import Tuple, List, Dict, Union

from colorama import Fore, Back, Style
from psycopg2.sql import SQL, Identifier, Literal

from importer.constants import DbConstants, DirectoryLocations, GisFormats
from importer.diff.config import DiffConfig, YamlConfigConstants
from importer.diff.data import load_staging_column_names_types
from importer.diff.main import process_layers_diff
from importer.import_config import ImportConfig
from importer.partial_merge import process_export_partial, process_export_stage
from importer.transformations import run_db_transforms
from importer.util import convert_markdown_to_html_and_pdf, layers_iterator, ConfigException, init_logging, confirm, \
    CaseInsensitively
from importer.verifications import run_verifications
from lib import db_utils, geo_db_utils, file_utils
from lib.thread_utils import run_process_stream_output

# Ignore CSR warnings as pyproj is more recent than geopandas

warnings.simplefilter(action='ignore', category=FutureWarning)

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def main():
    """
    Main entry point for the application.  Parses command line arguments and executes them.
    """

    parser = argparse.ArgumentParser(description='Stage/Diff/and Import data into Grid3 database.')

    parser.add_argument('-c', '--config', action='append',
                        dest="config_paths",
                        type=parse_path,
                        required=True,
                        help='A file path to the Yaml configuration.  Multiple files can be passed, results will'
                             ' be merged together')

    parser.add_argument('--username', help="Specifies the postgres username to use")

    parser.add_argument('--password', help="Specifies the postgres password to use")

    parser.add_argument('--stage', action='store_true', dest="do_stage",
                        help='Import data to staging schema and generates a diff report.')

    parser.add_argument('--input-path',
                        dest="input_path", type=str,
                        help="Overrides the YML path key.  The path to the file/directory being imported.  Must be used with the table argument.")

    parser.add_argument('--input-layer',
                        help="Overrides the YML layer key.  This is which layer in the input file/directory to import.  Must be used with the table argument.")

    parser.add_argument('--db-filter',
                        help="Overrides the YML db_filter key.  ")

    parser.add_argument('--import-key', action='append', type=str, nargs="?",
                        help='Optionally specify one or more import keys, skipping all the others.  '
                             'Add --serial to import them one by one')

    parser.add_argument('--serial', dest="serial", action='store_true',
                        help='If table options are specified, do full stage/diff/import of each one instead of all tables for stage, then all tables for diff, etc.')

    parser.add_argument('--import', '--commit', dest="do_import", action='store_true',
                        help='Import data from staging schema to publication schema.  Implicitly runs a stage')

    parser.add_argument('--export-partial', dest="do_partial", action='store_true',
                        help='Exports a shapefile to the data/exports directory containing the transformed data from the staging table.  **WARNING** Any existing exports in the data/exports directory will be deleted.  Also make sure anything that has open file handles to the files in export (e.g. QGIS) are closed.')

    parser.add_argument('--export-stage', dest="do_export_stage", action='store_true',
                        help='Exports a shapefile to the data/exports directory containing the transformed data from the staging table.  Will use a unique filename')

    parser.add_argument('--comment', type=str, help='Comment associated with commit import')

    parser.add_argument('--export', dest="do_export", action='store_true',
                        help='Export latest commit/version of all tables in the config files (or the ones explicitly specified via --table) to a shapefile in the data/exports directory.  Will be a national export regardless of db_filter. **WARNING** Any existing exports in the data/exports directory will be deleted.  Also make sure anything that has open file handles to the files in export (e.g. QGIS) are closed.')

    parser.add_argument('--as-of-date', dest="export_date",
                        type=parse_date,
                        help='The exported version will use the data as of this date.  use yyyy-mm-dd format, like 2020-04-30')

    parser.add_argument('--rollback', dest='do_rollback', action='store_true',
                        help='Will remove the last commit from the database.  MAKE SURE YOU HAVE A VALID DATABASE BACKUP BEFORE RUNNING THIS COMMAND')

    parser.add_argument('--force', action='store_true',
                        help='If true, will not prompt for import')

    parser.add_argument('--statement-timeout', dest="POSTGRESQL_STATEMENT_TIMEOUT", help='Sets database statement timeout, in minutes.  Takes precedence over the POSTGRESQL_STATEMENT_TIMEOUT environment variable.')

    parser.add_argument('--use-db-copy', dest="use_db_copy", action='store_true',
                        help="If set, will use COPY instead of geopandas to_sql.  Useful if a stage is taking too long")

    parser.add_argument('--skip-pdf', dest="skip_pdf", action='store_true', default=False,
                        help="If set, will not convert the staging and diff reports to pdf.  This will save script processing time")

    parser.add_argument('--diff-summary-only', dest="diff_summary_only", action='store_true', default=False,
                        help="If set, the diff report will only show the overall totals and not the individual new/changed/deleted items.  This will save script processing time.  Recommended for large tables such as hamlets")

    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Set to add more verbose logging')

    args = parser.parse_args()

    # db_utils will read the environment variable, this gives an option to set it via command line
    if args.POSTGRESQL_STATEMENT_TIMEOUT:
        os.environ["POSTGRESQL_STATEMENT_TIMEOUT"] = args.POSTGRESQL_STATEMENT_TIMEOUT

    # Merge the YML files together
    import_config = ImportConfig(args.config_paths, args)

    specific_import_keys_to_process = args.import_key

    # Raise exceptions on incompatible command line options
    if args.do_export and (args.do_stage or args.do_import or args.do_partial):
        raise Exception("Cannot export and stage/import at same time")

    if args.do_partial and args.do_import:
        raise Exception("Cannot do a partial export and import at the same time")

    if not (args.do_partial or args.do_export or args.do_stage or args.do_import or args.do_rollback):
        raise Exception("Not doing anything, please specify an action")

    if args.input_path and not args.table:
        raise Exception("When specifying the import path, only one target table can be used.  Please specify table")

    if args.do_stage or args.do_import:

        # Clear out the existing stage_output directory.  Note that certain browsers,
        # even after closing the tabs, can maintain open file handles and prevent this from succeeding
        file_utils.remove_dir(DirectoryLocations.STAGE_REPORT_PATH.parent, dir_prefix=DirectoryLocations.DATA_DIR)
        file_utils.mkdir_p(DirectoryLocations.STAGE_REPORT_PATH.parent)

        assert DirectoryLocations.STAGE_REPORT_PATH.parent.exists()
        
        # Wait until after the staging directories are recreated as we want to put the log in the staging directory
        # in a docker container we just want stdout logging
        init_logging(args.verbose) #, DirectoryLocations.STAGE_REPORT_PATH.parent)
    else:
        # Not staging / importing, just log to stdout
        init_logging(args.verbose)

    if args.do_export or args.do_partial:
        file_utils.remove_dir(DirectoryLocations.EXPORTS_DIR, dir_prefix=DirectoryLocations.DATA_DIR)
        file_utils.mkdir_p(DirectoryLocations.EXPORTS_DIR)

    if args.do_export_stage:
        # dont delete the directory
        file_utils.mkdir_p(DirectoryLocations.EXPORTS_DIR)

    if args.serial and specific_import_keys_to_process is not None and len(specific_import_keys_to_process) > 0:
        log.info("Running table import serially")
        for specific_table in specific_import_keys_to_process:
            run_main_actions(args, import_config, [specific_table])
    else:
        log.info("Not running table import serially")
        run_main_actions(args, import_config, specific_import_keys_to_process)


def run_main_actions(args, import_config:ImportConfig, list_specific_tables: Union[List[str], None]):
    """
    After the command line arguments have been parsed, this runs the actions chosen
    by the user.  e.g. stage, import, export
    """
    log.info(f"Processing specific_table={list_specific_tables}")

    if args.do_rollback:
        process_rollback(import_config, args.force, list_specific_tables)
        return

    if args.do_stage or args.do_import or args.do_partial:
        ok, _ = process_import_to_stage(import_config, args, list_specific_tables)

        if not ok:
            log.error(f"{Fore.RED}Staging had errors/issues, stopping...{Style.RESET_ALL}")

            # we still want to export stage if requested
            if args.do_partial:
                process_export_partial(import_config, list_specific_tables)

            if args.do_export_stage:
                process_export_stage(import_config, list_specific_tables)

            sys.exit(3)

    if args.do_stage or args.do_import:
        process_layers_diff(import_config, list_specific_tables, args)

    if args.do_partial:
        process_export_partial(import_config, list_specific_tables)
        return

    if args.do_export_stage:
        process_export_stage(import_config, list_specific_tables)
        return

    if args.do_import:

        if args.force or confirm(f"Please verify the stage / diff reports.  "
                 f"Will import to host={import_config.util_cfg.POSTGRESQL_HOST} db={import_config.util_cfg.POSTGRESQL_DATABASE}"
                 ):
            log.info("Proceeding with import")
            process_import_stage_to_master(import_config,
                                           commit_comment=args.comment,
                                           specific_table_names=list_specific_tables)
        else:
            log.info("Skipping import")
    if args.do_export:
        process_export_master(import_config,
                              custom_version_date=args.export_date,
                              specific_table_names=list_specific_tables)


def parse_path(arg: str) -> Path:
    """
    :param arg: command line argument passed by the user
    :return: parsed path
    """
    p = Path(arg)
    if not p.exists() or not p.is_file():
        raise argparse.ArgumentTypeError(f"[{arg}] is not a valid file")

    return p


def parse_date(arg: str) -> datetime:
    return datetime.strptime(arg, '%Y-%m-%d')


def process_rollback(import_config: ImportConfig, force, specific_table_names:List[str]=None) :
    """
    Top level method to execute a rollback

    :param import_config:
    :param specific_table_names: if defined, will only process layers in the list
    :return:
    """

    with contextlib.closing(db_utils.create_db_connection(import_config.util_cfg)) as conn:

        latest_version_sql = SQL("select id, publish_user, comment, timestamp from {}.{} ORDER by id DESC LIMIT 1").format(
            Identifier(DbConstants.SCHEMA_MASTER),
            Identifier(DbConstants.TABLE_NAME_VERSIONS)
        )

        latest_version_row = db_utils.get_results(conn, latest_version_sql)

        if len(latest_version_row) <= 0:
            raise ConfigException("No version entries found, database is likely new or empty" )

        latest_version_row = latest_version_row[0]

        last_version_id = latest_version_row[0]
        answer = force or confirm(f"\nAre you sure you wish to rollback version {last_version_id} from"
                       f"\n\tuser {latest_version_row[1]}"
                       f"\n\tcomment {latest_version_row[2]}"
                       f"\n\tdate {latest_version_row[3]}"
                       f"\n\nUsing database" 
                       f"\n\tname {import_config.util_cfg.POSTGRESQL_DATABASE}"
                       f"\n\tport {import_config.util_cfg.POSTGRESQL_PORT}?"
                       f"\n\nAlso, make sure you have a VALID DATABASE BACKUP as this will remove data (y/n): ")

        if not answer:
            log.info("Not rolling back")
            return

        tables_sql = SQL("""
        select table_schema, table_name from information_schema.tables
where table_schema NOT IN ('auth', 'calc_strategy_work', 'indicators', 'master', 'pg_catalog', 'public',
'topology', 'zonal_stats_import', 'information_schema') and table_schema not like 'staging_%' and table_name != 'polygon_simplified'
and table_type ilike 'base table'
and table_name != {}""").format(
            Literal(DbConstants.TABLE_NAME_VERSIONS)
        )

        tables = [r for r in db_utils.get_results(conn, tables_sql)]

        for s, t in tables:
            sql = SQL("""DELETE FROM {s}.{t} WHERE {version_column} >= {last_version_id}""" ).format(
                s = Identifier(s),
                t = Identifier(t),
                version_column = Identifier(DbConstants.COLUMN_NAME_VERSION_ID),
                last_version_id = Literal(last_version_id)
            )
            row_count = db_utils.run_sql(conn, sql)

            if row_count > 0:
                log.info(f"{row_count} rows removed from {t}")

        sql = SQL("""DELETE FROM {}.{} WHERE id = {}""").format(
            Identifier(DbConstants.SCHEMA_MASTER),
            Identifier(DbConstants.TABLE_NAME_VERSIONS),
            Literal(last_version_id)
        )
        row_count = db_utils.run_sql(conn, sql)

        log.info(f"{row_count} rows removed from version table")


def get_db_filter(conn, layer_config: Dict, staging_schema: str) -> str:
    # IN_STAGING_EXTENT
    db_filter = layer_config.get(YamlConfigConstants.DB_FILTER,
                          YamlConfigConstants.DEFAULT_DB_FILTER)

    if YamlConfigConstants.TARGET_DB_TABLE_NAME not in layer_config:
        keys = ", ".join(layer_config)
        raise Exception(f"Can't find {YamlConfigConstants.TARGET_DB_TABLE_NAME} key, keys found: {keys}")

    postgis_table_name = layer_config[YamlConfigConstants.TARGET_DB_TABLE_NAME]
    # import_key = layer_config[YamlConfigConstants.LAYER_KEY]

    if DbConstants.IN_STAGING_EXTENT in db_filter and conn is not None:
        # add the extent of the staging table to the db_filter
        sql = SQL("""
SELECT ST_Xmin(ex), ST_Xmax(ex), ST_Ymin(ex), ST_Ymax(ex) FROM 
(
    SELECT ST_Extent({}) AS ex FROM {}.{}
) sq         
        """).format(
            Identifier(DbConstants.COLUMN_NAME_GEOMETRY),
            Identifier(staging_schema),
            Identifier(postgis_table_name)
        )

        xmin, xmax, ymin, ymax = db_utils.get_results(conn, sql)[0]

        return db_filter.replace(DbConstants.IN_STAGING_EXTENT, f""" 
        {DbConstants.COLUMN_NAME_GEOMETRY} && ST_SetSRID(ST_MakeBox2D(ST_Point({xmin}, {ymin}),
	ST_Point({xmax}, {ymax})),4326)
""")
    else:
        return db_filter



def process_import_to_stage_without_geopandas(
        import_config: ImportConfig,
        layer_config,):
    """
    Uses ogr2ogr to copy directly to stage
    """

    ok = True
    all_output = ""

    format_type = layer_config.get(YamlConfigConstants.TYPE, GisFormats.UNSPECIFIED)
    format_type_i = CaseInsensitively(format_type)

    postgres_table_name = layer_config[YamlConfigConstants.TARGET_DB_TABLE_NAME]
    # postgres_table_schema = layer_config[YamlConfigConstants.TARGET_DB_SCHEMA]

    staging_schema = import_config.util_cfg.STAGING_SCHEMA
    pg_conn_str = db_utils.get_ogr_connection_string(import_config.util_cfg)

    ogr2ogr_column_types = layer_config.get(YamlConfigConstants.OGR2OGR_COLUMN_TYPES, "")

    ogr2ogr_args = layer_config.get(YamlConfigConstants.EXTRA_OGR2OGR_ARGS, "")

    row_limit = layer_config.get(YamlConfigConstants.ROW_LIMIT)

    input_db_filter = layer_config.get(YamlConfigConstants.INPUT_DB_FILTER)

    cmd_parts = []

    if format_type_i == GisFormats.SQLITE:
        return False, "No SQ Lite support without geopandas yet"
    elif format_type_i == GisFormats.POSTGIS:
        db_uri = layer_config.get(YamlConfigConstants.CONNECTION_STRING)
        from_db_layer = layer_config.get(YamlConfigConstants.LAYER_NAME)

        # update / append?

        cmd_parts = [
            "ogr2ogr",
            "--config PG_USE_COPY YES",
            f"{ogr2ogr_args}",
            f"-lco GEOMETRY_NAME={DbConstants.COLUMN_NAME_GEOMETRY}",
            f"-lco FID={DbConstants.COLUMN_NAME_ROW_INDEX}",
            "-lco OVERWRITE=YES",
            f"-lco COLUMN_TYPES=\"{ogr2ogr_column_types}\"",
            "-f PostgreSQL",
            "-progress",
            f'-nln "{staging_schema}.{postgres_table_name}"',
            f"\"PG: {pg_conn_str}\"",
            f"\"PG: {db_uri}\"",
            f"\"{from_db_layer}\"",
        ]


    elif format_type_i in [GisFormats.SHAPEFILE, GisFormats.FGDB, GisFormats.UNSPECIFIED]:

        file_path = layer_config.get(YamlConfigConstants.PATH)

        cmd_parts = [
            "ogr2ogr",
            "--config PG_USE_COPY YES",
            f"{ogr2ogr_args}",
            f"-lco GEOMETRY_NAME={DbConstants.COLUMN_NAME_GEOMETRY}",
            f"-lco FID={DbConstants.COLUMN_NAME_ROW_INDEX}",
            "-lco OVERWRITE=YES",
            f"-lco COLUMN_TYPES=\"{ogr2ogr_column_types}\"",
            "-f PostgreSQL",
            "-progress",
            f'-nln "{staging_schema}.{postgres_table_name}"',
            f"\"PG: {pg_conn_str}\"",
            f"\"{file_path}\""
        ]

        from_layer = layer_config.get(YamlConfigConstants.LAYER_NAME)

        if from_layer:
            cmd_parts.append(f"\"{from_layer}\"",)

    if row_limit:
        cmd_parts.append(f"-limit {row_limit}")

    if input_db_filter:
        cmd_parts.append(f"-where \"{input_db_filter}\"")

    cmd = ' '.join(cmd_parts)

    run_process_stream_output(cmd)

    return ok, all_output

def process_import_to_stage(import_config: ImportConfig,
                            parsed_cmd_line_args,
                            specific_table_names:List[str]=None) -> Tuple[bool, str]:

    """
    Top level method to stage all layers

    :param import_config:
    :param parsed_cmd_line_args
    :param specific_table_names: if defined, will only process layers in the list
    :return: A tuple containing a boolean to indicate success or failure, and a str containing the markdown of the stage output
    """

    if import_config.util_cfg.POSTGRESQL_HOST != "gmt_db":
        log.info(f"Not staging to local docker master GDB, we assume we are targetting production.  Switching background to RED! ")
        print(f"{Back.RED}")
    else:
        print(f"{Style.RESET_ALL}")

    log.info(f"Staging data to host={import_config.util_cfg.POSTGRESQL_HOST} db={import_config.util_cfg.POSTGRESQL_DATABASE}")

    ok = True

    with contextlib.closing(db_utils.create_db_connection(import_config.util_cfg)) as conn:

        # Create the staging schema if it doesn't already exist
        # Note the staging schema is not dropped at the end (in case the user wants to inspect with QGIS or pgAdmin the stage output)
        db_utils.create_schema(conn, import_config.util_cfg.STAGING_SCHEMA, "Temporary schema to store imported geometry")

        all_output = f"Report generated '{datetime.now():%Y-%m-%d %H:%M:%S%z}'\n\n"

        # Import layers one by one to the staging schema
        for layer_config in layers_iterator(import_config.yaml_config, specific_table_names):

            # Process overrides from the command line
            if parsed_cmd_line_args.db_filter:
                log.info(f"Using db_filter from command line: \"{parsed_cmd_line_args.db_filter}\"")
                layer_config[YamlConfigConstants.DB_FILTER] = parsed_cmd_line_args.db_filter
            if parsed_cmd_line_args.input_layer:
                log.info(f"Using input layer from command line: \"{parsed_cmd_line_args.input_layer}\"")
                layer_config[YamlConfigConstants.LAYER_NAME] = parsed_cmd_line_args.input_layer
            if parsed_cmd_line_args.input_path:
                log.info(f"Using input path from command line: \"{parsed_cmd_line_args.input_path}\"")
                layer_config[YamlConfigConstants.PATH] = parsed_cmd_line_args.input_path

            # get configured db_filter (aka Scope)
            # pass a None connection since the staging table might not exist yet so we can't get the extent if its
            # part of the db_filter.  This filter is for visual aid only
            db_filter = get_db_filter(None, layer_config, staging_schema=import_config.util_cfg.STAGING_SCHEMA)

            # load target
            postgres_table_name = layer_config[YamlConfigConstants.TARGET_DB_TABLE_NAME]
            postgres_table_schema = layer_config[YamlConfigConstants.TARGET_DB_SCHEMA]

            all_output += f"\n\nImported table will update all data in {postgres_table_schema}.{postgres_table_name} " \
                          f"in the database `{import_config.util_cfg.POSTGRESQL_DATABASE} @ " \
                          f"{import_config.util_cfg.POSTGRESQL_HOST}:{import_config.util_cfg.POSTGRESQL_PORT}` "

            if db_filter == YamlConfigConstants.DEFAULT_DB_FILTER:
                all_output += f"not filtered (*will replace/update data for ALL States*)\n\n"
            else:
                all_output += f"that matches the filter \n\n`{db_filter}`\n\n"

            all_output += f"Staged data and existing data are matched using their global_ids.\n" \
                          f"Updates are handles as follows:\n" \
            f"* Rows in the committed master table that are not in the imported/staged set are soft deleted\n" \
            f"* Rows in the committed master table and in the staged table are updated\n" \
            f"* Rows not in the committed master table and in the staged table are inserted\n\n"

            target_column_names = db_utils.get_column_names(conn, schema_name=postgres_table_schema,
                                                            table_name=postgres_table_name)

            # drop existing staging table
            # drop any lingering stage export views
            db_utils.run_sql(conn, f"DROP VIEW IF EXISTS {import_config.util_cfg.STAGING_SCHEMA}.{DbConstants.TEMP_EXPORT_VIEW}")

            db_utils.drop_table(conn, schema_name=import_config.util_cfg.STAGING_SCHEMA, table_name=postgres_table_name)

            # Load source
            source = layer_config

            # Checks source config, also sets default layer name for shapefiles/GeoJson/single layer formats
            log.debug(f"Checking layer {postgres_table_name}")
            DiffConfig.check_layer(source)

            # If skip basemap is set, we set the tile server to None to not fetch basemaps
            if layer_config.get(YamlConfigConstants.SKIP_BASEMAPS, False) is True:
                layer_config[YamlConfigConstants.TILE_SERVER] = None

            target_geom_info = geo_db_utils.get_geometry_column_info(conn,
                                                                     schema_name=postgres_table_schema,
                                                                     table_name=postgres_table_name)

            if target_geom_info is None:
                raise ConfigException(
                    f"table \"{postgres_table_name}\" does not appear to exist in schema \"{postgres_table_schema}\", or has no geometry column")

            all_output += create_master_stage_column_name_type_table(
                conn,
                postgres_table_schema, postgres_table_name,
                target_geom_info, source, target_column_names,
            )

            log.debug(f"Loading layer {postgres_table_name} into GeoPandas Dataframe")


            was_ok, sub_output = process_import_to_stage_without_geopandas(
                import_config,
                layer_config,
            )

            all_output += sub_output
            if not was_ok:
                ok = False

            if ok:
                output = run_db_transforms(import_config, layer_config, postgres_table_name)
                all_output += output

                log.debug(f"Running verifications on {postgres_table_name}")
                result, output = run_verifications(import_config, layer_config, postgres_table_name)

                all_output += output

            ok = ok and result


    stage_report_path = DirectoryLocations.STAGE_REPORT_PATH
    if specific_table_names is not None and len(specific_table_names) == 1:
        specific_table_name = specific_table_names[0]
        stage_report_path = stage_report_path.with_name("stage_" + specific_table_name).with_suffix(DirectoryLocations.STAGE_REPORT_PATH.suffix)

    file_utils.mkdir_p(DirectoryLocations.STAGE_REPORT_PATH.parent)

    log.info(f"Wrote staging report to [{stage_report_path}]")

    with open(stage_report_path, "w") as f:
        f.write(all_output)

    convert_markdown_to_html_and_pdf(
            stage_report_path, stage_report_path.parent,
            title="Stage Report",
        skip_pdf=parsed_cmd_line_args.skip_pdf
    )

    return ok, all_output


"""
Creates the table in the staging report comparing the columns of the raw imported
data using gdal and the master table
"""
def create_master_stage_column_name_type_table(
        conn,
        postgis_schema_name,
        postgis_table_name,
        target_geom_info,
        source,
        target_column_names,
) -> str:

    all_output = ""
    master_types = db_utils.get_column_types_as_dict(conn, postgis_schema_name,
                                                     table_name=postgis_table_name)

    master_types[
        target_geom_info['column_name']] = f"Geometry({target_geom_info['geometry_type']}, {target_geom_info['srid']})"

    stage_columns = load_staging_column_names_types(source)

    master_columns = []
    target_column_names_sorted = sorted(target_column_names)
    for cn in target_column_names_sorted:

        if cn in [
            DbConstants.COLUMN_NAME_VERSION_ID,
            DbConstants.COLUMN_NAME_IS_DELETED]:
            continue
        master_columns.append((cn, master_types[cn]))

    path = source.get(YamlConfigConstants.PATH, "No path")
    layer_name = source.get(YamlConfigConstants.LAYER_NAME, "No layer")

    all_output += f"Staging file **{path}**<br/>layer **{layer_name}**<br/>=> targeting Master table **{postgis_table_name}**\n\n"

    all_output += "|Staging column name | OGR Type | Master Column Name | Database Type |\n|---|---|---|---|\n"

    sc_index = 0
    mc_index = 0

    while sc_index < len(stage_columns) or mc_index < len(master_columns):
        #log.debug(f"{sc_index} len {len(stage_columns)} mc_idx {mc_index} len {len(master_columns)}")
        if sc_index < len(stage_columns) and mc_index < len(master_columns) and stage_columns[sc_index][0] == \
                master_columns[mc_index][0]:
            all_output += f"|{stage_columns[sc_index][0]}|{stage_columns[sc_index][1]}|{master_columns[mc_index][0]}|{master_columns[mc_index][1]}\n"
            sc_index += 1
            mc_index += 1
        # just show staging
        elif mc_index >= len(master_columns) or (sc_index < len(stage_columns) and stage_columns[sc_index][0] < master_columns[mc_index][0]):
            all_output += f"|{stage_columns[sc_index][0]}|{stage_columns[sc_index][1]}||\n"
            sc_index += 1
        # just show master
        elif sc_index >= len(stage_columns) or stage_columns[sc_index][0] > master_columns[mc_index][0]:
            all_output += f"|||{master_columns[mc_index][0]}|{master_columns[mc_index][1]}\n"
            mc_index += 1
        else:
            raise Exception(f"Error in type table staging index: {sc_index} master index: {mc_index}")

    all_output += "\n"
    all_output += f"\nNote that the staging column containing the geometry is automatically renamed to the master geometry name: \"{DbConstants.COLUMN_NAME_GEOMETRY}\".\n\n"
    return all_output





def get_db_type_map(conn, schema_name: str, table_name: str) -> Dict[str, str]:
    """
    Queries the database for column types

    """
    data_types = {}

    sql = SQL("""
    SELECT column_name, data_type, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = {} and table_name = {}
    """).format(
        Literal(schema_name),
        Literal(table_name)
    )

    results = db_utils.get_results(conn, sql)

    for r in results:
        column_name, data_type, character_maximum_length = r

        if data_type == "character" :
            data_types[column_name] = "text"
        else :
            data_types[column_name] = data_type

    return data_types


def process_import_stage_to_master(
        import_config: ImportConfig,
        commit_comment=None,
        specific_table_names:Union[List[str],None]=None):
    """
    Main method to take data that has been staged & diffed and updates the master schema

    """
    log.info(f"Transferring data to imported schema (which can vary)")

    if not commit_comment:
        commit_comment = input(f"Please input a commit comment: ")

    with contextlib.closing(db_utils.create_db_connection(import_config.util_cfg)) as conn:

        # Insert new version into commit table
        sql = SQL("""
        INSERT INTO {}.{}
        (comment)
        VALUES ({})
        RETURNING id
        """).format(
            Identifier(DbConstants.SCHEMA_MASTER),
            Identifier(DbConstants.TABLE_NAME_VERSIONS),
            Literal(commit_comment)
        )

        version_id = db_utils.get_results(conn, sql)[0][0]

        # Import layers one by one
        for layer in layers_iterator(import_config.yaml_config, specific_table_names):

            # load target
            postgres_table_name = layer[YamlConfigConstants.TARGET_DB_TABLE_NAME]
            postgres_schema_name = layer[YamlConfigConstants.TARGET_DB_SCHEMA]

            log.debug(f"Importing table \"{postgres_schema_name}\".\"{postgres_table_name}\"" )

            # Get the column list we are inserting from the view (as version_id / is_deleted) are not present
            view_name = postgres_table_name + DbConstants.LATEST_VIEW_SUFFIX
            view_column_names = db_utils.get_column_names_using_pg(conn, schema_name=postgres_schema_name,
                                                            table_name=view_name)

            col_list = [Identifier(c) for c in view_column_names if c != DbConstants.COLUMN_NAME_VERSION_ID ]

            # first handle soft deletes

            sql = SQL("""
            INSERT INTO {schema_name}.{table_name} 
            (""").format(
                schema_name=Identifier(postgres_schema_name),
                table_name=Identifier(postgres_table_name),
            )
            sql += SQL(", ").join(col_list)
            sql += SQL(", {}, {}) SELECT ").format(
                Identifier(DbConstants.COLUMN_NAME_VERSION_ID),
                Identifier(DbConstants.COLUMN_NAME_IS_DELETED)
            )
            sql += SQL(", ").join( [ SQL("latest.{}").format(c) for c in col_list ])
            sql += SQL("""  , {}, True
FROM {schema_stage}.{table_name} stage
INNER JOIN {schema_master}.{view_name} latest
ON latest.global_id = stage.global_id 
WHERE stage.is_deleted = True
""" ).format(
                Literal(version_id),
                schema_master=Identifier(postgres_schema_name),
                schema_stage=Identifier(import_config.util_cfg.STAGING_SCHEMA),
                table_name=Identifier(postgres_table_name),
                view_name=Identifier(view_name)
            )

            cur = db_utils.execute_sql(conn, sql)
            total_changed = cur.rowcount
            log.debug(f"Soft deleted {cur.rowcount} records ")

            # handle new / updated records

            sql = SQL("INSERT INTO {}.{} (").format(
                Identifier(postgres_schema_name), Identifier(postgres_table_name))

            sql += SQL(', ').join(col_list)
            sql += SQL(', {}').format(Identifier(DbConstants.COLUMN_NAME_VERSION_ID))
            sql += SQL(')\n')

            sql += SQL("SELECT ")
            sql += SQL(', ').join(col_list)
            # hard code the version that we just added
            sql += SQL(", {} ").format(Literal(version_id))
            sql += SQL("\nFROM {}.{} WHERE {} IS TRUE OR {} IS TRUE").format(
                Identifier(import_config.util_cfg.STAGING_SCHEMA), Identifier(postgres_table_name),
                Identifier(DbConstants.COLUMN_NAME_IS_UPDATED), Identifier(DbConstants.COLUMN_NAME_IS_NEW)
            )

            trace_log.debug(sql.as_string(conn))

            cur = db_utils.execute_sql(conn, sql)
            num_recs = cur.rowcount

            total_changed += num_recs

            log.debug(f"Layer [{postgres_table_name}]  Number of records inserted / updated: {num_recs}")

            if total_changed > 0:
                conn.commit()

                log.info("Refreshing materialized view")

                sql = SQL("""REFRESH
                MATERIALIZED
                VIEW
                {schema_name}.{view_name}""").format(
                schema_name=Identifier(postgres_schema_name),
                view_name=Identifier(postgres_table_name + "_latest") ,
                )

                db_utils.run_sql(conn, sql)


            else:
                log.info("No rows, not committing")


def get_latest_version_id(conn):
    sql = SQL("""SELECT MAX(id) FROM master.{}            
                            """).format(
        Identifier(DbConstants.TABLE_NAME_VERSIONS)
    )
    version_id = db_utils.get_single_value(conn, sql)

    if version_id is None:
        raise ConfigException(f"No commits exist in database")

    return version_id


def get_version_for_date(conn, custom_version_date):

    sql = SQL("""SELECT id FROM master.{}
        WHERE date_trunc('day', timestamp) <= {}
        ORDER by id DESC
        LIMIT 1;
                """).format(
        Identifier(DbConstants.TABLE_NAME_VERSIONS),
        Literal(custom_version_date)
    )
    version_id = db_utils.get_single_value(conn, sql)

    if version_id is None:
        raise ConfigException(f"Date {custom_version_date} is before all existing commits")

    return version_id


def create_view_for_specific_version(conn, table_name, version_id, schema_name):
    target_table = table_name

    log.info(f"Creating view for {target_table} @ version {version_id}")

    columns = db_utils.get_column_names(
        conn,
        schema_name=DbConstants.SCHEMA_MASTER,
        table_name=target_table)

    columns.remove(DbConstants.COLUMN_NAME_VERSION_ID)
    columns.remove(DbConstants.COLUMN_NAME_IS_DELETED)
    # need special treatment of global_id
    columns.remove(DbConstants.COLUMN_NAME_GLOBAL_ID)

    col_list = SQL(', ').join([Identifier(c) for c in columns])

    view_name = DbConstants.TEMP_EXPORT_VIEW

    sql = SQL("""
DROP VIEW IF EXISTS {schema_name}.{view_name};

CREATE VIEW {schema_name}.{view_name} AS 
SELECT {col_list}, global_id::text 
FROM  
(
    SELECT DISTINCT ON (global_id) {col_list}, {is_deleted}, global_id
    FROM {master_schema_name}.{table_name}    
    WHERE version_id <= {version_id}
    ORDER BY global_id, version_id DESC
) sq WHERE {is_deleted} IS False 
                        """).format(
        schema_name=Identifier(schema_name),
        master_schema_name=Identifier(DbConstants.SCHEMA_MASTER),
        table_name=Identifier(target_table),
        view_name=Identifier(view_name),
        col_list=col_list,
        is_deleted=Identifier(DbConstants.COLUMN_NAME_IS_DELETED),
        version_id=Literal(version_id)
    )

    db_utils.run_sql(conn, sql)


def process_export_master(
    import_config: ImportConfig, custom_version_date, specific_table_names:Union[None,List[str]]=None):
    """
    Main method to take export latest from publication to a shapefile

    """
    log.info("Exporting latest from master schema")

    with db_utils.create_db_connection(import_config.util_cfg) as conn:

        db_utils.create_schema(conn, import_config.util_cfg.STAGING_SCHEMA,
                               "Temporary schema to store imported geometry")

        # first we need to get the exact version we are exporting
        if custom_version_date is not None:
            version_id = get_version_for_date(conn, custom_version_date)
        else:
            version_id = get_latest_version_id(conn)

    file_utils.mkdir_p(DirectoryLocations.EXPORTS_DIR)

    for layer in layers_iterator(import_config.yaml_config, specific_table_names):

        target_table = layer[YamlConfigConstants.TARGET_DB_TABLE_NAME]
        shapefile_path = DirectoryLocations.EXPORTS_DIR / f"{target_table}.shp"

        log.info(f"Exporting {target_table} to {shapefile_path}")

        create_view_for_specific_version(conn, target_table, version_id, schema_name=import_config.util_cfg.STAGING_SCHEMA)

        db_utils.import_geometry_from_postgis_to_shapefile(
            cfg=import_config.util_cfg,
            shapefile_path=shapefile_path,
            schema_name=import_config.util_cfg.STAGING_SCHEMA,
            postgis_table_name=DbConstants.TEMP_EXPORT_VIEW
        )


if __name__ == "__main__":

    main()
