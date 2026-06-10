#!/usr/bin/env bash

# set -e
echo "Using DB: ${DB_ADMIN_USER}@${DB_HOST}:${DB_PORT}"
echo "Creating Users and Roles"

psql_admin="psql -v ON_ERROR_STOP=1 -h ${DB_HOST} -p ${DB_PORT} -U ${DB_ADMIN_USER} "
psql_admin_postgres="${psql_admin} --dbname ${POSTGRES_DB} "

# drop connections on new database
PGPASSWORD="${POSTGRES_PASSWORD}" ${psql_admin_postgres} -c "\
SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity \
  WHERE pg_stat_activity.datname in ('${DB_NAME}', '${DB_KEYCLOAK_DATABASE_NAME}') AND pid  <> pg_backend_pid(); \
" || {
    echo "ERROR: failed to terminate all activity on '${DB_NAME}', '${DB_KEYCLOAK_DATABASE_NAME}'";
    exit 1
  }

# Check if users exist before creating them
read -r -d '' create_users_query <<EOSQL
DO
\$do\$
BEGIN
IF NOT EXISTS (SELECT usename FROM pg_user WHERE usename = '${DB_USER_FOR_CREATE}') THEN
    CREATE USER ${DB_USER_FOR_CREATE} WITH PASSWORD '${DB_PWD}';
    GRANT ${DB_USER_FOR_CREATE} TO ${DB_ADMIN_USER_FOR_CREATE};
END IF;

IF NOT EXISTS (SELECT usename FROM pg_user WHERE usename = '${DB_KEYCLOAK_DATABASE_USER_FOR_CREATE}') THEN
    CREATE USER ${DB_KEYCLOAK_DATABASE_USER_FOR_CREATE} WITH PASSWORD '${DB_KEYCLOAK_DATABASE_PASSWORD}';
    GRANT ${DB_KEYCLOAK_DATABASE_USER_FOR_CREATE} TO ${DB_ADMIN_USER_FOR_CREATE};
END IF;
END;
\$do\$
EOSQL

PGPASSWORD="${DB_ADMIN_PASSWORD}" ${psql_admin_postgres} -f <(echo -n "${create_users_query}")

echo "Creating Databases"

create_database_query_1="CREATE DATABASE ${DB_NAME} WITH OWNER ${DB_USER_FOR_CREATE};"

# Check if db exists
PGPASSWORD="${DB_ADMIN_PASSWORD}" ${psql_admin_postgres} -t -c "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 || \
   PGPASSWORD="${POSTGRES_PASSWORD}" ${psql_admin_postgres} -f <(echo -n "${create_database_query_1}")

create_database_query_2="CREATE DATABASE ${DB_KEYCLOAK_DATABASE_NAME} WITH OWNER ${DB_KEYCLOAK_DATABASE_USER_FOR_CREATE};"

# Check if keycloak db exists
PGPASSWORD="${DB_ADMIN_PASSWORD}" ${psql_admin_postgres} -t -c "SELECT 1 FROM pg_database WHERE datname = '${DB_KEYCLOAK_DATABASE_NAME}'" | grep -q 1 || \
  PGPASSWORD="${POSTGRES_PASSWORD}" ${psql_admin_postgres} -f <(echo -n "${create_database_query_2}")

echo "Installing Extensions on ${DB_NAME} database"

PGPASSWORD="${DB_ADMIN_PASSWORD}" ${psql_admin} --dbname "${DB_NAME}" <<-'EOSQL'
  CREATE EXTENSION IF NOT EXISTS "postgis";
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
  CREATE EXTENSION IF NOT EXISTS postgis_topology;
EOSQL

echo "Granting access to topology schema"

grant_topology_access="GRANT USAGE ON SCHEMA topology TO ${DB_USER_FOR_CREATE};
  GRANT ALL ON ALL TABLES IN SCHEMA topology TO ${DB_USER_FOR_CREATE};
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA topology TO ${DB_USER_FOR_CREATE};"

# check if topology schema exists
PGPASSWORD="${DB_ADMIN_PASSWORD}" ${psql_admin} --dbname "${DB_NAME}" -t -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'topology';" | grep -q 1 || \
  PGPASSWORD="${POSTGRES_PASSWORD}" ${psql_admin} --dbname "${DB_NAME}" -f <(echo -n "${grant_topology_access}")

if [ $? -eq 0 ]
then
  echo "  --> OK"
else
  echo " --> Error" >&2
  exit 1
fi

echo "Create Migrations table"

create_migration_table_query="CREATE TABLE IF NOT EXISTS public.migrations (
    id SERIAL NOT NULL,
    name TEXT NOT NULL,
    date_applied TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    version TEXT,
    PRIMARY KEY (id),
    UNIQUE (name)
  );
  GRANT ALL PRIVILEGES ON TABLE public.migrations TO ${DB_USER_FOR_CREATE};
  GRANT ALL PRIVILEGES ON SEQUENCE migrations_id_seq TO ${DB_USER_FOR_CREATE};"

PGPASSWORD="${DB_ADMIN_PASSWORD}" ${psql_admin} --dbname "${DB_NAME}" -f <(echo -n "${create_migration_table_query}")


if [ $? -eq 0 ]
then
  echo "  --> OK"
else
  echo " --> Error" >&2
  exit 1
fi
