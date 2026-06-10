import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations, AddColumnValueGenerators
from importer.util import ConfigException, DocItem, CaseInsensitively, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=DbTransformations.SET_COLUMN_GEOSPATIALLY,
        desc="Set a column geospatially",
        extended_desc="Sets an attribute geospatially via joins.  Useful for boundary codes.  "
             "If a record already has a value, it is not overwritten.  Only sets null values",
        explicit_yaml_examples=[
            OrderedDict({
                TransformationParams.TARGET_TABLE: "boundary_wards",
                TransformationParams.COLUMN_NAME: "ward_code",
                TransformationParams.METHOD: [TransformationParams.SHAPE_COVERS, TransformationParams.SHAPE_INTERSECTS]
            })
        ],
        section=YamlConfigConstants.DB_TRANSFORMATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_transform(t_args: DbTransformArguments) -> str:
    """
    Purpose is to set values in a column by joining against a master table
    geometrically.

    For example, a poi table has a state_code column, which may contain NULLs.

    This command can be used to join against boundary_states_latest to find the
    state that contains the POI's point.

    :return: Markdown output for the staging report
    """

    transform_config = t_args.transform_config

    # This is the table we are importing to
    postgis_table_name = t_args.postgis_table_name

    target_schema = transform_config.get(TransformationParams.TARGET_SCHEMA,
                                       t_args.layer_config[YamlConfigConstants.TARGET_DB_SCHEMA])

    # The table we will be joining to geospatially containing the information we want
    target_table = transform_config[TransformationParams.TARGET_TABLE]

    # We don't want to join the master.<table> directly as it as all the version history
    # therefore we want the latest view, example master.boundary_wards_latest, which contains only the
    # current rows
    if not target_table.endswith(DbConstants.LATEST_VIEW_SUFFIX):
        trace_log.debug(f"Appending {DbConstants.LATEST_VIEW_SUFFIX} to {target_table} to join against latest version")
        target_table = target_table + DbConstants.LATEST_VIEW_SUFFIX

    # Get the join column
    column_name = transform_config.get(TransformationParams.COLUMN_NAME, None)

    # In a join, the column name will usually be the same, but not always, so allow the source / target column to be
    # specified specifically
    target_column = transform_config.get(TransformationParams.TARGET_COLUMN, column_name)
    source_column = transform_config.get(TransformationParams.SOURCE_COLUMN, column_name)

    filters = transform_config.get(TransformationParams.FILTER, "1=1")

    # Transform parameter on how we will be joining
    method = transform_config.get(TransformationParams.METHOD, TransformationParams.SHAPE_COVERS)

    # make sure we have a list
    method_list = []
    if isinstance(method, list):
        method_list = method
    else:
        method_list.append(method)

    markdown_output = ""

    for method in method_list:
        method_i = CaseInsensitively(method)

        # This query updates the staging table by setting the
        # source column == to the target column in the target table
        # the join is done geospatially with a PostGIS function, like ST_Covers/ST_Intersects/etc.
        # there is also a NULL check to make sure we are not overwriting anything in the staging table
        sql = SQL("""
                UPDATE {}.{} AS layer
                SET {sc} = target.{}
                FROM {}.{} target
                WHERE layer.{sc} IS NULL AND {} AND """).format(
            Identifier(t_args.staging_schema),
            Identifier(postgis_table_name),

            Identifier(target_column),

            Identifier(target_schema),
            Identifier(target_table),
            SQL(filters),
            sc=Identifier(source_column),
        )
        if method_i == TransformationParams.CENTROID_COVERS:
            trace_log.debug("Setting attribute geospatially using centroid / ST_Covers")

            # Use ST_Covers since it should be the same as ST_Intersects
            sql += SQL("ST_Covers(target.{geom}, ST_Centroid(layer.{geom}))").format(
                geom=Identifier(DbConstants.COLUMN_NAME_GEOMETRY)
            )
        elif method_i == TransformationParams.SHAPE_INTERSECTS:
            trace_log.debug("Setting attribute geospatially using shape and ST_Intersects")

            sql += SQL("ST_Intersects(target.{geom}, layer.{geom})").format(
                geom=Identifier(DbConstants.COLUMN_NAME_GEOMETRY)
            )
        elif method_i == TransformationParams.SHAPE_COVERS:
            trace_log.debug("Setting attribute geospatially using ST_Covers")

            sql += SQL("ST_Covers(target.{geom}, layer.{geom})").format(
                geom=Identifier(DbConstants.COLUMN_NAME_GEOMETRY)
            )
        else:
            raise ConfigException(f"Unrecognized method: {method}")

        # DB Utility function, it returns the # of rows changed
        rows_changed = db_utils.run_sql(t_args.conn, sql)

        sql_string = sql.as_string(t_args.conn)

        markdown_output += f"Updated column \"{target_column}\" in {rows_changed} rows using {method}.\nQuery: {sql_string}\n\n"

    return markdown_output
