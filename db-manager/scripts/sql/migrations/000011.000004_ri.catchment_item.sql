/*
 A catchment is all the settlements assigned to a particular health facility

 Therefor this table is an item of that, which is one settlement + one health facility
 */
CREATE SCHEMA IF NOT EXISTS ri;

DROP TABLE IF EXISTS ri.catchment_item CASCADE ;
DROP TABLE IF EXISTS ri.catchment CASCADE ;

DROP TYPE IF EXISTS transport_method_type CASCADE;

DROP TYPE IF EXISTS strategy_type CASCADE;

CREATE TYPE transport_method_type AS ENUM (
    'unknown', 'moto', 'foot', 'car');
CREATE TYPE strategy_type AS ENUM (
    'unknown', 'fixed_post', 'outreach', 'mobile');
--Fixed post is the people go to the health facility
--Outreach is where the health professionals go to the people; 2-5km
--Mobile is even further >5km
 --0-2km, 2-5km, >5km

CREATE TABLE IF NOT EXISTS ri.catchment_item
(
    global_id uuid NOT NULL,
    version_id bigint NOT NULL REFERENCES master.commits (id),
    is_deleted bool NOT NULL DEFAULT False,
    boundary_polygon uuid NOT NULL,
    geom geometry(Point,4326) NOT NULL,

    name text NOT NULL,
    settlement_name uuid NOT NULL,
    health_facility_point uuid NOT NULL,
    ri_microplan uuid NOT NULL,
    transport_method transport_method_type NOT NULL DEFAULT 'unknown',
    strategy strategy_type NOT NULL DEFAULT 'unknown',
    population_perc real NOT NULL DEFAULT 100.0,
    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY(global_id, version_id)
);



CREATE INDEX catchment_item_boundary_polygon ON
    ri.catchment_item (boundary_polygon);

CREATE INDEX catchment_item_geom ON
    ri.catchment_item USING GIST (geom);


DROP VIEW IF EXISTS ri.catchment_item_latest;
CREATE MATERIALIZED VIEW ri.catchment_item_latest AS
SELECT global_id, boundary_polygon, geom,
       name, settlement_name, health_facility_point,
       population_perc,
       ri_microplan, transport_method, strategy,
       properties
FROM
(
    SELECT DISTINCT ON (global_id) global_id,
        boundary_polygon, geom,
        name, settlement_name, health_facility_point,
        population_perc,
        ri_microplan, transport_method, strategy,
        properties, is_deleted
    FROM ri.catchment_item
    ORDER BY global_id, version_id DESC
) sq WHERE is_deleted IS False ;

CREATE INDEX catchment_item_latest_boundary_polygon ON
    ri.catchment_item_latest (boundary_polygon);

CREATE INDEX catchment_item_latest_geom ON
    ri.catchment_item_latest USING GIST (geom);
