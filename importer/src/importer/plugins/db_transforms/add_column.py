import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations, AddColumnValueGenerators, Transformations
from importer.util import ConfigException, DocItem, DbTransformArguments, format_markdown_error, \
    format_missing_columns_msg, format_missing_columns_msg_db
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=Transformations.ADD_COLUMN,
        desc="Add column",
        extended_desc="",
        explicit_yaml_examples=[
            OrderedDict(
                {
                    TransformationParams.COLUMN_NAMES: ["statename", "lganame"]
                }),
            OrderedDict({
                TransformationParams.COLUMN_NAME: "lga_code"
            }),

        ],
        section=YamlConfigConstants.DB_TRANSFORMATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_transform(t_args: DbTransformArguments) -> str:
    conn = t_args.conn
    postgis_table_name = t_args.postgis_table_name
    transform_config = t_args.transform_config

    column_name = transform_config.get(TransformationParams.COLUMN_NAME, None)
    column_type = transform_config.get(TransformationParams.COLUMN_TYPE, "text")
    column_default = transform_config.get(TransformationParams.COLUMN_VALUE, None)

    # if there is a value, assume it's a string and set as the default
    if column_default:
        column_type += f" DEFAULT '{column_default}'"

    is_strict = transform_config.get(TransformationParams.STRICT, True)

    # first get a set of all columns
    db_column_names = db_utils.get_column_names(
        conn=conn,
        schema_name=t_args.staging_schema,
        table_name=postgis_table_name
    )

    markdown_output = ""

    if column_name in db_column_names:
        msg = f"Cannot add column [{column_name}] as it already exists in the table."

        if is_strict:
            raise Exception(msg)
        else:
            markdown_output += "* " + format_markdown_error(msg) + "\n"
            return markdown_output

    sql = SQL("""
    ALTER TABLE {}.{} 
    ADD COLUMN {} {};    
    """).format(
        Identifier(t_args.staging_schema),
        Identifier(postgis_table_name),
        Identifier(column_name),
        SQL(column_type),
    )

    db_utils.run_sql(conn, sql)

    trace_log.debug(sql.as_string(conn))

    markdown_output += f"* Added column \"{column_name}\"\nSQL:\n{sql.as_string(conn)}\n"

    return markdown_output
