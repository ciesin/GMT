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
        name=DbTransformations.SET_INVALID_WARDCODES_TO_NULL,
        desc="Sets invalid ward codes to NULL",
        extended_desc="If a ward code does not match or has no entry in boundary_wards, sets it to null",
        explicit_yaml_examples=[
            OrderedDict({

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

    # This is the table we are importing to
    postgis_table_name = t_args.postgis_table_name

    markdown_output = ""


    sql = SQL("""
        UPDATE {}.{} AS layer
        SET ward_code = NULL 
        WHERE NOT EXISTS (
            SELECT FROM {}.boundary_wards_latest wards
            WHERE wards.ward_code = layer.ward_code 
                AND ST_Covers(wards.geom, layer.geom)
        )                 
              """).format(
        Identifier(t_args.staging_schema),
        Identifier(postgis_table_name),
        Identifier(DbConstants.SCHEMA_MASTER),

    )

    # DB Utility function, it returns the # of rows changed
    rows_changed = db_utils.run_sql(t_args.conn, sql)

    markdown_output += f"Set {rows_changed} invalid ward codes to NULL\n\n"

    return markdown_output
