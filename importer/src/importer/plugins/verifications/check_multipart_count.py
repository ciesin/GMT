import logging
from collections import OrderedDict

from psycopg2.sql import SQL, Identifier, Literal

from importer.constants import DbConstants, YamlConfigConstants, Verifications, VerificationParams, TransformationParams
from importer.util import DocItem, \
    VerificationVars
from importer.verifications import output_failed_rows, output_failed_rows_with_shape
from lib import db_utils, geo_db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=Verifications.CHECK_MULTIPART_COUNT,
        desc="Checks that a multi geometry column does not contain more than the given amount of parts",
        explicit_yaml_examples=[
            OrderedDict(
                {
                    TransformationParams.COMMENTS: "Checks the Geometry column does not have more than 1 polygon.  Any issues found will be shown as warnings.",
                    VerificationParams.MAX_COUNT: 2,
                    VerificationParams.SHOW_AS_WARNINGS: True
                 }),

        ],
        section=YamlConfigConstants.USER_VERIFICATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_verification(v_args: VerificationVars) -> bool:
    """

    :param v_args:
    :return: True if the check passed, False if otherwise.  False means that the staging step will fail.
    """

    test_config = v_args.test_config
    ok = True

    v_args.output += "## Verify Multipart geometry count\n"

    # The index column stores a 1 based index, used as part of staging
    index_column = v_args.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                               YamlConfigConstants.INDEX_COLUMN_DEFAULT)

    # Get from the database the name of the column holding the Geometry
    target_geom_info = geo_db_utils.get_geometry_column_info(v_args.conn,
                                                             schema_name=DbConstants.SCHEMA_MASTER,
                                                             table_name=v_args.table_name)
    target_geom_name = target_geom_info['column_name']

    # Get the upper limit as conifugred in the YAML
    num_geometries = test_config.get(VerificationParams.MAX_COUNT)

    # Another parameter, show only warnings?
    show_as_warnings = test_config.get(VerificationParams.SHOW_AS_WARNINGS, False)

    # Run the query
    sql = SQL("""
        SELECT {}
        FROM {}.{} 
        WHERE 
        {gc} IS NOT NULL AND 
        NOT ST_IsEmpty({gc}) AND 
        ST_NumGeometries({gc}) > {}  
        """).format(
        # Select the index column as we need it to output the failed ones
        Identifier(index_column),
        Identifier(v_args.staging_schema),
        Identifier(v_args.table_name),
        Literal(num_geometries),
        gc=Identifier(target_geom_name),
    )

    rows = db_utils.get_results(v_args.conn, sql)

    if len(rows) > 0:
        v_args.output += f"{len(rows)} multipart geometries that had more than {num_geometries} polygons/lines/points \n"

        # Use this utility function which will output the actual images of failed rows
        output_failed_rows_with_shape(v_args, rows, geometry_column_name= target_geom_name)
        ok = False
    else:
        v_args.output += f"All rows <= {num_geometries} polygons\n"

    if show_as_warnings:
        ok = True

    return ok
