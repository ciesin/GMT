import logging
from collections import OrderedDict

from psycopg2.sql import SQL, Identifier, Literal

from importer.constants import DbConstants, YamlConfigConstants, TransformationParams, Verifications, \
    VerificationParams
from importer.util import DocItem, \
    VerificationVars
from importer.verifications import output_failed_rows
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=Verifications.CHECK_STRING_LENGTH,
        desc="Checks the length of a text field in the database is less than or equal to a certain limit.",
        explicit_yaml_examples=[
            OrderedDict(
                {
                    TransformationParams.COLUMN_NAME: "ward_code",
                    VerificationParams.MAX_LENGTH: 15,
                    VerificationParams.SHOW_AS_WARNINGS: True,
                    TransformationParams.COMMENTS: "Field must not be longer than 15 characters"
                 }),

        ],
        section=YamlConfigConstants.USER_VERIFICATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_verification(v_args: VerificationVars) -> bool:

    test_config = v_args.test_config

    column_name = test_config[TransformationParams.COLUMN_NAME]

    max_length = test_config[VerificationParams.MAX_LENGTH]

    show_as_warnings = test_config.get(VerificationParams.SHOW_AS_WARNINGS, False)

    index_column_name = v_args.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                    YamlConfigConstants.INDEX_COLUMN_DEFAULT)

    trace_log.debug(f"Checking length {index_column_name} with {v_args.staging_schema}"
             f" {v_args.table_name} column_name - {column_name} max length - {max_length}")

    sql = SQL("""
                SELECT {}, {cn}
                FROM {}.{} 
                WHERE length({cn}) > {ml};   
                """).format(
            Identifier(index_column_name),
            Identifier(v_args.staging_schema),
            Identifier(v_args.table_name),
            cn= Identifier(column_name),
            ml = Literal(int(max_length))
        )

    invalid_rows = db_utils.get_results(v_args.conn, sql)
    len_invalid_rows = len(invalid_rows)

    v_args.output += f"## Max length check for {v_args.staging_schema}.{v_args.table_name}.{column_name} using max length: {max_length} characters \n"

    if len_invalid_rows > 0:
        v_args.output += f"Found {len_invalid_rows} rows that are longer than {max_length} characters\n"

        output_failed_rows(v_args, invalid_rows)

        if show_as_warnings:
            return True
        else:
            return False

    v_args.output += f"All rows for column \"{column_name}\" are <= {max_length} characters\n"

    return True
