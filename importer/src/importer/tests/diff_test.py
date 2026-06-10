import re

from osgeo import osr, ogr
from psycopg2.sql import SQL, Literal, Identifier

from importer.constants import YamlConfigConstants, Transformations, TransformationParams, GisFormats
from lib import file_utils
from .fixtures import *
from ..diff.main import generate_diff
from ..util import init_logging

log = logging.getLogger(__name__)



def test_diff_db_nan(cfg, db_test):
    table_name_1 = "Some Points"
    table_name_2 = "Some Points 2"

    staging_name = "stage_unit_test"

    with db_utils.create_db_connection(cfg) as conn:

        db_utils.drop_table(conn, staging_name, table_name_1)
        db_utils.drop_table(conn, staging_name, table_name_2)

        db_utils.create_schema(conn, staging_name)

        sql = SQL("""
        CREATE TABLE {}.{}
        (
            id serial PRIMARY KEY,
            geom GEOMETRY(Point, 4326),
            num double precision,
            name text            
        )""").format(
            Identifier(staging_name),
            Identifier(table_name_1)
        )

        db_utils.run_sql(conn, sql)

        sql = SQL("""
                CREATE TABLE {}.{}
                (
                    id serial PRIMARY KEY,
                    geom GEOMETRY(Point, 4326),
                    num double precision,
                    name text
                )""").format(
            Identifier(staging_name),
            Identifier(table_name_2)
        )

        db_utils.run_sql(conn, sql)

        sql = SQL("""
        INSERT INTO  {s}.{t1}
        (geom, name, num)
        VALUES ( ST_SetSrid(ST_MakePoint(1, 2), 4326), 'bob', 'NaN' );
        INSERT INTO  {s}.{t1}
        (geom, name, num)
        VALUES ( ST_SetSrid(ST_MakePoint(1, 2), 4326), 'row2', 'NaN' );
        INSERT INTO  {s}.{t1}
        (geom, name, num)
        VALUES ( ST_SetSrid(ST_MakePoint(1, 2), 4326), 'row3', 'NaN' );
        
        
        INSERT INTO  {s}.{t2}
        (geom, name, num)
        VALUES ( ST_SetSrid(ST_MakePoint(1, 2), 4326), 'bob', 'NaN' );
        INSERT INTO  {s}.{t2}
        (geom, name, num)
        VALUES ( ST_SetSrid(ST_MakePoint(1, 2), 4326), 'row2b', 'NaN' );
        INSERT INTO  {s}.{t2}
        (geom, name, num)
        VALUES ( ST_SetSrid(ST_MakePoint(1, 2), 4326), 'row3', 3.14 );

            """).format(

               t1= Identifier(table_name_1),
            s=Identifier(staging_name),
            t2=Identifier(table_name_2),
            )

        db_utils.run_sql(conn, sql)

    yml_contents = f"""
    {YamlConfigConstants.DIFF_REPORT}:

      {YamlConfigConstants.OUTPUT_DIRECTORY}: {cfg.PATH_DIFF_OUTPUT}
      {YamlConfigConstants.EXISTING}:
          {YamlConfigConstants.ID_COLUMN}: id
          {YamlConfigConstants.TYPE}: {GisFormats.POSTGIS}
          {YamlConfigConstants.CONNECTION_STRING}: {db_utils.get_ogr_connection_string(cfg)} 
          {YamlConfigConstants.LAYER_NAME}: {staging_name}.{table_name_1}    
      {YamlConfigConstants.UPDATED}:
          {YamlConfigConstants.ID_COLUMN}: id
          {YamlConfigConstants.TYPE}: {GisFormats.POSTGIS}
          {YamlConfigConstants.CONNECTION_STRING}: {db_utils.get_ogr_connection_string(cfg)} 
          {YamlConfigConstants.LAYER_NAME}: {staging_name}.{table_name_2}

    """

    file_utils.mkdir_p(cfg.PATH_TEST_YML_CONFIG.parent)

    with open(cfg.PATH_TEST_YML_CONFIG, "w") as f:
        f.write(yml_contents)

    file_utils.remove_dir(cfg.PATH_DIFF_OUTPUT, "/python_src")
    diff_report_path = cfg.PATH_DIFF_OUTPUT / f"diff_{table_name_1}.md"

    assert not diff_report_path.exists()

    generate_diff(cfg.PATH_TEST_YML_CONFIG, table_name_1)

    assert diff_report_path.exists()

    with open(diff_report_path) as f:
        contents = f.read()
        assert "Configuration problem".lower() not in contents.lower()
        assert "exception" not in contents.lower()

        assert contents.count("| # of unchanged records | 1 |") == 1
        assert contents.count("| # of changed records | 2 |") == 1

        # only one legit nan=> 3.14 change
        assert contents.count("nan") == 1
