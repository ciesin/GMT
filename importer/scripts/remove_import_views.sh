#!/usr/bin/env bash

# Some materialized views that were dropped to save space are needed in the import

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 \
-h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "${DB_NAME}" <<-EOSQL

DROP MATERIALIZED VIEW IF EXISTS settlement.part_latest;
DROP MATERIALIZED VIEW IF EXISTS settlement.name_latest;
DROP MATERIALIZED VIEW IF EXISTS settlement.polygon_latest;
DROP MATERIALIZED VIEW IF EXISTS health_facility.point_latest;
DROP MATERIALIZED VIEW IF EXISTS ri.catchment_item_latest;

EOSQL

