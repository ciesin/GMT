import logging
import sys
from collections import OrderedDict

from psycopg2.sql import Identifier, SQL, Literal

from importer.constants import YamlConfigConstants, TransformationParams, \
    DbConstants, DbTransformations
from importer.util import ConfigException, DocItem, DbTransformArguments
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=DbTransformations.GMT_NAMES,
        desc="GMT Specific name transformations",
        extended_desc="",
        explicit_yaml_examples=[
            OrderedDict({

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
    layer_config = t_args.layer_config
    trace_log.debug("Setting attribute via join")

    markdown_output = ""

    # Loop through the settlement parts

    # See if the settlement name exists in the name table

    # If so, make it primary, we are done

    # If not, create it in the centroid

    # make all other names false


    schema_stage=t_args.staging_schema
    settlement_name_table="name"

    stage_row_count = db_utils.get_row_count(conn, schema_name=t_args.staging_schema,
                                             table_name=postgis_table_name)

    # Set is_primary when settlement name as in the settlement table matches a point
    # after handle duplicate is_primary
    query = SQL("""
        UPDATE {schema_stage}.{postgis_table_name} AS n 
        SET is_primary = true
        FROM settlement.part_latest p 
        WHERE n.settlement_part = p.global_id
         AND p.properties->>'settlement_name' = n.name ;
    """).format(
        schema_stage = Identifier(schema_stage),
        postgis_table_name = Identifier(postgis_table_name)
    )

    row_count = db_utils.run_sql(conn, query)

    markdown_output += f"Set {row_count} rows of {schema_stage} settlement.{postgis_table_name} to is_primary=True\n"

    # Now create a name for settlement parts that have 0 primary names
    db_utils.create_index(conn,
                          schema_name=schema_stage,
                          table_name=postgis_table_name,
                          column_name="settlement_part",
                          is_geom=False,
                          check_if_index_exists=True)

    total_inserted = 0

    while True:
        query = SQL("""
    INSERT INTO {schema_stage}.{postgis_table_name}
    (
        global_id,         
        boundary_polygon,
        geom, 
        
        name,        
        settlement_part,         
        is_primary,  
         
        uninhabited, 
        population_perc,        
        properties,        
        
        row_index,
        problematic
        
    )
    SELECT
        uuid_generate_v4(),
        p.boundary_polygon,
        --There are cases where the centroid is not in the settlement part, which we definitely do not want
        ST_PointOnSurface(p.geom),
        
        p.properties->>'settlement_name',
        p.global_id as settlement_part,         
        true as is_primary,
        
        false as uninhabited,
        100.0 as population_perc,        
        json_build_object('source_table','generated_centroid') as properties,
        
        {stage_rc} + row_number() OVER () as row_index,
        array[]::sn_problematic[] as problematic
         
    FROM settlement.part_latest p 
    WHERE NOT EXISTS (
        SELECT 1 FROM {schema_stage}.{postgis_table_name} n 
        WHERE n.is_primary = True AND n.settlement_part = p.global_id 
    )
    LIMIT 5000;
            """).format(
            schema_stage=Identifier(schema_stage),
            postgis_table_name=Identifier(postgis_table_name),
            stage_rc=Literal(stage_row_count)
        )

        row_count = db_utils.run_sql(conn, query)

        total_inserted += row_count
        stage_row_count += row_count

        if row_count <= 0:
            break

    markdown_output += f"Inserted {total_inserted} new primary name rows of {schema_stage} settlement.{postgis_table_name} from settlement.part\n"

    query = SQL("""
UPDATE {schema_stage}.{postgis_table_name}  
SET is_primary = false
WHERE global_id IN 
(
    SELECT global_id FROM 
    (
        SELECT n.global_id, row_number() OVER ( PARTITION BY settlement_part) as rn 
        FROM {schema_stage}.{postgis_table_name} n 
        WHERE n.is_primary = true
    ) sq1 
    WHERE rn > 1 
);
        """).format(
        schema_stage=Identifier(schema_stage),
        postgis_table_name=Identifier(postgis_table_name)
    )

    row_count = db_utils.run_sql(conn, query)

    markdown_output += f"Set {row_count} duplicate primary names of {schema_stage} settlement.{postgis_table_name} to is_primary=False\n"

    return markdown_output