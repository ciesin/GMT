import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, DbConstants, DbTransformations
from importer.util import DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
# --verbose log
trace_log = logging.getLogger("trace." + __name__)


def doc():

    d = DocItem(
        name = DbTransformations.INSERT_FROM_MASTER,
        desc = "Add data from master to the staging table",
        extended_desc= "For all current rows in master (after db_filter is applied) whose global_id does not match any global_id "
               "currently in stage will be inserted to stage.  Useful during a partial import to"
               "create a full dataset for a given state (if db_filter is defined to be state_code = XYZ or the entire country if no db_filter is defined.  **IMPORTANT** the staging tables column names & types should 100% master before this transformation is executed!",
        section = YamlConfigConstants.DB_TRANSFORMATIONS,
        explicit_yaml_examples=[
            OrderedDict({
                })
        ]
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_transform(t_args: DbTransformArguments) -> str:
    """
    Performs the database transformation
    :param t_args:
    :return: A string containing markdown that is added to the staging report
    """

    # See comments in DbTransformArguments for more information
    conn = t_args.conn
    postgis_table_name = t_args.postgis_table_name
    layer_config = t_args.layer_config

    schema_name = layer_config[YamlConfigConstants.TARGET_DB_SCHEMA]

    # Get the name of the master view for the target table
    view_name = postgis_table_name + DbConstants.LATEST_VIEW_SUFFIX

    # Use a utility function to get a list of the column names in this view
    view_column_names = db_utils.get_column_names(conn, schema_name=schema_name,
                                                  table_name=view_name)

    # Create a list of Identifiers, used to insert into the SQL query below
    # in a safe way: no SQL injection, quoting is handled.
    col_list = [Identifier(c) for c in view_column_names if c != DbConstants.COLUMN_NAME_VERSION_ID]

    # Avoid circular imports
    from importer.main import get_db_filter

    # Retrieve the db_filter, this is often something like stage_code = 'BR'
    db_filter = get_db_filter(conn, layer_config, staging_schema=t_args.staging_schema)

    # current stage row count
    stage_row_count = db_utils.get_row_count(conn, schema_name=t_args.staging_schema, table_name=postgis_table_name)

    # Build query using the SQL class of psycopg2
    # Often in database transforms we just want to build a single SQL query and run it
    sql = SQL("""
    INSERT INTO {schema_stage}.{stage_table} 
    (
        {col_list}, row_index
    )
    SELECT {col_list}, {src} - 1 + row_number() OVER () as row_index
    FROM {schema_master}.{latest_view} latest 
    WHERE NOT EXISTS 
    (
        SELECT 1 FROM {schema_stage}.{stage_table} stage 
        WHERE stage.global_id = latest.global_id  
    ) AND {db_filter}           
                    """).format(
        schema_stage=Identifier(t_args.staging_schema),
        schema_master=Identifier(schema_name),
        stage_table=Identifier(postgis_table_name),
        latest_view=Identifier(postgis_table_name + DbConstants.LATEST_VIEW_SUFFIX),
        src=Literal(stage_row_count),
        col_list=SQL(", ").join([SQL("{}").format(c) for c in col_list]),
        db_filter=SQL(db_filter)
    )

    # Run the query
    cur = db_utils.execute_sql(conn, sql)

    # Commit the result
    conn.commit()

    # Return some markdown to put in the staging report
    return f"Inserted {cur.rowcount} unchanged records from the latest version" \
           f" (view {DbConstants.SCHEMA_MASTER}.{postgis_table_name + DbConstants.LATEST_VIEW_SUFFIX}" \
           f" to the staging table {t_args.staging_schema}.{postgis_table_name} in master GDB"

