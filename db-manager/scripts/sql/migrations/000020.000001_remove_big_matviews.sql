--These are all partitioned so no need to have this mat views
DROP MATERIALIZED VIEW IF EXISTS settlement.part_latest;
DROP MATERIALIZED VIEW IF EXISTS settlement.name_latest;
DROP MATERIALIZED VIEW IF EXISTS settlement.polygon_latest;
DROP MATERIALIZED VIEW IF EXISTS health_facility.point_latest;
DROP MATERIALIZED VIEW IF EXISTS ri.catchment_item_latest;