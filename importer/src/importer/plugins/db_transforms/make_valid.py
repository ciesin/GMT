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
        name=DbTransformations.MAKE_VALID,
        desc="Sets the geom column values to the result of the PostGIS function ST_MakeValid",
        explicit_yaml_examples=[
            OrderedDict(
            {
                TransformationParams.COMMENTS: "Will update the geometry column with ST_MakeValid"
            }),
            OrderedDict(
            {
                TransformationParams.COMMENTS: "Will update the geometry column with ST_MakeValid and throw away any resulting non polygon outputs to return 1 MultiPolygon instead of potentially a geometry collection",
                TransformationParams.EXTRACT_MULTIPOLYGON: True
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

    markdown_output = ""

    try:

        if t_args.transform_config.get(TransformationParams.EXTRACT_MULTIPOLYGON, False):
            sql = SQL("UPDATE {}.{} SET {c} = ST_Multi(ST_CollectionExtract(ST_MakeValid({c}), 3)) WHERE NOT ST_IsValid({c}) ").format(
                Identifier(t_args.staging_schema),
                Identifier(postgis_table_name),
                c=Identifier(DbConstants.COLUMN_NAME_GEOMETRY)
            )
            markdown_output = f"Ran ST_MakeValid on {DbConstants.COLUMN_NAME_GEOMETRY} column, extracting polygons to a MultiPolygon"
        else:
            sql = SQL("UPDATE {}.{} SET {c} = ST_MakeValid({c}) WHERE NOT ST_IsValid({c}) ").format(
                Identifier(t_args.staging_schema),
                Identifier(postgis_table_name),
                c=Identifier(DbConstants.COLUMN_NAME_GEOMETRY)
            )
            markdown_output = f"Ran ST_MakeValid on {DbConstants.COLUMN_NAME_GEOMETRY} column"

        db_utils.run_sql(conn, sql)

    except psycopg2.errors.InvalidParameterValue as ex:
        markdown_output = f"Conversion failed! -- {ex}"

    return markdown_output
