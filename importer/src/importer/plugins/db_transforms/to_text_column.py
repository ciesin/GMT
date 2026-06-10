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
        name=DbTransformations.TO_TEXT_COLUMN,
        desc="Converts a column to text",
        explicit_yaml_examples=[
            OrderedDict(
                {
                    "comment": "Converts lgacode (which contains numbers) to text",
                    TransformationParams.COLUMN_NAME: "lga_code",
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

    sql = SQL("ALTER TABLE {}.{} ALTER COLUMN {} TYPE text ").format(
        Identifier(t_args.staging_schema),
        Identifier(postgis_table_name),
        Identifier(column_name)
    )

    db_utils.run_sql(conn, sql)

    return f"Converted column {column_name} to type text"