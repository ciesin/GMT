import pandas as pd

from importer.constants import YamlConfigConstants, Transformations, \
    TransformationParams, VerificationParams, Verifications, GisFormats, AddColumnValueGenerators
from importer.import_config import ImportConfig
from importer.main import \
    process_import_to_stage
from importer.util import convert_markdown_to_html_and_pdf, init_logging
from importer.verifications import run_verifications
from .fixtures import *
from .util import DummyCommandLineArguments

log = logging.getLogger(__name__)


def test_verifications_geom_column_mismatch(cfg, db_test):
    """
    Tests if the geometry columns between stage and gis_data don't match types & SRID
    """

    test_table_name = "srid_type"

    yml_contents = f"""
    database:
      port: {cfg.POSTGRESQL_PORT}
      db_name: {cfg.POSTGRESQL_DATABASE}
      password: {cfg.POSTGRESQL_PASSWORD}
      username: {cfg.POSTGRESQL_USERNAME}
      host: {cfg.POSTGRESQL_HOST}
    common_layer_config:    
    layers_to_import:
      {test_table_name}:
          {YamlConfigConstants.TYPE}: {GisFormats.POSTGIS}
          {YamlConfigConstants.CONNECTION_STRING}: {db_utils.get_ogr_connection_string(cfg)}
          {YamlConfigConstants.LAYER_NAME}: input.{test_table_name}
          {YamlConfigConstants.TARGET_DB_TABLE_NAME}: {test_table_name}
          {YamlConfigConstants.TARGET_DB_SCHEMA}: {DbConstants.SCHEMA_MASTER}
          {YamlConfigConstants.LAYER_KEY}: {test_table_name}
          {YamlConfigConstants.INDEX_COLUMN}: id
          {YamlConfigConstants.ID_COLUMN}: id

                    """

    file_utils.mkdir_p(cfg.PATH_TEST_YML_CONFIG.parent)

    with open(cfg.PATH_TEST_YML_CONFIG, "w") as f:
        f.write(yml_contents)

    import_config = ImportConfig([cfg.PATH_TEST_YML_CONFIG], command_line_arguments=DummyCommandLineArguments)

    with db_utils.create_db_connection(cfg) as conn:

        staging_name = import_config.util_cfg.STAGING_SCHEMA

        for schema_name in [staging_name, DbConstants.SCHEMA_MASTER]:
            db_utils.drop_table(conn, schema_name, test_table_name)

        db_utils.create_schema(conn, staging_name)

        sql = f"""
        CREATE TABLE {staging_name}.{test_table_name}
        (
            id serial PRIMARY KEY,
            shape GEOMETRY(Polygon, 4326) ,
            state_code text
        );

--INSERT INTO {staging_name}.{test_table_name} VALUES (1, ST_SetSrid(ST_GeomFromText('POLYGON((0 0, 1 1, 1 2, 0 0))'), 4326));

        CREATE TABLE {DbConstants.SCHEMA_MASTER}.{test_table_name}
        (
            id serial PRIMARY KEY,
            shape GEOMETRY(Point, 3857),
            state_code text
        );
            """

        db_utils.run_sql(conn, sql)


        test_data = [[1, "first row"]]
        test_df = pd.DataFrame(test_data, columns=['id', 'name'])

        ok, output = run_verifications(
            import_config,
            layer=import_config.yaml_config[YamlConfigConstants.LAYERS_TO_IMPORT][test_table_name],
            table_name=test_table_name,

        )

        assert ok is False
        assert "3857 => 4326" in output
        assert "POINT => POLYGON" in output


def test_verifications_columns_mismatch(cfg, db_test):
    """
    Between stage and gis_data schemas
    """
    #  pytest /python_src/importer/tests/verifications_test.py --rootdir /python_src -k s_columns
    #init_logging(True)
    test_table_name = "column_mismatch"

    yml_contents = f"""
    database:
      port: {cfg.POSTGRESQL_PORT}
      db_name: {cfg.POSTGRESQL_DATABASE}
      password: {cfg.POSTGRESQL_PASSWORD}
      username: {cfg.POSTGRESQL_USERNAME}
      host: {cfg.POSTGRESQL_HOST}
    common_layer_config:    
    layers_to_import:
      {test_table_name}:
        {YamlConfigConstants.TYPE}: {GisFormats.POSTGIS}
        {YamlConfigConstants.CONNECTION_STRING}: {db_utils.get_ogr_connection_string(cfg)}
        {YamlConfigConstants.LAYER_NAME}: input.{test_table_name}
        {YamlConfigConstants.TARGET_DB_TABLE_NAME}: {test_table_name}
        {YamlConfigConstants.TARGET_DB_SCHEMA}: {DbConstants.SCHEMA_MASTER}
        {YamlConfigConstants.LAYER_KEY}: {test_table_name}
        {YamlConfigConstants.INDEX_COLUMN}: id
        {YamlConfigConstants.ID_COLUMN}: id

                            """

    file_utils.mkdir_p(cfg.PATH_TEST_YML_CONFIG.parent)

    with open(cfg.PATH_TEST_YML_CONFIG, "w") as f:
        f.write(yml_contents)

    import_config = ImportConfig([cfg.PATH_TEST_YML_CONFIG], command_line_arguments=DummyCommandLineArguments)

    staging_name = import_config.util_cfg.STAGING_SCHEMA

    with db_utils.create_db_connection(cfg) as conn:

        for schema_name in [staging_name, DbConstants.SCHEMA_MASTER]:
            db_utils.drop_table(conn, schema_name, test_table_name)

        db_utils.create_schema(conn, staging_name)

        sql = f"""
        CREATE TABLE {staging_name}.{test_table_name}
        (
            id serial PRIMARY KEY,
            shape GEOMETRY(Polygon, 4326),
            text character varying ,
            should_be_equal text,
            should_be_equal_2 varChar,
            i bigint,
            d timestamp with time zone,
            d2 character varying,
            guid character varying,
            state_code text
        );

        INSERT INTO  {staging_name}.{test_table_name}
        (shape, text, state_code)
        VALUES ( ST_Buffer(ST_SetSrid(ST_MakePoint(2, 3), 4326), 50), 'bob', 'KN' ),
        ( ST_Buffer(ST_SetSrid(ST_MakePoint(22, 33), 4326), 50), 'sam', 'KN' );

        CREATE TABLE {DbConstants.SCHEMA_MASTER}.{test_table_name}
        (
            id serial PRIMARY KEY,
            text double precision,
            i integer ,
            should_be_equal character varying not null,
            should_be_equal_2 text,
            shape GEOMETRY(Polygon, 4326),
            d timestamp without time zone,
            d2 timestamp without time zone,
            guid uuid,
            state_code text
        );
            """

        db_utils.run_sql(conn, sql)

        # result, output = process_import_to_stage(import_config)

        test_data = [[1, "first row"]]
        test_df = pd.DataFrame(test_data, columns=['id', 'name'])

        result, output = run_verifications(
            import_config,
            layer = import_config.yaml_config[YamlConfigConstants.LAYERS_TO_IMPORT][test_table_name],
            table_name=test_table_name,

        )

        assert result is False
        print(output)
        assert "should_be_equal" not in output
        assert "\'text\'" in output
        assert "\"guid\"" in output
        assert "\'uuid\'" in output
        assert "\"d2\"" in output
        assert "\"i\"" in output





