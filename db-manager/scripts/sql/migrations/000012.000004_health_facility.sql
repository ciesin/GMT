ALTER TABLE health_facility.point
DROP COLUMN IF EXISTS  inacessible cascade;

ALTER TABLE health_facility.point ADD COLUMN inaccessible boolean;


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
