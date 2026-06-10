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
        name=Verifications.CHECK_REGEX,
        desc="Checks a text column matches a given regular expression.",
        explicit_yaml_examples=[
            OrderedDict(
                {
                    TransformationParams.COLUMN_NAME: "ward_code",
                    VerificationParams.REGEX: "\d+",
                    VerificationParams.SHOW_AS_WARNINGS: True,
                    TransformationParams.COMMENTS: "ward code must be numeric"
                 }),
            OrderedDict(
                {
                    TransformationParams.COLUMN_NAME: "name",
                    VerificationParams.REGEX: "t",
                    TransformationParams.CASE_SENSITIVE: False,
                    VerificationParams.INVERT_MATCH: True,
                    VerificationParams.SHOW_AS_WARNINGS: False,
                    TransformationParams.COMMENTS: "name field must not contain the letter t"
                }),
            OrderedDict(
                {
                    TransformationParams.COLUMN_NAME: "name",
                    VerificationParams.REGEX: "^.{15,}$",
                    VerificationParams.SHOW_AS_WARNINGS: False,
                    TransformationParams.COMMENTS: "All names at least 15 characters long"
                })

        ],
        section=YamlConfigConstants.USER_VERIFICATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_verification(v_args: VerificationVars) -> bool:

    test_config = v_args.test_config

    column_name = test_config[TransformationParams.COLUMN_NAME]

    regex = test_config[VerificationParams.REGEX]

    show_as_warnings = test_config.get(VerificationParams.SHOW_AS_WARNINGS, False)

    invert_match = test_config.get(VerificationParams.INVERT_MATCH, False)

    case_sensitive = test_config.get(TransformationParams.CASE_SENSITIVE, True)

    index_column_name = v_args.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                    YamlConfigConstants.INDEX_COLUMN_DEFAULT)

    trace_log.debug(f"Checking regex {index_column_name} with {v_args.staging_schema}"
             f" {v_args.table_name} column_name - {column_name} regex - {regex}")

    if case_sensitive and not invert_match:
        op = "!~"
        match = "match (case sensitive)"
        not_match = f"not {match}"
    elif not case_sensitive and invert_match:
        op = "~*"
        match = "not match (case insensitive)"
        not_match = "match (case insensitive)"
    elif not case_sensitive and not invert_match:
        op = "!~*"
        match = "match (case insensitive)"
        not_match = f"not {match}"
    elif case_sensitive and invert_match:
        op = "~"
        match = "not match (case sensitive)"
        not_match = "match (case sensitive)"

    sql = SQL("""
                SELECT {}, {cn}
                FROM {}.{} WHERE {cn} {op} {}   
                """).format(
            Identifier(index_column_name),
            Identifier(v_args.staging_schema),
            Identifier(v_args.table_name),
            Literal(regex),
            cn= Identifier(column_name),
            op = SQL(op)
        )

    invalid_rows = db_utils.get_results(v_args.conn, sql)
    len_invalid_rows = len(invalid_rows)

    v_args.output += f"## Regular Expression check for {v_args.staging_schema}.{v_args.table_name}.{column_name} using regex: {regex} \n"

    if len_invalid_rows > 0:
        v_args.output += f"Found {len_invalid_rows} rows that do {not_match} the Regular Expression {regex}\n"

        output_failed_rows(v_args, invalid_rows)

        if show_as_warnings:
            return True
        else:
            return False

    v_args.output += f"All rows for column \"{column_name}\" do {match} the regular expression {regex}\n"

    return True