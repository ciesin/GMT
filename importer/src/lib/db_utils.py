import contextlib
import os
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Union, List, Dict

import logging

import psycopg2
from psycopg2._psycopg import Error as PsError, cursor
from psycopg2.extras import DictCursor
from psycopg2.sql import SQL, Identifier, Literal, Composed

from importer.constants import DbConstants
from lib.thread_utils import run_process

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__ )


class UtilConfig(object):
    """
    Class to hold configuration used by utility functions
    """
    OSGEO_BIN_DIR = Path("/usr/local/bin")
    PG_DUMP_PATH = Path("/usr/bin/pg_dump")
    PG_RESTORE_PATH = Path("/usr/bin/pg_restore")
    PG_PSQL_PATH = Path("/usr/bin/psql")

    def __init__(self, db_config, command_line_args):
        self.POSTGRESQL_PORT = int(db_config['port'])
        self.POSTGRESQL_HOST = db_config['host']

        self.POSTGRESQL_USERNAME = command_line_args.username
        self.POSTGRESQL_PASSWORD = command_line_args.password

        if not self.POSTGRESQL_USERNAME:
            log.info(fr"--username argument not provided, attempting to read username from YAML under database\username")
            self.POSTGRESQL_USERNAME = db_config.get("username")

        if not self.POSTGRESQL_PASSWORD:
            log.info(fr"--password argument not provided, attempting to read password from YAML under database\password")
            self.POSTGRESQL_PASSWORD = db_config.get("password")

        if not self.POSTGRESQL_USERNAME:
            log.info(f"username not found in the YAML file, attempting to read POSTGRESQL_USERNAME environment variable")
            self.POSTGRESQL_USERNAME = os.environ.get("POSTGRESQL_USERNAME")

        if not self.POSTGRESQL_PASSWORD:
            log.info(f"password not found in the YAML file, attempting to read POSTGRESQL_PASSWORD environment variable")
            self.POSTGRESQL_PASSWORD = os.environ.get("POSTGRESQL_PASSWORD")

        if not self.POSTGRESQL_PASSWORD:
            log.info("Prompting for password")
            self.POSTGRESQL_PASSWORD = input("Enter your password: ")

        self.POSTGRESQL_DATABASE = db_config['db_name']

        self.STAGING_SCHEMA = f"staging_{self.POSTGRESQL_USERNAME.lower()}"


def create_db_connection(cfg: UtilConfig, connect_to_system_db = False):
    """
    :param cfg: class containing db connection attributes
    :param db_params_prefix: The prefix of the connection parameters
    :return: A psycop2 connection
    """

    trace_log.debug("Creating database connection " +
              " with dbName= " + cfg.POSTGRESQL_DATABASE + " host= " +
              cfg.POSTGRESQL_HOST)

    """

    """

    statement_timeout_minutes = 60

    if timeout_str := os.environ.get("POSTGRESQL_STATEMENT_TIMEOUT"):
        statement_timeout_minutes = int(timeout_str)


    if connect_to_system_db:
        db_name = 'postgres'
    else:
        db_name = cfg.POSTGRESQL_DATABASE

    log.info(f"Statement timeout set to {statement_timeout_minutes} minutes for db {db_name}, host {cfg.POSTGRESQL_HOST} can override with environment variable POSTGRESQL_STATEMENT_TIMEOUT")

    statement_timeout_ms = statement_timeout_minutes * 60 * 1000

    return psycopg2.connect(
        database=db_name,
        host=cfg.POSTGRESQL_HOST,
        port=cfg.POSTGRESQL_PORT,
        user=cfg.POSTGRESQL_USERNAME,
        password=cfg.POSTGRESQL_PASSWORD,
        options=f'-c statement_timeout={statement_timeout_ms}',
        connect_timeout = 120,
                      # tcp_user_timeout=60*60*1000,
        keepalives_idle = 30,
        keepalives_interval = 3,

    )


def sql_as_string(sql: Union[str, Composed], cur):
    if hasattr(sql, "as_string"):
        return sql.as_string(cur)
    else:
        return sql


def execute_sql(conn, sql: Union[str, Composed], query_execute_args=None, suppress_logging=False,
                use_dict_cursor=False) -> cursor:
    """
    Runs SQL

    :param conn:
    :param sql: Either a string or SQL built with psycopg2's SQL class http://initd.org/psycopg/docs/sql.html
    :param query_execute_args: passed directly to execute
    :param suppress_logging:
    :param use_dict_cursor If true, the rows returned can be accessed by column name
    :return:
    """
    cursor_args = {}

    if use_dict_cursor:
        cursor_args['cursor_factory'] = DictCursor

    cur = conn.cursor(**cursor_args)

    # if not suppress_logging:
    #     trace_log.debug(f"Running sql:\n{sql_as_string(sql, cur)}")

    try:
        cur.execute(sql, query_execute_args)

        return cur
    except PsError as ex:

        log.warning(f"Sql:\n{ex}\n\nCaught Programming SQL error: {sql_as_string(sql, cur)}")
        conn.rollback()

        raise


def run_sql(conn, sql: Union[str, Composed], query_execute_args=None, suppress_logging=False) -> int:
    """
    Runs SQL with a commit

    :param conn:
    :param sql: Either a string or SQL built with psycopg2's SQL class http://initd.org/psycopg/docs/sql.html
    :param query_execute_args: passed directly to execute
    :param suppress_logging:
    :return:
    """

    cur = execute_sql(conn, sql, query_execute_args, suppress_logging)

    rowcount = cur.rowcount

    if rowcount > 1 and not suppress_logging:
        log.debug("Number of rows affected: {}".format(rowcount))

    conn.commit()
    return rowcount


def table_exists(conn, schema_name: str, table_name: str):
    cur = conn.cursor()

    assert schema_name is not None

    cur.execute(SQL("""SELECT 1 FROM information_schema.tables WHERE table_name = {} AND table_schema = {}""")
                .format(Literal(table_name), Literal(schema_name)))

    result_count = len(cur.fetchall())

    return result_count > 0


def get_results(conn, sql: Union[str, Composed]):
    cur = execute_sql(conn, sql, suppress_logging=True)

    recs = cur.fetchall()

    if recs is None:
        log.warning(f"Problem with sql: {sql_as_string(sql, cur)}")

        return []

    return recs


def get_results_as_dict_list(conn, sql) -> List:
    """
    Get database results as a list of dictionaries - be careful as I am not sure if the
    order is kept
    :param conn:
    :param sql:
    :param msg_if_no_results:
    :return:
    """
    def clean_column_name(column_name):
        fixed_column_name: str = column_name.replace("\n", "")
        fixed_column_name = fixed_column_name.split("as ")[-1]
        return fixed_column_name.replace(" ", "")

    rows = get_results(conn=conn, sql=sql)
    column_names: List = sql.split("SELECT")[1].split("FROM")[0].split(",")
    column_names = [clean_column_name(column_name) for column_name in column_names]

    results_dict_list = []
    if rows is not None:
        for row in rows:
            results_dict = {}
            for index, column_name in enumerate(column_names):
                results_dict[column_name] = row[index]
            results_dict_list.append(results_dict)

    return results_dict_list


def does_role_exist(cur, role_name) -> bool:
    cur.execute(SQL("""
    SELECT 1 FROM pg_catalog.pg_roles  -- SELECT list can be empty for this
          WHERE  rolname = {}""").format(
        Literal(role_name)
    ))
    recs = cur.fetchall()

    role_exists = recs is not None and len(recs) >= 1

    return role_exists


def get_single_value(conn, sql: Union[str, Composed], msg_if_no_results: Union[None, bool] = None):
    cur = execute_sql(conn, sql)

    rec = cur.fetchone()

    if rec is None or len(rec) < 1:
        if msg_if_no_results:
            log.warning(f"Problem with sql: {sql_as_string(sql, cur)}")

        return None

    return rec[0]


def create_schema(conn, schema_name: str, comment: str = None):
    cur = conn.cursor()

    cur.execute(
        SQL("""
        CREATE SCHEMA IF NOT EXISTS {schema_name};

        """).format(
            schema_name=Identifier(schema_name)
        ))

    if comment:
        cur.execute(SQL("""
        COMMENT ON SCHEMA {} IS {}
        """).format(Identifier(schema_name), Literal(comment)))

    conn.commit()


def set_columns_to_not_null(conn, schema_name: str, table_name: str, not_null_columns: List[str]) -> None:
    sql = SQL("""
    ALTER TABLE {schema_name}.{table_name}
    """).format(schema_name=Identifier(schema_name), table_name=Identifier(table_name))

    sql += SQL(",\n").join([SQL("ALTER COLUMN {} SET NOT NULL").format(Identifier(c)) for c in not_null_columns])

    run_sql(conn, sql)


def drop_table(conn, schema_name, table_name, cascade=False):
    sql = SQL("""
		DROP TABLE IF EXISTS {}.{}
		""").format(Identifier(schema_name), Identifier(table_name))

    if cascade:
        sql += SQL(" CASCADE")

    run_sql(conn, sql, suppress_logging=True)

def drop_view(conn, schema_name, view_name, cascade=False):
    sql = SQL("""
		DROP VIEW IF EXISTS {}.{}
		""").format(Identifier(schema_name), Identifier(view_name))

    if cascade:
        sql += SQL(" CASCADE")

    run_sql(conn, sql, suppress_logging=True)


def get_row_count(conn, schema_name, table_name, return_value_on_table_not_exist=None):
    if not table_exists(conn, schema_name, table_name):
        return return_value_on_table_not_exist

    sql = SQL("""
	SELECT count(*) FROM {}.{}
	""").format(Identifier(schema_name), Identifier(table_name))

    return get_single_value(conn, sql)


def set_primary_key(conn, schema_name, table_name, column_name):
    sql = SQL("""
--drop existing primary key
ALTER TABLE {schema_name}.{table_name}
DROP CONSTRAINT IF EXISTS {};

ALTER TABLE {schema_name}.{table_name}
ADD PRIMARY KEY ({})

""").format(
        Identifier(table_name + "_pkey"),
        Identifier(column_name),
        schema_name=Identifier(schema_name),
        table_name=Identifier(table_name),

    )
    run_sql(conn, sql)



class ConstraintTypes(Enum):
    CHECK = "CHECK"
    UNIQUE = "UNIQUE"
    PK = "PRIMARY KEY"
    FK = "FOREIGN KEY"


class ConstraintKeys(Enum):
    CONSTRAINT_TYPE = "constraint_type"
    COLUMN_NAME = "column_name"



def get_nullable_column_names(conn, schema_name: str, table_name: str, is_nullable=True) -> List[str]:
    sql = SQL("""
SELECT col1.column_name 
FROM information_schema.columns col1

WHERE  col1.table_schema = {}
    AND col1.table_name     = {}
    AND col1.is_nullable = {}

""").format(Literal(schema_name), Literal(table_name), Literal("NO" if not is_nullable else "YES"))

    recs = get_results(conn, sql)

    if recs is None:
        return []

    columns = [r[0] for r in recs]

    return columns


def create_index(conn, schema_name, table_name, column_name, is_geom, check_if_index_exists=True):
    if check_if_index_exists:
        index_records = get_indexes(
            conn, schema_name=schema_name,
            table_name=table_name,
            column_name=column_name
        )
        #trace_log.debug("Found %i existing indexes" % (len(index_records),))

        if index_records:
            # log.debug("Existing index %s" % (index_name,))
            # log.debug("Index already exists, called %s" % (index_name,))
            return

    index_name = "idx_%s_%s" % (table_name, column_name)
    index_name = index_name.lower()

    index_type = 'BTREE'
    if is_geom:
        index_type = "GIST"

    sql = SQL("CREATE INDEX {} ON {}.{} USING {} ({}) ").format(
        Identifier(index_name),
        Identifier(schema_name),
        Identifier(table_name),
        SQL(index_type),
        Identifier(column_name)
    )

    run_sql(conn, sql, suppress_logging=True)


def get_indexes(conn, schema_name, table_name, column_name=None, con_type=None):
    """
    dictionary with keys
    column name,
    schema name,
    table name,
    index name,
    constraint name (can be null)
    contype (p primary key, f foreign key on another table, u unique constraint
    """

    sql = SQL("""
	SELECT 
	a.attname AS column_name, 
	n.nspname AS schema_name, 
	t.relname AS table_name, 
	i.relname AS index_name, 
	con.conname AS constraint_name, 
	con.contype  
FROM pg_index ix LEFT JOIN pg_constraint con ON ix.indexrelid = con.conindid
LEFT JOIN pg_class i ON i.oid = ix.indexrelid
LEFT JOIN pg_class t ON t.oid = indrelid
LEFT JOIN pg_namespace n ON n.oid = t.relnamespace
LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
WHERE n.nspname ILIKE COALESCE({}, n.nspname)
	AND t.relname ILIKE {}
	AND a.attname ILIKE COALESCE({}, a.attname)
	AND con.contype IS NOT DISTINCT FROM COALESCE({}, con.contype)

	""").format(
        Literal(schema_name.lower()),
        Literal(table_name.lower()),
        Literal(column_name.lower() if column_name else None),
        Literal(con_type)
    )

    cur = execute_sql(conn, sql, suppress_logging=True, use_dict_cursor=True)
    ret = cur.fetchall()
    #trace_log.debug(f"Checked indexes with\n{sql_as_string(sql, cur)}.  Returning {len(ret)} results")

    return ret


def add_unique_constraint(conn, schema_name, table_name, column_name, check_if_constraint_exists=True,
                          drop_existing_constraints=False):
    cur = conn.cursor()

    if drop_existing_constraints or check_if_constraint_exists:
        existing_constraints = get_indexes(
            conn=conn,
            schema_name=schema_name,
            table_name=table_name,
            column_name=column_name,
            con_type='u'
        )
    else:
        existing_constraints = []

    # log.debug("Existing constraints: %i", len(existing_constraints))

    if drop_existing_constraints:
        for index_info in existing_constraints:

            if index_info.con_type == 'f':
                continue

            if index_info.constraint_name:
                execute_sql(conn, "ALTER TABLE %s.%s DROP CONSTRAINT %s CASCADE" % (
                    schema_name, table_name, index_info.constraint_name,))
            else:
                execute_sql(conn, "DROP INDEX %s.%s" % (schema_name, index_info.index_name,))
        conn.commit()

    if check_if_constraint_exists and not drop_existing_constraints and len(existing_constraints) > 0:
        return

    execute_sql(conn, sql = SQL("""
    ALTER TABLE {}.{}
    ADD UNIQUE ({});
      """).format(
        Identifier(schema_name),
        Identifier(table_name),
        Identifier(column_name)
    ), )

    conn.commit()


def get_sql_alchemy_connection_string(cfg, db_params_prefix = ""):
    return r'postgresql://%s:%s@%s:%s/%s' % (

       cfg.POSTGRESQL_USERNAME,
       cfg.POSTGRESQL_PASSWORD,
       cfg.POSTGRESQL_HOST,
       cfg.POSTGRESQL_PORT,
       cfg.POSTGRESQL_DATABASE,
    )


def get_ogr_connection_string(cfg):

    return f"host='{cfg.POSTGRESQL_HOST}' " \
           f"port='{cfg.POSTGRESQL_PORT}' " \
           f"dbname='{cfg.POSTGRESQL_DATABASE}' " \
           f"user='{cfg.POSTGRESQL_USERNAME}' " \
           f"password='{cfg.POSTGRESQL_PASSWORD}' "


def restore_publication_dump(cfg, backup_dir, backup_file_name):

    backup_file_path = backup_dir / backup_file_name
    assert backup_file_path.exists(), f"{backup_file_path} not found, please check the database dump exists"

    # Drop Existing publication schema
    sql_cmd = f"DROP SCHEMA IF EXISTS {DbConstants.SCHEMA_TEMP_PUBLICATION} CASCADE;"

    sql_drop_publication_schema_cmd = '"%s" --dbname=%s --host=%s --port=%d --username=%s -c "%s"' % (
        cfg.PG_PSQL_PATH,
        cfg.POSTGRESQL_DATABASE,
        cfg.POSTGRESQL_HOST,
        cfg.POSTGRESQL_PORT,
        cfg.POSTGRESQL_USERNAME,
        sql_cmd)

    log.info("Execute command: " + sql_drop_publication_schema_cmd)
    run_process(
        cmd_line=sql_drop_publication_schema_cmd,
        env_override={
            "PGPASSWORD": cfg.POSTGRESQL_PASSWORD
        }
    )

    log.info("old publication schema dropped")

    # Restore Schema definition
    sql_restore_schema_cmd = '"%s" --dbname=%s --host=%s --port=%d --username=%s --file=%s' % (
        cfg.PG_PSQL_PATH,
        cfg.POSTGRESQL_DATABASE,
        cfg.POSTGRESQL_HOST,
        cfg.POSTGRESQL_PORT,
        cfg.POSTGRESQL_USERNAME,
        f"{backup_file_path}.sql")

    log.info("Execute command: " + sql_restore_schema_cmd)
    run_process(
        cmd_line=sql_restore_schema_cmd,
        env_override={
            "PGPASSWORD": cfg.POSTGRESQL_PASSWORD
        }
    )

    log.info("Schema Restored")

    # Restore data
    sql_restore_data_cmd = '"%s" --dbname=%s --host=%s --port=%d --username=%s --format=d --data-only --single-transaction --disable-triggers --verbose %s' % (
        cfg.PG_RESTORE_PATH,
        cfg.POSTGRESQL_DATABASE,
        cfg.POSTGRESQL_HOST,
        cfg.POSTGRESQL_PORT,
        cfg.POSTGRESQL_USERNAME,
        backup_file_path)

    log.info("Execute command: " + sql_restore_data_cmd)
    run_process(
        cmd_line=sql_restore_data_cmd,
        env_override={
            "PGPASSWORD": cfg.POSTGRESQL_PASSWORD
        }
    )

    log.info("Data Restored")

    # Switch schemas
    current_date = datetime.now()

    backup_schema_name = "{0}{1:%Y%m%d%H%M}".format(DbConstants.SCHEMA_PORTAL_GEOSERVER, current_date)
    sql_cmd = f"DROP SCHEMA IF EXISTS {backup_schema_name} CASCADE; " \
              f"ALTER SCHEMA {DbConstants.SCHEMA_PORTAL_GEOSERVER} RENAME TO {backup_schema_name}old; " \
              f"ALTER SCHEMA {DbConstants.SCHEMA_TEMP_PUBLICATION} RENAME TO {DbConstants.SCHEMA_PORTAL_GEOSERVER};"

    switch_schemas_cmd = '"%s" --dbname=%s --host=%s --port=%d --username=%s -c "%s"' % (
        cfg.PG_PSQL_PATH,
        cfg.POSTGRESQL_DATABASE,
        cfg.POSTGRESQL_HOST,
        cfg.POSTGRESQL_PORT,
        cfg.POSTGRESQL_USERNAME,
        sql_cmd)

    log.info("Execute command: " + switch_schemas_cmd)
    run_process(
        cmd_line=switch_schemas_cmd,
        env_override={
            "PGPASSWORD": cfg.POSTGRESQL_PASSWORD
        }
    )

    log.info("switch done")


def dump_db_publication_schema(cfg, db_params_prefix, backup_dir,
                               dump_schema=True, dump_data=True, backup_file_name=None):


    if not os.path.exists(backup_dir):
        os.makedirs(backup_dir)

    current_date = datetime.now()

    if backup_file_name is None:
        backup_file_name = "{0}.{1}_{2:%Y%m%d_%H%M}".format(cfg.POSTGRESQL_DATABASE,
                                                            DbConstants.SCHEMA_TEMP_PUBLICATION, current_date)

    if dump_schema is True:
        backup_file_path = os.path.join(backup_dir, f"{backup_file_name}.sql")

        sql_backup_cmd = '"%s" --dbname=%s --host=%s --port=%d --username=%s --no-owner --schema=%s --format=p --schema-only --file="%s"' % (
            cfg.PG_DUMP_PATH,
            cfg.POSTGRESQL_DATABASE,
            cfg.POSTGRESQL_HOST,
            cfg.POSTGRESQL_PORT,
            cfg.POSTGRESQL_USERNAME,
            DbConstants.SCHEMA_TEMP_PUBLICATION,
            backup_file_path)

        log.info("Execute command: " + sql_backup_cmd)
        run_process(
            cmd_line=sql_backup_cmd,
            env_override={
                "PGPASSWORD": cfg.POSTGRESQL_PASSWORD
            }
        )

    if dump_data is True:
        backup_file_path = os.path.join(backup_dir, backup_file_name)

        sql_backup_cmd = '"%s" --dbname=%s --host=%s --port=%d --username=%s --no-owner --table=%s.* --format=d --data-only --disable-triggers --quote-all-identifiers --file="%s"' % (
            cfg.PG_DUMP_PATH,
            cfg.POSTGRESQL_DATABASE,
            cfg.POSTGRESQL_HOST,
            cfg.POSTGRESQL_PORT,
            cfg.POSTGRESQL_USERNAME,
            DbConstants.SCHEMA_TEMP_PUBLICATION,
            backup_file_path)

        log.info("Execute command: " + sql_backup_cmd)
        run_process(
            cmd_line=sql_backup_cmd,
            env_override={
                "PGPASSWORD": cfg.POSTGRESQL_PASSWORD
            }
        )


def database_exists(cfg: UtilConfig, db_name):
    with contextlib.closing(create_db_connection(cfg, connect_to_system_db=True)) as conn:

        return get_single_value(conn, SQL("""
        SELECT datname FROM pg_catalog.pg_database WHERE datname = {}""").format(Literal(db_name))) is not None


def get_column_names(conn, schema_name, table_name) -> List[str]:
    recs = get_results(conn, SQL("""
SELECT col1.column_name 
	FROM information_schema.columns col1

	WHERE col1.table_name     = {}	
		AND col1.table_schema = {}
    ORDER BY ordinal_position
""").format(
        Literal(table_name),
        Literal(schema_name)
    ))

    columns = [r[0] for r in recs]

    return columns

# Get materialized view column names
def get_mv_column_names(conn, schema_name, table_name) -> List[str]:
    sql = f"""
    SELECT
       a.attname,
       pg_catalog.format_type(a.atttypid, a.atttypmod),
       a.attnotnull
FROM pg_attribute a
  JOIN pg_class t on a.attrelid = t.oid
  JOIN pg_namespace s on t.relnamespace = s.oid
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND t.relname = '{table_name}' 
  AND s.nspname = '{schema_name}' 
ORDER BY a.attnum;
    """

    recs = get_results(conn, sql)
    columns = [r[0] for r in recs]

    return columns


# This works with materialized views
def get_column_names_using_pg(conn, schema_name, table_name) -> List[str]:

    # https://stackoverflow.com/questions/39179253/postgresql-get-materialized-view-column-metadata
    recs = get_results(conn, SQL("""
    SELECT a.attname,
       pg_catalog.format_type(a.atttypid, a.atttypmod),
       a.attnotnull,
       t.relname,
       s.nspname
FROM pg_attribute a
  JOIN pg_class t on a.attrelid = t.oid
  JOIN pg_namespace s on t.relnamespace = s.oid
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND t.relname = {}
  AND s.nspname = {}
ORDER BY a.attnum;
""").format(
        Literal(table_name),
        Literal(schema_name)
    ))

    columns = [r[0] for r in recs]

    return columns


def get_column_types_as_dict(conn, schema_name, table_name) -> Dict[str,str]:
    sql = SQL("""
WITH equivalents AS 
(
    SELECT * 
    FROM (VALUES ('character varying', 'text') ) AS t (val_from, val_to)
)         
	select column_name, coalesce(e.val_to, c.data_type) 
from information_schema.columns c 
left join equivalents e on c.data_type = e.val_from 
where table_schema = {}
and table_name = {} 
	""").format(
        Literal(schema_name),
        Literal(table_name),
    )

    cur = conn.cursor()

    trace_log.debug(sql.as_string(cur))

    cur.execute(sql)

    return {r[0]: r[1] for r in  cur.fetchall()}



def drop_db_connections(cursor, db_name):
    sql = SQL("""
                   SELECT pg_terminate_backend(pg_stat_activity.pid) 
                   FROM pg_stat_activity 
                   WHERE pg_stat_activity.datname = {} AND pid <> pg_backend_pid();
                   """).format(
        Literal(db_name)
    )
    cursor.execute(sql)


def drop_schema(conn, schema_name):
    # Cleanup any existing tables
    table_names = get_results(conn, f"""
    SELECT table_name FROM information_schema.tables
    where table_schema = '{schema_name}'
    and table_type = 'BASE TABLE'
    
    """)
    if table_names is None:
        table_names = []
    table_names = [t[0] for t in table_names]

    # do this as cascade deleting the schema can be too long
    for table_name in table_names:
        drop_table(conn, schema_name, table_name, cascade=True)

    view_names = get_results(conn, f"""
        SELECT table_name FROM information_schema.tables
        where table_schema = '{schema_name}'
        and table_type = 'VIEW'

        """)
    if view_names is None:
        view_names = []
    view_names = [t[0] for t in view_names]

    # do this as cascade deleting the schema can be too long
    for view_name in view_names:
        drop_view(conn, schema_name, view_name, cascade=True)

    run_sql(conn, f"""
    DROP SCHEMA IF EXISTS {schema_name} CASCADE
    """)


def import_zonalstats_csv_helper(
        conn, csv_path,
        csv_schema_name, csv_table_name,
        extra_comment=None):
    """
    Imports the CSV containing the zonal stats as a CSV
    """

    if extra_comment is None:
        extra_comment = ""

    sql = rf"""
    DROP TABLE IF EXISTS {csv_schema_name}.{csv_table_name};

    CREATE TABLE {csv_schema_name}.{csv_table_name}
    (
        feature_id INT PRIMARY KEY,
        square_count INT,
        square_sum DOUBLE PRECISION    
    );

    COMMENT ON TABLE {csv_schema_name}.{csv_table_name} IS 'raw data from the csv file. {extra_comment}';
    COMMENT ON COLUMN {csv_schema_name}.{csv_table_name}.feature_id IS 'matches id column from feature class'; 
    COMMENT ON COLUMN {csv_schema_name}.{csv_table_name}.square_count IS 'How many raster squares were counted (even if they had no data)';
    COMMENT ON COLUMN {csv_schema_name}.{csv_table_name}.square_sum IS 'Sum of intersecting raster squares';

    """

    run_sql(conn, sql)

    copy_sql = f"""
COPY {csv_schema_name}.{csv_table_name} (feature_id, square_count, square_sum)
FROM STDIN WITH CSV DELIMITER ','
    """

    with open(csv_path, 'r') as csv_file:

        cur = conn.cursor()
        cur.copy_expert(copy_sql, csv_file)
        conn.commit()