import pytest
from psycopg2._psycopg import Error
from psycopg2.sql import Literal, SQL, Identifier

from lib import db_utils
from lib.test_utils import TestConstants, conn


def test_run_sql_errors(conn):
    schema_name = TestConstants.TEST_SCHEMA
    table_name = 'test_run_sql_errors'

    db_utils.drop_table(conn, schema_name, table_name)

    # use SQL class, no errors
    sql = SQL("""
    	CREATE TABLE {schema_name}.{} 
    	(
    	    a int 
    	);
    	
    	INSERT INTO {schema_name}.{}
    	VALUES  ({}), ({an_int})
    	""").format(
        Identifier(table_name.lower()),
        Identifier(table_name.lower()),
        Literal(42),
        schema_name=Identifier(schema_name.lower()),
        an_int=Literal(37)
    )

    db_utils.run_sql(conn, sql)

    with pytest.raises(Error):
        sql = SQL("""
            	CREATE TABLE {schema_name}.{} 
            	(
            	    a int 
            	);

            	INSERT INTO {schema_name}.{}
            	VALUES  ({}), ({an_int})) --error here
            	""").format(
            Identifier(table_name.lower()),
            Identifier(table_name.lower()),
            Literal(42),
            schema_name=Identifier(schema_name.lower()),
            an_int=Literal(37)
        )

        db_utils.run_sql(conn, sql)

    with pytest.raises(Error):
        sql = f"""
        --table already exists
            	CREATE TABLE {schema_name}.{table_name} 
            	(
            	    a int 
            	);

            	"""

        db_utils.run_sql(conn, sql)

    # test no results cases
    assert db_utils.get_single_value(conn, "Select 1 from information_schema.columns where column_name = 'not exist 33838457'", True) is None

    assert db_utils.get_results(conn,
                                             "Select 1 from information_schema.columns where column_name = 'not exist 33838457'",
                                             ) == []


