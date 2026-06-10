import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations, AddColumnValueGenerators, Transformations
from importer.util import ConfigException, DocItem, DbTransformArguments, format_markdown_error, \
    format_missing_columns_msg, format_missing_columns_msg_db
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=Transformations.RENAME_COLUMNS,
        desc="Renames multiple columns",
        extended_desc="",
        explicit_yaml_examples=[
            OrderedDict({
                TransformationParams.MAPPING: {
                    "old_column_name_1": "new_column_name_1",
                    "old_column_name_2": "new_column_name_2",
                    "old_column_name_3": "new_column_name_3"
                }
            }),
            OrderedDict({
                TransformationParams.STRICT: False,
                TransformationParams.COMMENTS: "if old_column_name_1/2/3 does not exist or if new_column_name_1/2/3 already exist, staging will still succeed with warnings.  Also perform this transformation before any other transformation whose order field is greater than 3.",
                TransformationParams.MAPPING: {
                    "old_column_name_1": "new_column_name_1",
                    "old_column_name_2": "new_column_name_2",
                    "old_column_name_3": "new_column_name_3"
                },
                TransformationParams.ORDER: 3
            })
        ],
        section=YamlConfigConstants.DB_TRANSFORMATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_transform(t_args: DbTransformArguments) -> str:
    conn = t_args.conn
    postgis_table_name = t_args.postgis_table_name
    transform_config = t_args.transform_config

    mapping = transform_config.get(TransformationParams.MAPPING, {})

    the_from = transform_config.get(TransformationParams.COLUMN_NAME, None)
    the_to = transform_config.get(TransformationParams.TO, None)

    if the_from is not None and the_to is not None:
        mapping[the_from] = the_to

    if not mapping:
        raise ConfigException(
            f"{TransformationParams.MAPPING} must be defined.  Or {TransformationParams.COLUMN_NAME} - {the_from}, {TransformationParams.TO} - {the_to}.  Mapping {mapping}.  {transform}")

    is_strict = transform_config.get(TransformationParams.STRICT, True)

    # first get a set of all columns
    db_column_names = db_utils.get_column_names(
        conn=conn,
        schema_name=t_args.staging_schema,
        table_name=postgis_table_name
    )

    markdown_output = ""

    for from_col in mapping:
        to_col = mapping[from_col]

        output = apply_transform_rename_column(conn, db_column_names, {
            TransformationParams.COLUMN_NAME: from_col,
            TransformationParams.TO: to_col,
            TransformationParams.STRICT: is_strict
        }, t_args)

        markdown_output += output

    return markdown_output


def apply_transform_rename_column(conn, db_column_names, transform, t_args: DbTransformArguments) -> str:
    """
    renames a single column

    """
    column_name = transform.get(TransformationParams.COLUMN_NAME, None)

    new_column_name = transform.get(TransformationParams.TO, None)

    is_strict = transform.get(TransformationParams.STRICT, True)

    if not column_name:
        raise ConfigException(f"{TransformationParams.COLUMN_NAME} must be defined. {transform}")

    if not new_column_name:
        raise ConfigException(f"{TransformationParams.TO} must be defined. {transform}")

    # staged data has the columns automatically converted to lower case
    column_name = column_name.lower()

    # PostgreSQL is nicer with all lower case columns
    # and we should never require upper case here in the grid3 schemas
    new_column_name = new_column_name.lower()

    if column_name not in db_column_names:

        msg = f"Cannot rename column \"{column_name}\".  \n"
        msg += format_missing_columns_msg_db(db_column_names, column_name)

        if is_strict:
            raise ConfigException(msg)
        else:
            return f"* {format_markdown_error(msg)}\n"

    if new_column_name in db_column_names:
        msg = f"Cannot rename \"{column_name}\" to \"{new_column_name}\" as \"{new_column_name}\" already exists"
        if is_strict:
            raise ConfigException(msg)
        else:
            return f"* {format_markdown_error(msg)}\n"

    sql = SQL("""
        ALTER TABLE {}.{} 
        RENAME COLUMN {} TO {};    
        """).format(
        Identifier(t_args.staging_schema),
        Identifier(t_args.postgis_table_name),
        Identifier(column_name),
        Identifier(new_column_name),
    )

    db_utils.run_sql(conn, sql)

    trace_log.debug(sql.as_string(conn))

    return f"* Renamed column \"{column_name}\" to \"{new_column_name}\"\n"
