import logging
from collections import OrderedDict

from importer.main import get_db_filter
from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations, FuzzyMatchers, FuzzyMatcherParams
from importer.util import ConfigException, DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)

def doc():

    d = DocItem(
        name = DbTransformations.FUZZY_MATCH,
        desc = "Sets an attribute based on fuzzy matches",
        extended_desc= "All matchers must match to set the column value.  Most useful to set the global_id of staging rows" + \
                       " to an existing global_id in master for data that is close enough according to the match rules.  Note if there happen to be multiple master rows that match all of the matchers, one of the global_ids will be chosen arbitrarily",
        section = YamlConfigConstants.DB_TRANSFORMATIONS,
        explicit_yaml_examples=[
            OrderedDict({
                TransformationParams.COLUMN_NAME: "global_id",
                TransformationParams.COMMENTS: "Any feature within 200m AND has "
                                               "a levenshtein distance of less than 4 will match.  "
                                               "The column name will be set.  To set other parameters, use "
                f"{DbTransformations.SET_COLUMN_BY_JOIN} with global_id",
                TransformationParams.MATCHERS: [
                    OrderedDict({
                        TransformationParams.TRANSFORM_NAME: FuzzyMatchers.DISTANCE_WITHIN,
                        FuzzyMatcherParams.METERS: 150
                    }),
                    OrderedDict({
                        TransformationParams.TRANSFORM_NAME: FuzzyMatchers.LEVENSHTEIN,
                        TransformationParams.COMMENTS: "Exact match",
                        TransformationParams.COLUMN_NAME: "name",
                        FuzzyMatcherParams.MAX_LEVENSHTEIN_DISTANCE: 0
                    }),
                    OrderedDict({
                        TransformationParams.TRANSFORM_NAME: FuzzyMatchers.LEVENSHTEIN,
                        TransformationParams.COLUMN_NAME: "alt_name",
                        FuzzyMatcherParams.MAX_LEVENSHTEIN_DISTANCE: 4
                    })
                ]
            }),

            OrderedDict({
                TransformationParams.COLUMN_NAME: "global_id",
                TransformationParams.COMMENTS: "Any feature within 50m.  Will not affect any staging row who already has a global_id",
                TransformationParams.MATCHERS: [
                    OrderedDict({
                        TransformationParams.TRANSFORM_NAME: FuzzyMatchers.DISTANCE_WITHIN,
                        FuzzyMatcherParams.METERS: 50
                    }),
                    OrderedDict({
                        TransformationParams.TRANSFORM_NAME: FuzzyMatchers.ONLY_REPLACE_NULLS
                    }),
                ]
            })
        ]
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_transform(t_args: DbTransformArguments) -> str:
    conn = t_args.conn
    postgis_table_name = t_args.postgis_table_name
    transform_config = t_args.transform_config

    column = transform_config.get(TransformationParams.COLUMN_NAME, "global_id")

    matchers = transform_config.get(TransformationParams.MATCHERS, [])

    #db_filter = get_db_filter(conn, t_args.layer_config, staging_schema=t_args.staging_schema)

    filter = transform_config.get(TransformationParams.FILTER, "1=1")

    sql_matchers = []
    matcher_output = []
    for m in matchers:
        matcher_name = m[TransformationParams.TRANSFORM_NAME]
        if matcher_name == FuzzyMatchers.DISTANCE_WITHIN:
            meters = m[FuzzyMatcherParams.METERS]
            sql_matchers.append(
                SQL("ST_DWithin(stage.geom::geography, latest.geom::geography, {meters}) is true").format(
                    meters=Literal(meters)
                )
            )
            matcher_output.append(f"* Geometry within {meters} meters")
        elif matcher_name == FuzzyMatchers.LEVENSHTEIN:
            column_name = m[TransformationParams.COLUMN_NAME]
            max_dist = m.get(
                FuzzyMatcherParams.MAX_LEVENSHTEIN_DISTANCE,
                FuzzyMatcherParams.DEFAULT_MAX_LEVENSHTEIN_DISTANCE)
            sql_matchers.append(
                SQL("levenshtein(COALESCE(stage.{col_name},''), COALESCE(latest.{col_name},'')) <= {max_dist}").format(
                    col_name=Identifier(column_name),
                    max_dist=Literal(max_dist)
                ))
            matcher_output.append(f"* Text/string column \"{column_name}\" within {max_dist} character additions/deletions/changes")
        elif matcher_name == FuzzyMatchers.EQUALS:
            column_name = m[TransformationParams.COLUMN_NAME]
            sql_matchers.append(
                SQL("stage.{col_name} = latest.{col_name}").format(
                    col_name=Identifier(column_name),
                ))
            matcher_output.append(f"* Text/string column \"{column_name}\" equals")
        elif matcher_name == FuzzyMatchers.ONLY_REPLACE_NULLS:
            sql_matchers.append(
                SQL("stage.{col_name} IS NULL").format(
                    col_name=Identifier(column)
                ))
            matcher_output.append(
                f"* Staging column \"{column}\" must be NULL (not replacing any existing values)")
        elif matcher_name == FuzzyMatchers.INTERSECTS:
            sql_matchers.append(
                SQL("ST_Intersects(stage.geom, latest.geom) ").format(
                    col_name=Identifier(column)
                ))
            matcher_output.append(
                f"* Staging geom must intersect target geom")
        else:
            raise ConfigException(f"Unknown matcher {matcher_name}")

    if len(matchers) <= 0:
        raise ConfigException(f"No {TransformationParams.MATCHERS} defined")

    sql = SQL("""   
    WITH filtered_latest as (
        SELECT * FROM {master_schema}.{latest_view} latest WHERE {filter}
    )
    UPDATE {stage_schema}.{t} AS stage 
        SET {cn} = latest.{cn} 
    FROM filtered_latest AS latest
    WHERE {matchers}   
    """).format(
        stage_schema=Identifier(t_args.staging_schema),
        master_schema=Identifier(t_args.layer_config[YamlConfigConstants.TARGET_DB_SCHEMA]),
        t=Identifier(postgis_table_name),
        latest_view=Identifier(postgis_table_name + DbConstants.LATEST_VIEW_SUFFIX),
        matchers=SQL(" AND ").join(sql_matchers),
        cn = Identifier(column),
        filter = SQL(filter)
    )

    num_rows = db_utils.run_sql(conn, sql)

    matcher_str = "\n".join(matcher_output)

    return f"Matched {num_rows} records from {DbConstants.SCHEMA_MASTER} schema (latest committed data).  The \"{column}\" column has been set in the staging table -- {t_args.staging_schema}.{postgis_table_name}\n\nMatchers used:\n{matcher_str}"
