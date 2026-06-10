DROP TYPE IF EXISTS health_facility_strategy CASCADE;

CREATE TYPE health_facility_strategy AS ENUM (
    'unknown',
    'fixed_post',
  'outreach',
  'mobile');

ALTER TABLE health_facility.point
DROP COLUMN IF EXISTS strategy;

ALTER TABLE health_facility.point
ADD COLUMN strategy health_facility_strategy NOT NULL DEFAULT 'fixed_post';

ALTER TABLE health_facility.point
DROP COLUMN IF EXISTS color;

ALTER TABLE health_facility.point
ADD COLUMN color text;

ALTER TABLE health_facility.point
DROP COLUMN IF EXISTS parent;

ALTER TABLE health_facility.point
ADD COLUMN parent uuid;


DROP MATERIALIZED VIEW IF EXISTS health_facility.point_latest;
CREATE MATERIALIZED VIEW health_facility.point_latest AS
SELECT global_id, boundary_polygon, geom, name,
       synonyms, equipment, ri_service_status,
       type, maturity_level, catchment_status,
       inaccessible,
       properties,
       version_id,
       strategy, color, parent
FROM
(
    SELECT DISTINCT ON (global_id) global_id,
        boundary_polygon, geom, name,
        synonyms, equipment, ri_service_status,
        type, maturity_level, catchment_status,
        inaccessible,
        properties,
        version_id,
        is_deleted,
        strategy, color, parent
    FROM health_facility.point
    ORDER BY global_id, version_id DESC
) sq WHERE is_deleted IS False ;


CREATE INDEX point_latest_geom ON
    health_facility.point_latest USING GIST (geom);

CREATE INDEX point_latest_boundary_polygon ON
    health_facility.point_latest (boundary_polygon);

-- ALTER MATERIALIZED VIEW health_facility.point_latest  OWNER TO "gmt_dev";
-- ALTER MATERIALIZED VIEW health_facility.point_latest  OWNER TO "gmt_test";