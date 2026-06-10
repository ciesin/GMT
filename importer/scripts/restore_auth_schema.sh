#!/bin/bash -x

# drop connections

#DB_NAME=gmt_test

echo $DB_NAME

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "${DB_NAME}" <<-EOSQL

TRUNCATE TABLE auth.geo_permission CASCADE;
TRUNCATE TABLE auth.permission CASCADE;
TRUNCATE TABLE auth.role CASCADE;
TRUNCATE TABLE auth.role_permission CASCADE;

EOSQL

# Restore

PGPASSWORD="${DB_ADMIN_PASSWORD}" pg_restore \
 -U "${DB_ADMIN_USER}" \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    --dbname="${DB_NAME}" \
 --format=d \
 --verbose \
 --data-only \
 "/data/db_backup_auth"

# Reset permissions after restore and also make sure sequences are correctly set
PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "${DB_NAME}" <<-EOSQL

SELECT setval('auth.permission_id_seq', max(id)) FROM auth.permission;
SELECT setval('auth.role_id_seq', max(id)) FROM auth.role;

ALTER SCHEMA auth OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO ${DB_USER};

EOSQL
