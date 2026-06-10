import logging
import sys
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations
from importer.util import ConfigException, DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=DbTransformations.SET_COLUMN_BY_JOIN,
        desc="Set column from a joined table",
        extended_desc="Fills in null values by joining an existing master view/table via column.  "
             "  For example, a ward (admin 3) could join the lga table in order to "
             "retrieve the lga tables state_code value.",
        explicit_yaml_examples=[
            OrderedDict({
                TransformationParams.TARGET_TABLE: "boundary_lgas",
                TransformationParams.COMMENTS: "Will join the latest master data of boundary_lgas with lga_code, and set"
                                               "the stage tables state_code value",
                TransformationParams.COLUMN_NAME: "state_code",
                TransformationParams.JOIN_COLUMN: "lga_code"
            }),
            OrderedDict({
                TransformationParams.COMMENTS: "Will join the latest master data via global_id and set the 3 columns "
                                               "in the stage table.  Note will not overwrite existing values in stage.  Also note, stage must have "
                                               f"global_id already set, normally {DbTransformations.FUZZY_MATCH} would be used to set these values",
                TransformationParams.COLUMN_NAMES: ["ownership", "functional_status", "type"],
                TransformationParams.JOIN_COLUMN: "global_id"
            })
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
    layer_config = t_args.layer_config
    trace_log.debug("Setting attribute via join")

    schema_name = transform_config.get(TransformationParams.TARGET_SCHEMA,
        layer_config[YamlConfigConstants.TARGET_DB_SCHEMA])

    target_table = transform_config.get(TransformationParams.TARGET_TABLE, postgis_table_name) \
                   + DbConstants.LATEST_VIEW_SUFFIX

    # special case, if target_table is self, we want to get data from the staging column, not a commited latest view
    if "self" == transform_config.get(TransformationParams.TARGET_TABLE, postgis_table_name):
        schema_name = t_args.staging_schema
        target_table = postgis_table_name

    # use column name as a default if defined
    column_names = transform_config.get(TransformationParams.COLUMN_NAMES, [])
    column_name = transform_config.get(TransformationParams.COLUMN_NAME, None)

    if column_name:
        column_names.append(column_name)

    target_column = transform_config.get(TransformationParams.TARGET_COLUMN, column_name)
    source_column = transform_config.get(TransformationParams.SOURCE_COLUMN, column_name)

    if len(column_names) > 0:
        target_columns = column_names
        source_columns = column_names
    else:
        target_columns = [target_column]
        source_columns = [source_column]

    st_columns = zip(source_columns, target_columns)

    join_column = transform_config.get(TransformationParams.JOIN_COLUMN, None)

    target_join_column = transform_config.get(TransformationParams.TARGET_JOIN_COLUMN, join_column).strip()
    source_join_column = transform_config.get(TransformationParams.SOURCE_JOIN_COLUMN, join_column)

    filters = transform_config.get(TransformationParams.FILTER, "1=1")

    if not target_join_column or not source_join_column:
        raise ConfigException(
            f"Must either define {TransformationParams.JOIN_COLUMN}"
            f" or both {TransformationParams.TARGET_JOIN_COLUMN} and {TransformationParams.SOURCE_JOIN_COLUMN}")

    sql = SQL("""
       UPDATE {}.{} AS layer
       SET {set_clauses} 
       FROM {}.{} target
       WHERE layer.{} = target.{} AND {filter} AND ({at_least_one_source_column_is_null})  
       """).format(
        Identifier(t_args.staging_schema),
        Identifier(postgis_table_name),

        Identifier(schema_name),
        Identifier(target_table),

        Identifier(source_join_column),
        # We might need some sql to access JSON properties
        SQL(target_join_column),

        filter=SQL(filters),
        set_clauses=SQL(", ").join(
            [SQL("{s} = COALESCE(layer.{s}, target.{t})").format(s=Identifier(s), t=Identifier(t)) for (s, t) in
             st_columns]
        ),
        at_least_one_source_column_is_null=SQL(" OR ").join(
            [SQL("layer.{s} IS NULL").format(s=Identifier(s)) for s in
             source_columns]
        )
    )

    num_recs = db_utils.run_sql(conn, sql)

    # trace_log.debug(sql.as_string(conn))

    quoted_tc = [f"\"{s}\"" for s in target_columns]

    markdown_return = f"{num_recs} rows updated in \"{postgis_table_name}\" " \
                      f"by joining \"{source_join_column}\" with " \
                      f"\"{target_table}\".\"{target_join_column}\", " \
                      f"set columns: {', '.join(quoted_tc)}"

    markdown_return += "\n Query: " + sql.as_string(conn)

    return markdown_return
