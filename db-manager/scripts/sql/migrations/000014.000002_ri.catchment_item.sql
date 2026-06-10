ALTER TABLE ri.catchment_item
DROP column strategy cascade ;

DROP TYPE IF EXISTS strategy_type CASCADE;

ALTER TABLE ri.catchment_item
RENAME COLUMN "settlement_name" TO "settlement_part";

ALTER TABLE ri.catchment_item
ADD COLUMN "exclude" boolean NOT NULL DEFAULT False;

ALTER TABLE ri.catchment_item
    DROP COLUMN "name" CASCADE ;


DROP MATERIALIZED VIEW IF EXISTS ri.catchment_item_latest;
CREATE MATERIALIZED VIEW ri.catchment_item_latest AS
SELECT global_id, boundary_polygon, geom,
       health_facility_point,
       population_perc,
       ri_microplan, transport_method,
       properties,
       exclude, settlement_part
FROM
(
    SELECT DISTINCT ON (global_id) global_id,
        boundary_polygon, geom,
        health_facility_point,
        population_perc,
        ri_microplan, transport_method,
        properties, is_deleted,
        exclude, settlement_part
    FROM ri.catchment_item
    ORDER BY global_id, version_id DESC
) sq WHERE is_deleted IS False ;

CREATE INDEX catchment_item_latest_boundary_polygon ON
    ri.catchment_item_latest (boundary_polygon);

CREATE INDEX catchment_item_latest_geom ON
    ri.catchment_item_latest USING GIST (geom);

--ALTER MATERIALIZED VIEW ri.catchment_item_latest OWNER TO "gmt_dev";
--ALTER MATERIALIZED VIEW ri.catchment_item_latest OWNER TO "gmt_test";