#!/bin/bash -x

PGPASSWORD="${DB_ADMIN_PASSWORD}" pg_restore \
  -U "${DB_ADMIN_USER}" \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  --dbname="${DB_NAME}" \
  --format=d \
  -l \
 "/data/db_backup" | \
grep -v \
-e 'MATERIALIZED VIEW DATA partitions_ri_catchment_item' \
-e 'MATERIALIZED VIEW DATA partitions_settlement_part' \
-e 'MATERIALIZED VIEW DATA partitions_settlement_name' \
-e 'MATERIALIZED VIEW DATA partitions_health_facility_point' \
-e 'MATERIALIZED VIEW partitions_ri_catchment_item' \
-e 'MATERIALIZED VIEW partitions_settlement_part' \
-e 'MATERIALIZED VIEW partitions_settlement_name' \
-e 'MATERIALIZED VIEW partitions_health_facility_point' \
-e 'INDEX partitions_ri_catchment_item' \
-e 'INDEX partitions_settlement_part' \
-e 'INDEX partitions_settlement_name' \
-e 'INDEX partitions_health_facility_point' \
> /data/toc.txt