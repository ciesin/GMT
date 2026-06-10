import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations
from importer.util import ConfigException, DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=DbTransformations.EXTRA_COLUMNS_TO_JSON,
        desc="Any non mapped column is added to a json column",
        extended_desc="F",
        explicit_yaml_examples=[
            OrderedDict({

            }),
        ],
        section=YamlConfigConstants.DB_TRANSFORMATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_transform(t_args: DbTransformArguments):
    conn = t_args.conn
    postgres_table_name = t_args.postgis_table_name
    transform_config = t_args.transform_config
    layer_config = t_args.layer_config
    trace_log.debug("Setting attribute via join")

    target_schema_name = layer_config[YamlConfigConstants.TARGET_DB_SCHEMA]

    target_mat_view = transform_config.get(TransformationParams.TARGET_TABLE, postgres_table_name) \
                   + DbConstants.LATEST_VIEW_SUFFIX

    # fetch master columns

    master_columns = db_utils.get_column_names_using_pg(
        conn=conn,
        schema_name=target_schema_name,
        table_name=target_mat_view
    )

    staging_columns = db_utils.get_column_names(
        conn=conn,
        schema_name=t_args.staging_schema,
        table_name=postgres_table_name
    )

    master_columns = set(master_columns)

    if len(master_columns) == 0:
        raise Exception(f"No columns found in {target_schema_name}.{target_mat_view}")

    if DbConstants.COLUMN_NAME_VERSION_ID in master_columns:
        master_columns.remove(DbConstants.COLUMN_NAME_VERSION_ID)

    staging_columns = set(staging_columns)

    staging_columns.remove(DbConstants.COLUMN_NAME_ROW_INDEX)

    staging_not_in_master = staging_columns.difference(master_columns)

    # in all cases create the column
    already_has_property_column = DbConstants.COLUMN_NAME_JSON_PROPERTIES in staging_columns

    if not already_has_property_column:
        sql = SQL("""
            ALTER TABLE {schema}.{table}
        ADD COLUMN {column} jsonb DEFAULT '{{}}'::jsonb
        """).format(
            column=Identifier(DbConstants.COLUMN_NAME_JSON_PROPERTIES),
            schema=Identifier(t_args.staging_schema),
            table=Identifier(postgres_table_name),
        )

        db_utils.run_sql(conn, sql)

    if not staging_not_in_master:
        mc = ", ".join(master_columns)
        sc = ", ".join(staging_columns)
        return f"No columns moved to json.\nMaster columns: {mc}\nStaging columns: {sc}\n"

    if not already_has_property_column:
        sql = SQL("""
       
           UPDATE {schema}.{table} AS layer
           SET {column} = json_strip_nulls(json_build_object({json_arg}))
           """).format(
            column=Identifier(DbConstants.COLUMN_NAME_JSON_PROPERTIES),
            schema=Identifier(t_args.staging_schema),
            table=Identifier(postgres_table_name),
            json_arg=SQL(", ").join(
                [SQL("{}, {}").format(Literal(s), Identifier(s)) for s in
                 staging_not_in_master])
            )
    else:
        sql = SQL("""

                   UPDATE {schema}.{table} AS layer
                   SET {column} = COALESCE({column}::jsonb, '{{}}'::jsonb) || json_strip_nulls(json_build_object({json_arg}))::jsonb
                   """).format(
            column=Identifier(DbConstants.COLUMN_NAME_JSON_PROPERTIES),
            schema=Identifier(t_args.staging_schema),
            table=Identifier(postgres_table_name),
            json_arg=SQL(", ").join(
                [SQL("{}, {}").format(Literal(s), Identifier(s)) for s in
                 staging_not_in_master])
        )

    num_recs = db_utils.run_sql(conn, sql)

    for column_name in staging_not_in_master:
        sql = SQL("""
                ALTER TABLE {}.{} 
                DROP COLUMN {};    
                """).format(
            Identifier(t_args.staging_schema),
            Identifier(postgres_table_name),

            Identifier(column_name),
        )

        db_utils.run_sql(conn, sql)

    cols_str = ", ".join(staging_not_in_master)
    # trace_log.debug(sql.as_string(conn))

    return f"{num_recs} rows updated in \"{postgres_table_name}\" -- Columns converted: {cols_str}"
