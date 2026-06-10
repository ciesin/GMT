import datetime
import logging
import logging
import warnings

from psycopg2.sql import SQL, Identifier

from importer.constants import DbConstants, DirectoryLocations
from importer.diff.config import YamlConfigConstants
from importer.import_config import ImportConfig
from importer.util import layers_iterator
from lib import db_utils, geo_db_utils

# Ignore CSR warnings as pyproj is more recent than geopandas

warnings.simplefilter(action='ignore', category=FutureWarning)

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def create_view_for_stage_export(conn, table_name, schema_name):
    target_table = table_name

    log.info(f"Creating stage view for {target_table} ")

    columns = db_utils.get_column_names(
        conn,
        schema_name=schema_name,
        table_name=target_table)

    columns.remove(DbConstants.COLUMN_NAME_ROW_INDEX)

    has_is_deleted_column = False

    # If we didn't actually run the diff prior to an import, we won't have these columns
    for c in [DbConstants.COLUMN_NAME_IS_NEW, DbConstants.COLUMN_NAME_IS_UPDATED, DbConstants.COLUMN_NAME_IS_DELETED]:
        if c in columns:
            columns.remove(c)

            if c == DbConstants.COLUMN_NAME_IS_DELETED:
                has_is_deleted_column = True

    global_id_exists = DbConstants.COLUMN_NAME_GLOBAL_ID in columns

    # want to change it to text
    if global_id_exists:
        columns.remove(DbConstants.COLUMN_NAME_GLOBAL_ID)

    col_list = SQL(', ').join([Identifier(c) for c in columns])

    view_name = DbConstants.TEMP_EXPORT_VIEW

    if has_is_deleted_column:
        where_clause = f"WHERE {DbConstants.COLUMN_NAME_IS_DELETED} IS False"
    else:
        where_clause = ""

    if global_id_exists:
        gid_clause = SQL(", global_id::text")
    else:
        gid_clause = SQL("")

    sql = SQL("""
DROP VIEW IF EXISTS {schema_name}.{view_name};

CREATE VIEW {schema_name}.{view_name} AS 
SELECT {col_list}{gid_clause} 
FROM {schema_name}.{table_name}
{where_clause}
;
                        """).format(
        schema_name=Identifier(schema_name),
        table_name=Identifier(target_table),
        view_name=Identifier(view_name),
        col_list=col_list,
        gid_clause=gid_clause,
        where_clause = SQL(where_clause)
    )

    db_utils.run_sql(conn, sql)


def process_export_partial(import_config:ImportConfig, specific_table_names, fixed_file_name=True):

    log.info(f"Loading partial datasets")

    with db_utils.create_db_connection(import_config.util_cfg) as conn:
        db_utils.create_schema(conn, import_config.util_cfg.STAGING_SCHEMA, "Temporary schema to store imported geometry")

        # Import layers one by one to the staging schema
        for layer in layers_iterator(import_config.yaml_config, specific_table_names):

            # load target
            postgis_table_name = layer[YamlConfigConstants.TARGET_DB_TABLE_NAME]

            create_view_for_stage_export(conn, postgis_table_name, schema_name=import_config.util_cfg.STAGING_SCHEMA)

            if fixed_file_name:
                shapefile_path = DirectoryLocations.EXPORTS_DIR / f"merged_{postgis_table_name}.shp"
            else:
                file_suffix = datetime.datetime.now().strftime("%Y_%m_%d__%H_%M_%S")
                shapefile_path = DirectoryLocations.EXPORTS_DIR / f"stage_{postgis_table_name}_{file_suffix}.shp"

            geo_db_utils.import_geometry_from_postgis_to_shapefile(
                cfg=import_config.util_cfg,
                shapefile_path=shapefile_path,
                schema_name=import_config.util_cfg.STAGING_SCHEMA,
                postgis_table_name=DbConstants.TEMP_EXPORT_VIEW
            )

            log.info(f"Output shapefile {shapefile_path} from {import_config.util_cfg.STAGING_SCHEMA}.{postgis_table_name}")


def process_export_stage(import_config:ImportConfig, specific_table_names):

    process_export_partial(import_config,specific_table_names, fixed_file_name=False)

