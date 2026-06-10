#!/bin/bash 

# drop connections

#DB_NAME=gmt_test

echo $DB_NAME

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "postgres" <<-EOSQL

SELECT pg_terminate_backend(pg_stat_activity.pid)
                   FROM pg_stat_activity
                   WHERE pg_stat_activity.datname = '${DB_NAME}' AND pid <> pg_backend_pid();

EOSQL

# Drop / Create database

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "postgres" <<-EOSQL

DROP DATABASE IF EXISTS ${DB_NAME};

CREATE DATABASE ${DB_NAME} WITH OWNER ${DB_USER};

CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

EOSQL

# exit 0

# Restore

PGPASSWORD="${DB_ADMIN_PASSWORD}" pg_restore \
  -U "${DB_ADMIN_USER}" \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  --dbname="${DB_NAME}" \
  --format=d \
  --no-owner \
 "/data/db_backup"

# Reset permissions after restore
PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "${DB_NAME}" <<-EOSQL

ALTER SCHEMA auth OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO ${DB_USER};
ALTER SCHEMA boundary OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA boundary TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA boundary TO ${DB_USER};
ALTER SCHEMA generic OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA generic TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA generic TO ${DB_USER};
ALTER SCHEMA health_facility OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA health_facility TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA health_facility TO ${DB_USER};
ALTER SCHEMA master OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA master TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA master TO ${DB_USER};
ALTER SCHEMA public OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};
ALTER SCHEMA settlement OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA settlement TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA settlement TO ${DB_USER};
ALTER SCHEMA indicators OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA indicators TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA indicators TO ${DB_USER};

ALTER SCHEMA partitions OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA partitions TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA partitions TO ${DB_USER};

ALTER SCHEMA partitions_health_facility_point OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA partitions_health_facility_point TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA partitions_health_facility_point TO ${DB_USER};
ALTER SCHEMA partitions_settlement_name OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA partitions_settlement_name TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA partitions_settlement_name TO ${DB_USER};
ALTER SCHEMA partitions_settlement_part OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA partitions_settlement_part TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA partitions_settlement_part TO ${DB_USER};
ALTER SCHEMA partitions_ri_catchment_item OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA partitions_ri_catchment_item TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA partitions_ri_catchment_item TO ${DB_USER};

ALTER SCHEMA topology OWNER TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA topology TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA topology TO ${DB_USER};


EOSQL

# This will set all table owners to DB_USER
PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "${DB_NAME}" <<-EOSQL

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
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'topology', 'public')
        AND tableowner != '${DB_USER}'
    ) t
loop
execute myrow.tableq;
end loop;
end;
\$\$;

EOSQL


PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "${DB_NAME}" <<-EOSQL

do \$\$
declare
    myrow record;
begin
for myrow in
SELECT
     'ALTER MATERIALIZED VIEW ' ||
     quote_ident(v.schemaname) ||
     '.' ||
     quote_ident(v.matviewname) ||
     ' OWNER TO "${DB_USER}";' as viewq
FROM
    (
      SELECT schemaname, matviewname
      FROM pg_catalog.pg_matviews
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'topology', 'public')
        AND matviewowner != '${DB_USER}'
    ) v
loop
execute myrow.viewq;
end loop;
end;
\$\$;

EOSQL


# There are less than 40000 mat views.  Doing a bash loop to do this in chunks / batch, 1000 each chunk
# normally with -j 1, the mat views should be populated, keeping this in case though
#for i in {0..40..1}
#do
#PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "${DB_NAME}" <<-EOSQL
#
#do \$\$
#declare
#    myrow record;
#begin
#for myrow in
#SELECT
#     'REFRESH MATERIALIZED VIEW ' ||
#     quote_ident(v.schemaname) ||
#     '.' ||
#     quote_ident(v.matviewname) ||
#     ' ;' as viewq
#FROM
#    (
#      SELECT schemaname, matviewname
#      FROM pg_catalog.pg_matviews
#      WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'topology', 'public')
#      AND NOT ispopulated
#      LIMIT 1000
#    ) v
#loop
#execute myrow.viewq;
#
#end loop;
#end;
#\$\$;
#
#EOSQL
#
#done