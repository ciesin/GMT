
DROP MATERIALIZED VIEW IF EXISTS boundary.polygon_simplified_latest;
CREATE MATERIALIZED VIEW boundary.polygon_simplified_latest AS
SELECT
       global_id,
       boundary_polygon,
       geom,
       name,
       level
FROM
    (
        SELECT DISTINCT ON
            (global_id) global_id,
            boundary_polygon,
            geom,
            name,
            level
        FROM
            boundary.polygon_simplified
        ORDER BY
            global_id
    ) sq;


CREATE INDEX polygon_simplified_latest_geom ON
    boundary.polygon_simplified_latest USING GIST (geom);

CREATE INDEX polygon_simplified_latest_boundary_polygon ON
    boundary.polygon_simplified_latest (boundary_polygon);

CREATE INDEX polygon_simplified_latest_global_id ON
    boundary.polygon_simplified_latest (global_id);
