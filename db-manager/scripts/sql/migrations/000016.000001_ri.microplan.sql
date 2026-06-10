
DROP MATERIALIZED VIEW IF EXISTS ri.microplan_latest;
CREATE MATERIALIZED VIEW ri.microplan_latest AS
SELECT global_id, boundary_polygon, geom,
       name, start_date, end_date,
       properties, version_id
FROM
(
    SELECT DISTINCT ON (global_id) global_id,
        boundary_polygon, geom,
        name, start_date, end_date,
        properties, version_id,
        is_deleted
    FROM ri.microplan
    ORDER BY global_id, version_id DESC
) sq WHERE is_deleted IS False ;

CREATE INDEX microplan_latest_boundary_polygon ON
    ri.microplan_latest (boundary_polygon);

CREATE INDEX microplan_latest_geom ON
    ri.microplan_latest USING GIST (geom);

--ALTER MATERIALIZED VIEW ri.microplan_latest OWNER TO "gmt_dev";
--ALTER MATERIALIZED VIEW ri.microplan_latest OWNER TO "gmt_test";