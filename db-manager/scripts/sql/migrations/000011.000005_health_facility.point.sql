DROP TABLE IF EXISTS health_facility.point CASCADE ;

DROP TYPE IF EXISTS health_facility_type CASCADE;
CREATE TYPE health_facility_type AS ENUM (
    'Unknown',
  'Primary',
  'Secondary',
  'Tertiary',

  'Other',
  'Dispensary');

DROP TYPE IF EXISTS health_facility_maturity_level CASCADE ;
CREATE TYPE health_facility_maturity_level AS ENUM (
    'Unknown',
  'Mature',
  'New');

DROP TYPE IF EXISTS health_facility_catchment_status CASCADE ;
CREATE TYPE health_facility_catchment_status AS ENUM (
    'Unknown',
    'Not Started',
    'In Progress',
    'Completed');



CREATE TABLE IF NOT EXISTS health_facility.point
(
    global_id uuid NOT NULL,
    version_id bigint NOT NULL REFERENCES master.commits (id),
    is_deleted bool NOT NULL DEFAULT False,
    boundary_polygon uuid NOT NULL,
    --Health facility points can have a null geometry
    geom geometry(Point,4326) ,
    name text NOT NULL,
    synonyms text[] NOT NULL DEFAULT array[]::text[] ,
    equipment text[] NOT NULL DEFAULT array[]::text[] ,
    ri_service_status boolean NOT NULL DEFAULT True,
    --Null means unknown
    inaccessible boolean,
    --Note that when the concept of microplan versions is introduced, this will need to be in a table
    --containing a PK of hf id and mp version id an containing this field
    catchment_status health_facility_catchment_status NOT NULL DEFAULT 'Unknown',
    type health_facility_type NOT NULL DEFAULT 'Unknown',
    maturity_level health_facility_maturity_level NOT NULL DEFAULT 'Unknown',
    properties jsonb NOT NULL,
    PRIMARY KEY(global_id, version_id)
);


CREATE INDEX point_geom ON
    health_facility.point USING GIST (geom);

CREATE INDEX point_boundary_polygon ON
    health_facility.point (boundary_polygon);



DROP MATERIALIZED VIEW IF EXISTS health_facility.point_latest;
CREATE MATERIALIZED VIEW health_facility.point_latest AS
SELECT global_id, boundary_polygon, geom, name,
       synonyms, equipment, ri_service_status,
       type, maturity_level, catchment_status,
       inaccessible,
       properties,
       version_id
FROM
(
    SELECT DISTINCT ON (global_id) global_id,
        boundary_polygon, geom, name,
        synonyms, equipment, ri_service_status,
        type, maturity_level, catchment_status,
        inaccessible,
        properties,
        version_id,
        is_deleted
    FROM health_facility.point
    ORDER BY global_id, version_id DESC
) sq WHERE is_deleted IS False ;


CREATE INDEX point_latest_geom ON
    health_facility.point_latest USING GIST (geom);

CREATE INDEX point_latest_boundary_polygon ON
    health_facility.point_latest (boundary_polygon);