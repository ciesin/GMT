#!/usr/bin/env bash

#set -e

echo "Cleaning Everything"

query_kill="SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = '${DB_NAME}' AND pid <> pg_backend_pid();"

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" \
  --dbname "${POSTGRES_DB}" \
  -c "${query_kill}"

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" \
  --dbname "${POSTGRES_DB}" \
  -c "DROP DATABASE IF EXISTS ${DB_NAME};"

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" \
  --dbname "${POSTGRES_DB}" \
  -c "DROP DATABASE IF EXISTS ${DB_KEYCLOAK_DATABASE_NAME};"

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" \
  --dbname "${POSTGRES_DB}" \
  -c "DROP OWNED BY ${DB_USER_FOR_CREATE};"

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" \
  --dbname "${POSTGRES_DB}" \
  -c "DROP USER IF EXISTS ${DB_USER_FOR_CREATE};"

