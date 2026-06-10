#!/bin/bash -x

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "postgres" <<-EOSQL

SELECT pg_terminate_backend(pg_stat_activity.pid)
                   FROM pg_stat_activity
                   WHERE pg_stat_activity.datname = '${DB_NAME}' AND pid <> pg_backend_pid();

EOSQL

# Drop / Create database

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "postgres" <<-EOSQL

DROP DATABASE IF EXISTS ${DB_NAME};

CREATE DATABASE ${DB_NAME} WITH OWNER ${DB_USER};

EOSQL