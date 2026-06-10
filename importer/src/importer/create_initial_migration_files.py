"""
Used to create the schema for the master database.

Used by the tests as well as in command line mode for dev. purposes
"""
import argparse
import logging
import re
import textwrap

import yaml

from importer.constants import DbConstants, DirectoryLocations

from importer.import_config import UtilConfig

from importer.util import init_logging, merge_dictionaries, parse_path
from lib import db_utils, geo_db_utils, file_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def main():
    """
    Main entry point for the application.  Parses command line arguments and executes them.
    """
    parser = argparse.ArgumentParser(description='Creates the initial set of migration files')

    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Set to add more verbose logging')

    parser.add_argument('--clean', action='store_true',
                        help='Clean existing migration files')

    args = parser.parse_args()

    init_logging(args.verbose)

    create_schema(args.clean)


def create_schema(do_clean):

    tables = [
        ("boundary.polygon",
         f"""
    {DbConstants.COLUMN_NAME_GEOMETRY}  geometry(MultiPolygon,4326) NOT NULL,
    name text,
    code text,    
    level smallint NOT NULL,    
    {DbConstants.COLUMN_NAME_JSON_PROPERTIES} jsonb,
"""
         ),
        ("generic.point",
         f"""
    {DbConstants.COLUMN_NAME_GEOMETRY} geometry(Point,4326) NOT NULL,
    name text,
    type text NOT NULL,
    {DbConstants.COLUMN_NAME_JSON_PROPERTIES} jsonb,
"""),
        ("generic.polygon",
         f"""            
       {DbConstants.COLUMN_NAME_GEOMETRY} geometry(MultiPolygon,4326) NOT NULL,
       name text,  
       type text NOT NULL, 
       {DbConstants.COLUMN_NAME_JSON_PROPERTIES} jsonb   ,                                  
                                                          """),

        ("generic.line",
         f"""            
       {DbConstants.COLUMN_NAME_GEOMETRY} geometry(MultiLineString,4326) NOT NULL,
       name text,  
       type text NOT NULL,
       {DbConstants.COLUMN_NAME_JSON_PROPERTIES} jsonb,
                                                              """),


        ("health_facility.point",
         f"""            
    {DbConstants.COLUMN_NAME_GEOMETRY} geometry(Point,4326) NOT NULL,
    name text,
    alt_name text,
    type text,
    {DbConstants.COLUMN_NAME_JSON_PROPERTIES} jsonb,    
              """),
        # ("health_facility.part_hf",
        #  f"""
        #  health_facility_point uuid,
        #  settlement_part uuid,
        #  {DbConstants.COLUMN_NAME_JSON_PROPERTIES} jsonb,
        #  """),
        ("settlement.name",
         f"""            
    {DbConstants.COLUMN_NAME_GEOMETRY} geometry(Point,4326) NOT NULL,
    name text,
    settlement_polygon uuid,
    settlement_part uuid,
    is_primary boolean,
    {DbConstants.COLUMN_NAME_JSON_PROPERTIES} jsonb,
                          """),
        ("settlement.polygon",
         f"""            
    {DbConstants.COLUMN_NAME_GEOMETRY} geometry(MultiPolygon,4326) NOT NULL,        
    name text,
    type text NOT NULL,
    {DbConstants.COLUMN_NAME_JSON_PROPERTIES} jsonb,
                          """),
        ("settlement.part",
         f"""            
           {DbConstants.COLUMN_NAME_GEOMETRY} geometry(MultiPolygon,4326) NOT NULL,
           type text NOT NULL,
           {DbConstants.COLUMN_NAME_JSON_PROPERTIES} jsonb,    
                     """),


    ]

    version_table_name = DbConstants.TABLE_NAME_VERSIONS

    if do_clean:
        file_utils.remove_dir(DirectoryLocations.MIGRATION_DIR, dir_prefix="/data")

    file_utils.mkdir_p(DirectoryLocations.MIGRATION_DIR)

    internal_counter = 1
    def get_filepath_for_table(table_name):
        nonlocal internal_counter
        internal_counter += 1

        file_prefix = f"000002.{internal_counter:06}"
        return DirectoryLocations.MIGRATION_DIR / f"{file_prefix}_{table_name}.sql"

    with open(get_filepath_for_table("schemas"), "w") as f:
        f.write(f"""
CREATE SCHEMA master;        
CREATE SCHEMA generic;
CREATE SCHEMA settlement;
CREATE SCHEMA boundary;
CREATE SCHEMA health_facility; 
            """)

    with open(get_filepath_for_table(version_table_name), "w") as f:

        f.write(f"""
--DROP TABLE IF EXISTS {DbConstants.SCHEMA_MASTER}.{version_table_name} CASCADE;

CREATE TABLE {DbConstants.SCHEMA_MASTER}.{version_table_name}
(
    id bigserial PRIMARY KEY,
    publish_user text DEFAULT(session_user),
    comment text NOT NULL,
    timestamp timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_published boolean NOT NULL DEFAULT (false)
);
 
            """)



    for t in tables:
        schema_table_name, fields = t
        schema_name, table_name = schema_table_name.split(".")

        with open(get_filepath_for_table(schema_table_name), "w") as f:
            split_regex = re.compile(r",\s*\n")
            formatted_fields = [s.strip() for s in split_regex.split(fields)]
            formatted_fields = ",\n".join(formatted_fields)
            formatted_fields = textwrap.indent(formatted_fields, " " * 4)
            f.write(f"""
DROP TABLE IF EXISTS {schema_table_name} CASCADE ;

CREATE TABLE IF NOT EXISTS {schema_table_name}
(
    global_id uuid NOT NULL,
    {DbConstants.COLUMN_NAME_VERSION_ID} bigint NOT NULL REFERENCES {DbConstants.SCHEMA_MASTER}.{version_table_name} (id),
    {DbConstants.COLUMN_NAME_IS_DELETED} bool NOT NULL DEFAULT False,
    boundary_polygon uuid NOT NULL,
{formatted_fields}
    PRIMARY KEY(global_id, version_id)
);
""")

        with open(get_filepath_for_table(schema_table_name + "_index"), "w") as f:
            f.write(f"""
CREATE INDEX {table_name}_geom ON
    {schema_name}.{table_name} USING GIST (geom);

CREATE INDEX {table_name}_boundary_polygon ON
    {schema_name}.{table_name} (boundary_polygon);    
            """)

        with open(get_filepath_for_table(schema_table_name + "_view"), "w") as f:
            schema_view_name = schema_table_name + "_latest"
            view_name = table_name + "_latest"

            col_list = [s.strip().split(" ")[0] for s in split_regex.split(fields)]
            col_list = list(filter(lambda s: s, col_list))
            col_list = ", ".join(col_list)
            f.write(f"""
DROP VIEW IF EXISTS {schema_view_name}; 
CREATE MATERIALIZED VIEW {schema_view_name} AS 
SELECT global_id, boundary_polygon, {col_list}
FROM  
(
    SELECT DISTINCT ON (global_id) global_id, boundary_polygon, {col_list}, {DbConstants.COLUMN_NAME_IS_DELETED}
    FROM {schema_table_name}    
    ORDER BY global_id, version_id DESC 
) sq WHERE {DbConstants.COLUMN_NAME_IS_DELETED} IS False ;
                        """
            )

        with open(get_filepath_for_table(schema_table_name + "_view_index"), "w") as f:
                f.write(f"""
CREATE INDEX {view_name}_geom ON
    {schema_name}.{view_name} USING GIST (geom);

CREATE INDEX {view_name}_boundary_polygon ON
    {schema_name}.{view_name} (boundary_polygon);    
    """)

if __name__ == "__main__":
    main()

