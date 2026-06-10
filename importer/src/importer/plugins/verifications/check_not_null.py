import logging
from collections import OrderedDict

from psycopg2.sql import SQL, Identifier

from importer.constants import YamlConfigConstants, TransformationParams, Verifications
from importer.util import DocItem, \
    VerificationVars, format_missing_columns_msg_db, format_markdown_error
from importer.verifications import output_failed_rows
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=Verifications.CHECK_NOT_NULL,
        desc="Checks a column does not contain NULL, meaning it has values.  Note that the system automatically checks if stage_code and global_id are not NULL",
        explicit_yaml_examples=[
            OrderedDict(
                {
                    TransformationParams.COLUMN_NAME: "lga_code",
                 }),
            OrderedDict(
                {
                    TransformationParams.COLUMN_NAMES: ["ward_code", "ward_name", "source"],
                    TransformationParams.STRICT: False,
                    TransformationParams.COMMENTS: "Staging will not fail if null values exist in these columns; instead warnings will be shown"
                }),
        ],
        section=YamlConfigConstants.USER_VERIFICATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_verification(v_args: VerificationVars) -> bool:

    test_config = v_args.test_config

    column_name = test_config.get(TransformationParams.COLUMN_NAME)
    column_names = test_config.get(TransformationParams.COLUMN_NAMES, [])

    is_strict = test_config.get(TransformationParams.STRICT, True)

    if column_name:
        column_names.append(column_name)

    index_column_name = v_args.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                    YamlConfigConstants.INDEX_COLUMN_DEFAULT)

    actual_stage_column_names = db_utils.get_column_names(v_args.conn, v_args.staging_schema, v_args.table_name)

    for column_name in column_names:

        v_args.output += f"## NULL check for {v_args.staging_schema}.{v_args.table_name}.{column_name}\n"

        if column_name not in actual_stage_column_names:
            msg = format_missing_columns_msg_db(actual_stage_column_names, column_name)

            v_args.output += f"\n{format_markdown_error(msg)}\n\n"
            if is_strict:
                return False

            continue

        sql = SQL("""
                SELECT {}
                FROM {}.{} WHERE {} IS NULL   
                """).format(
            Identifier(index_column_name),
            Identifier(v_args.staging_schema),
            Identifier(v_args.table_name),
            Identifier(column_name)
        )

        null_rows = db_utils.get_results(v_args.conn, sql)

        len_null_rows = len(null_rows)

        if len_null_rows > 0:
            v_args.output += f"Found {len_null_rows} NULL rows\n"

            output_failed_rows(v_args, null_rows)
            v_args.output += "\n"

            if is_strict:
                return False
            else:
                # show as warnings
                return True

        v_args.output += f"All rows have a value for \"{column_name}\"\n\n"

    return True