import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations, AddColumnValueGenerators, Transformations
from importer.util import ConfigException, DocItem, DbTransformArguments, format_missing_columns_msg_db, \
    format_markdown_error
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=DbTransformations.EMPTY_STRING_TO_NULL,
        desc="Converts empty string to NULL",
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


def do_transform(t_args: DbTransformArguments):
    conn = t_args.conn
    postgis_table_name = t_args.postgis_table_name
    transform_config = t_args.transform_config

    column_name = transform_config.get(TransformationParams.COLUMN_NAME, None)
    columns = transform_config.get(TransformationParams.COLUMN_NAMES, [])

    is_strict = transform_config.get(TransformationParams.STRICT, True)

    if column_name:
        columns.append(column_name)

    # first get a set of all columns
    db_column_names = db_utils.get_column_names(
        conn=conn,
        schema_name=t_args.staging_schema,
        table_name=postgis_table_name
    )

    markdown_output = ""
    for column_name in columns:

        if column_name not in db_column_names:
            err_msg = format_missing_columns_msg_db(db_column_names, column_name)
            msg = f"Cannot set empty strings in column [{column_name}] to NULL.  {err_msg}"

            if is_strict:
                raise Exception(msg)
            else:
                markdown_output += "* " + format_markdown_error(msg) + "\n"
                continue

        sql = SQL("UPDATE {}.{} SET {cn} = NULL where {cn} = ''").format(
            Identifier(t_args.staging_schema),
            Identifier(postgis_table_name),
            cn=Identifier(column_name)
        )

        db_utils.run_sql(conn, sql)