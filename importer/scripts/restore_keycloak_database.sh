#!/bin/bash -x

# drop connections


echo $DB_KEYCLOAK_DATABASE_NAME

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "postgres" <<-EOSQL

SELECT pg_terminate_backend(pg_stat_activity.pid)
                   FROM pg_stat_activity
                   WHERE pg_stat_activity.datname = '${DB_KEYCLOAK_DATABASE_NAME}' AND pid <> pg_backend_pid();

EOSQL

# Drop / Create database

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "postgres" <<-EOSQL

DROP DATABASE IF EXISTS ${DB_KEYCLOAK_DATABASE_NAME};

CREATE DATABASE ${DB_KEYCLOAK_DATABASE_NAME} WITH OWNER ${DB_USER};

EOSQL

# exit 0

# Restore

PGPASSWORD="${DB_ADMIN_PASSWORD}" pg_restore \
  -U "${DB_ADMIN_USER}" \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  --dbname="${DB_KEYCLOAK_DATABASE_NAME}" \
  --format=d \
 "/data/db_backup_keycloak"

# Reset permissions after restore
PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "${DB_KEYCLOAK_DATABASE_NAME}" <<-EOSQL

ALTER SCHEMA public OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};


EOSQL

# This will set all table owners to DB_USER
PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "${DB_KEYCLOAK_DATABASE_NAME}" <<-EOSQL

do \$\$
declare
    myrow record;
begin
for myrow in
SELECT
     'ALTER TABLE ' ||
     quote_ident(t.schemaname) ||
     '.' ||
     quote_ident(t.tablename) ||
     ' OWNER TO "${DB_USER}";' as tableq
FROM
    (
      SELECT schemaname, tablename
      FROM pg_catalog.pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        AND tableowner != '${DB_USER}'
    ) t
loop
execute myrow.tableq;
end loop;
end;
\$\$;

EOSQL

