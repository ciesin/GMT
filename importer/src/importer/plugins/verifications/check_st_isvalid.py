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
        name=Verifications.CHECK_ST_ISVALID,
        desc="Checks the geometry column contains a valid geometry (PostGis function ST_IsValid returns true)",
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

    v_args.output += "## Verify geometries are valid\n"

    index_column = v_args.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                               YamlConfigConstants.INDEX_COLUMN_DEFAULT)

    sql = SQL("""
        SELECT {}
        FROM {}.{} WHERE ST_IsValid({}) = False  
        """).format(
        Identifier(index_column),
        Identifier(v_args.staging_schema),
        Identifier(v_args.table_name),
        Identifier(v_args.source_geom_info['column_name'])
    )

    rows = db_utils.get_results(v_args.conn, sql)

    if len(rows) > 0:
        v_args.output += f"Invalid rows found ST_IsValid = False\n"
        output_failed_rows(v_args, rows)
        ok = False
    else:
        v_args.output += "All rows have ST_IsValid == True\n"

    return ok