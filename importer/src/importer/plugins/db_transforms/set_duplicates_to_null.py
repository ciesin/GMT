import logging
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations
from importer.util import DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=DbTransformations.SET_DUPLICATES_TO_NULL,
        desc= "Sets duplicate values (arbitrarily leaving one) to NULL.  Useful for non unique global_ids",
        explicit_yaml_examples=[
            OrderedDict(
                {

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

    column = transform_config.get(TransformationParams.COLUMN_NAME, "global_id")

    sql = SQL("""   
    UPDATE {s}.{t} layer
        SET "global_id" = NULL
    FROM (
        SELECT t2.row_index 
        FROM {s}.{t} t1
        INNER JOIN {s}.{t} t2
        on t1.{c} = t2.{c} and t2.{ri} > t1.{ri}
    ) sq
    WHERE layer.row_index = sq.row_index;

    """).format(
        s=Identifier(t_args.staging_schema),
        t=Identifier(postgis_table_name),
        c=Identifier(column),
        ri=Identifier(DbConstants.COLUMN_NAME_ROW_INDEX)
    )

    row_count = db_utils.run_sql(conn, sql)

    return f"Updated {row_count} duplicate guids to null"