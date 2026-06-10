import logging
from collections import OrderedDict

import psycopg2
from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations, AddColumnValueGenerators
from importer.util import ConfigException, DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=DbTransformations.REPROJECT,
        desc="Sets the geom column values to the result of the PostGIS function ST_Convert",
        explicit_yaml_examples=[
            OrderedDict(
            {
                TransformationParams.COMMENTS: ""
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

    target_srid = int(t_args.transform_config.get(TransformationParams.SRID, "4326"))
    target_column = t_args.transform_config.get("target_column", DbConstants.COLUMN_NAME_GEOMETRY)
    source_column = t_args.transform_config.get("source_column", DbConstants.COLUMN_NAME_GEOMETRY)

    try:


        sql = SQL("UPDATE {}.{} SET {tc} = ST_Transform({sc}, {target_srid})").format(
            Identifier(t_args.staging_schema),
            Identifier(postgis_table_name),
            sc=Identifier(source_column),
            tc=Identifier(target_column),
            target_srid=Literal(target_srid)
        )
        markdown_output = f"Ran ST_Transform on {DbConstants.COLUMN_NAME_GEOMETRY} column"

        db_utils.run_sql(conn, sql)

    except psycopg2.errors.InvalidParameterValue as ex:
        markdown_output = f"ST_Transform failed! -- {ex}"

    return markdown_output
