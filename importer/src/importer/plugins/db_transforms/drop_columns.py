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
        name=Transformations.DROP_COLUMNS,
        desc="Drops columns",
        extended_desc="Drops columns once data is in staging.  Useful if a column is needed for a db transform but not "
             "part of the master table schema.",
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
            msg = f"Cannot drop column [{column_name}].  {err_msg}"

            if is_strict:
                raise Exception(msg)
            else:
                markdown_output += "* " + format_markdown_error(msg) + "\n"
                continue

        sql = SQL("""
        ALTER TABLE {}.{} 
        DROP COLUMN {};    
        """).format(
            Identifier(t_args.staging_schema),
            Identifier(postgis_table_name),

            Identifier(column_name),
        )

        db_utils.run_sql(conn, sql)

        trace_log.debug(sql.as_string(conn))

        markdown_output += f"* Dropped column \"{column_name}\"\n"

    return markdown_output
