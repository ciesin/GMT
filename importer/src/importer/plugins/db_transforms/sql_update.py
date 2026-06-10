import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations, AddColumnValueGenerators, Transformations
from importer.util import ConfigException, DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=Transformations.SQL_UPDATE,
        desc="Sets values in the database with SQL UPDATE",
        explicit_yaml_examples=[
            OrderedDict(
                {
                    TransformationParams.COLUMN_NAME: "source",
                    TransformationParams.COLUMN_VALUE: 'other_col',
                    TransformationParams.WHERE_CLAUSE: "other_col IS NOT NULL",
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

    markdown_output = ""

    column_name = transform_config.get(TransformationParams.COLUMN_NAME, None)

    value = transform_config.get(TransformationParams.COLUMN_VALUE, None)

    where = transform_config.get(TransformationParams.WHERE_CLAUSE, "1=1")

    sql = SQL("UPDATE {}.{} SET {c} = {v} WHERE {w}").format(
        Identifier(t_args.staging_schema),
        Identifier(postgis_table_name),
        v=SQL(value),
        w=SQL(where),
        c=Identifier(column_name)
    )

    markdown_output += f"Set column {column_name} to {value}"

    num_records = db_utils.run_sql(conn, sql)

    markdown_output += f"\n\n{num_records} rows updated"

    return markdown_output