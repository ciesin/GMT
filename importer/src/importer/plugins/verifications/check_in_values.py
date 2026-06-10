import logging
from collections import OrderedDict

import psycopg2
from psycopg2.sql import SQL, Identifier, Literal

from importer.constants import YamlConfigConstants, TransformationParams, Verifications, \
    VerificationParams
from importer.util import DocItem, \
    VerificationVars, format_markdown_error
from importer.verifications import output_failed_rows
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=Verifications.CHECK_IN_VALUES,
        desc="Validates text column against a list of acceptable values",
        extended_desc="Checks a string column only contains certain values.  Values are case sensitive",
        explicit_yaml_examples=[
            OrderedDict(
                {
                    TransformationParams.COLUMN_NAME: "is_known",
                    VerificationParams.VALUES: ["Yes", "No", "N/A"]
                 }),

        ],
        section=YamlConfigConstants.USER_VERIFICATIONS
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_verification(v_args: VerificationVars) -> bool:

    verification_vars = v_args
    test_config = v_args.test_config
    ok = True

    index_column_name = verification_vars.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                    YamlConfigConstants.INDEX_COLUMN_DEFAULT)

    column_name = test_config[TransformationParams.COLUMN_NAME]

    values = test_config[VerificationParams.VALUES]

    sql = SQL("""
            SELECT {}, {col}
            FROM {}.{} WHERE 
                {col} NOT IN ({vals})
            """).format(
        Identifier(index_column_name),
        Identifier(v_args.staging_schema),
        Identifier(verification_vars.table_name),
        col=Identifier(column_name),
        vals=SQL(", ").join([Literal(v) for v in values])
    )

    verification_vars.output += f"## Values check for {v_args.staging_schema}.{verification_vars.table_name}.{column_name}.  " \
                                f"Values must either be NULL or one of {', '.join(values)}\n"

    try:
        invalid_rows = db_utils.get_results(verification_vars.conn, sql)
    except psycopg2.errors.UndefinedColumn as ex:
        verification_vars.output += format_markdown_error(
            f"A column \"{column_name}\" was not found in the staging table: {ex}") + "\n"
        return False

    len_invalid_rows = len(invalid_rows)

    if len_invalid_rows > 0:
        verification_vars.output += f"Found {len_invalid_rows} rows where {column_name} contains values other than {', '.join(values)}\n"

        output_failed_rows(verification_vars, invalid_rows)

        return False

    verification_vars.output += f"All rows have valid values\n"

    return True