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
        name=DbTransformations.STRIP_ALL_WHITESPACE,
        desc="Will strip the whitespace of all text/varchar columns",
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
    transform_config = t_args.transform_config
    layer_config = t_args.layer_config


    sql = SQL("""
        SELECT column_name, data_type, character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = {} and table_name = {}
        """).format(
        Literal(t_args.staging_schema),
        Literal(postgis_table_name)
    )

    results = db_utils.get_results(conn, sql)

    columns_to_trim = []

    for r in results:
        column_name, data_type, character_maximum_length = r

        if data_type in ["character", "text"]:
            columns_to_trim.append(column_name)

    log.debug(f"Trimming {columns_to_trim} in db")
    # trace_log.debug(sql.as_string(conn))

    if len(columns_to_trim) == 0:
        return

    sql = SQL("UPDATE {}.{} SET").format(
        Identifier(t_args.staging_schema),
        Identifier(postgis_table_name))
    sql += SQL(", ").join([SQL("{c} = trim(both from {c})").format(c=Identifier(col)) for col in columns_to_trim])

    db_utils.run_sql(conn, sql)