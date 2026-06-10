import logging
from collections import OrderedDict

from psycopg2.sql import SQL, Identifier

from importer.constants import DbConstants, YamlConfigConstants, Verifications, TransformationParams
from importer.util import DocItem, \
    VerificationVars
from importer.verifications import output_failed_rows
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=Verifications.CHECK_SELF_INTERSECTION,
        desc="Checks that a geometry does not intersect other geometries in the same staging table",
        extended_desc="Data not being staged or data already in master will NOT be considered in the check",
        explicit_yaml_examples=[
            OrderedDict({
                TransformationParams.COMMENTS: "Failures will prevent staging from succeeding"
            }),
            OrderedDict(

                {
                    TransformationParams.STRICT: False,
                    TransformationParams.COMMENTS: "Failures will not prevent staging from succeeding"
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

    v_args.output += "## Verify No Self Intersections\n"

    # The index column stores a 1 based index, used as part of staging
    index_column = v_args.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                               YamlConfigConstants.INDEX_COLUMN_DEFAULT)

    target_geom_name = DbConstants.COLUMN_NAME_GEOMETRY

    is_strict = test_config.get(TransformationParams.STRICT, True)

    # Run the query
    sql = SQL("""
        
SELECT a1.{ic} 
FROM {sc}.{tn} a1
    INNER JOIN {sc}.{tn} a2 on
ST_Intersects(a1.{gc}, a2.{gc}) and a1.{ic} < a2.{ic}
        """).format(
        # Select the index column as we need it to output the failed ones
        ic=Identifier(index_column),
        sc=Identifier(v_args.staging_schema),
        tn=Identifier(v_args.table_name),
        gc=Identifier(target_geom_name),
    )

    rows = db_utils.get_results(v_args.conn, sql)

    if len(rows) > 0:
        v_args.output += f"{len(rows)} geometries intersected other geometries in staging \n"

        # Use this utility function which will output the actual images of failed rows
        output_failed_rows(v_args, rows)
        ok = False
    else:
        v_args.output += f"No geometries self intersect\n"

    if not is_strict:
        ok = True

    return ok
