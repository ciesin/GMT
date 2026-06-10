import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL

from importer.constants import YamlConfigConstants, TransformationParams, \
    Transformations, DbTransformations
from importer.main import get_db_filter
from importer.util import DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=DbTransformations.DELETE_ROWS,
        desc="Deletes rows in staging table",
        extended_desc=f"Removes rows from staging according to a boolean column.  Use the transform {Transformations.STRING_TO_BOOL} if the column type is not boolean",
        explicit_yaml_examples=[
            OrderedDict(
                {
                    TransformationParams.COLUMN_NAME: "to_remove",
                    TransformationParams.COMMENTS: "Will remove the staging row if the boolean column \"to_remove\" is true"
                }),
            OrderedDict(
                {
                    TransformationParams.WHERE_CLAUSE: "state_code != 'AB'",
                    TransformationParams.COMMENTS: "Will remove the staging row if the string column \"state_code\" is not equal to AB"
                }),
        ],
        section=YamlConfigConstants.DB_TRANSFORMATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_transform(t_args: DbTransformArguments):
    conn = t_args.conn
    postgis_table_name = t_args.postgis_table_name
    transform_config = t_args.transform_config

    column_name = transform_config.get(TransformationParams.COLUMN_NAME, None)

    where_clause = transform_config.get(TransformationParams.WHERE_CLAUSE, None)

    if column_name:
        where_clause = SQL("""
        WHERE COALESCE({}, False) IS True      
        """).format(
            Identifier(column_name),
        )
    elif where_clause:
        where_clause = where_clause.replace("STAGING_SCHEMA", t_args.staging_schema)
        where_clause = where_clause.replace("TABLE_NAME", postgis_table_name)
        db_filter = get_db_filter(conn, t_args.layer_config, staging_schema=t_args.staging_schema)
        where_clause = where_clause.replace("DB_FILTER", db_filter)
        where_clause = SQL("WHERE " + where_clause)
    else:
        raise Exception(f"Must specify either a boolean column name with {TransformationParams.COLUMN_NAME} or a where clause with {TransformationParams.WHERE_CLAUSE}")

    sql = SQL("""
        DELETE FROM {}.{} 
        {}      
        """).format(
            Identifier(t_args.staging_schema),
            Identifier(postgis_table_name),
            where_clause
        )

    num_deleted = db_utils.run_sql(conn, sql)

    trace_log.debug(sql.as_string(conn))

    if column_name:
        return f"Number of rows deleted: {num_deleted} because the column \"{column_name}\" was True"
    else:
        return f"Number of rows deleted: {num_deleted} because matched " + str(transform_config.get(TransformationParams.WHERE_CLAUSE, None))
