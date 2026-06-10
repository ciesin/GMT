import logging
from collections import OrderedDict

from psycopg2.sql import SQL, Identifier

from importer.constants import YamlConfigConstants, Verifications
from importer.util import DocItem, \
    VerificationVars
from importer.verifications import output_failed_rows
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=Verifications.CHECK_NON_EMPTY_GEOM,
        desc="Checks the geometry column is not NULL and contains a non empty value "
             "(PostGis function ST_IsEmpty returns false)",
        explicit_yaml_examples=[
            OrderedDict(
                {

                 }),

        ],
        section=YamlConfigConstants.USER_VERIFICATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_verification(v_args: VerificationVars) -> bool:

    ok = True

    v_args.output += "## Verify geometries are not null and not ST_IsEmpty\n"

    index_column = v_args.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                               YamlConfigConstants.INDEX_COLUMN_DEFAULT)

    sql = SQL("""
            SELECT {}
            FROM {}.{} WHERE {c} IS NULL OR ST_IsEmpty({c})  
            """).format(
        Identifier(index_column),
        Identifier(v_args.staging_schema),
        Identifier(v_args.table_name),
        c=Identifier(v_args.source_geom_info['column_name'])
    )

    rows = db_utils.get_results(v_args.conn, sql)

    if len(rows) > 0:
        v_args.output += f"\nNULL or empty geometries found\n"
        output_failed_rows(v_args, rows)
        ok = False

    else:
        v_args.output += "All a non empty / non NULL value in the geometry column\n"

    return ok