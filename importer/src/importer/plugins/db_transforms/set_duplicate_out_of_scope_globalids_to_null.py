import logging
from collections import OrderedDict

from importer.main import get_db_filter
from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations, AddColumnValueGenerators
from importer.util import ConfigException, DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=DbTransformations.SET_DUPLICATE_OUT_OF_SCOPE_GLOBAL_IDS_TO_NULL,
        desc= "Finds global_ids outside of the db filter / scope that are duplicated with the current staging data",
        explicit_yaml_examples=[
            OrderedDict(
                {

            }),
        ],
        section=YamlConfigConstants.DB_TRANSFORMATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_transform(t_args: DbTransformArguments):
    conn = t_args.conn
    postgis_table_name = t_args.postgis_table_name

    layer_config = t_args.layer_config

    schema_name = layer_config[YamlConfigConstants.TARGET_DB_SCHEMA]

    # Get the name of the master view for the target table
    view_name = postgis_table_name + DbConstants.LATEST_VIEW_SUFFIX

    db_filter = get_db_filter(conn, t_args.layer_config, staging_schema=t_args.staging_schema)

    sql = SQL("""   
    UPDATE {stage_schema}.{table_name} layer
        SET "global_id" = NULL
    WHERE global_id IN (
        SELECT global_id 
        FROM {target_schema}.{latest_view} t1
        WHERE NOT ({db_filter})
    ) ;

    """).format(
        stage_schema=Identifier(t_args.staging_schema),
        target_schema=Identifier(schema_name),
        latest_view=Identifier(view_name),
        table_name=Identifier(postgis_table_name),
        db_filter=SQL(db_filter),
    )

    row_count = db_utils.run_sql(conn, sql)

    return f"Updated {row_count} rows to global_id = NULL since rows outside the db_filter share the same global_id." \
           f" Checked (view {schema_name}.{view_name} not in {db_filter}" \
           f" to the staging table {t_args.staging_schema}.{postgis_table_name} in master GDB"