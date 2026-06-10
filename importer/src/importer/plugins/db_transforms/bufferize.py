import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, Literal, SQL

from importer.constants import YamlConfigConstants, DbTransformations, TransformationParams, DbConstants
from importer.util import DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=DbTransformations.BUFFERIZE,
        desc="This transformation can bufferize a geometry",
        explicit_yaml_examples=[
            OrderedDict({
                TransformationParams.BUFFER_SIZE: 100,
                TransformationParams.COMMENTS: "Buffer the geometry by 100 meters"
            }),

        ],
        section=YamlConfigConstants.DB_TRANSFORMATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_transform(t_args: DbTransformArguments) -> str:

    # This is the database connection object
    conn = t_args.conn
    postgis_table_name = t_args.postgis_table_name
    transform_config = t_args.transform_config

    log.info("Transform config")
    log.info(transform_config)

    buffer_size = transform_config.get(TransformationParams.BUFFER_SIZE, 100)
    is_multi = transform_config.get("is_multi", False)

    markdown_output = ""

    if is_multi:
        sql = SQL("UPDATE {}.{} SET {} = ST_Multi(ST_Buffer(geom::geography, {})::geometry) ").format(
            Identifier(t_args.staging_schema),
            Identifier(postgis_table_name),
            Identifier(DbConstants.COLUMN_NAME_GEOMETRY),
            Literal(buffer_size)
        )

    else:
        sql = SQL("UPDATE {}.{} SET {} = ST_Buffer(geom::geography, {})::geometry ").format(
            Identifier(t_args.staging_schema),
            Identifier(postgis_table_name),
            Identifier(DbConstants.COLUMN_NAME_GEOMETRY),
            Literal(buffer_size)
        )

    db_utils.run_sql(conn, sql)

    markdown_output += f"Bufferized geometry column by {buffer_size} meters"

    return markdown_output



    #return markdown_output
