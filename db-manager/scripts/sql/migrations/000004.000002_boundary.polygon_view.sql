
DROP MATERIALIZED VIEW IF EXISTS boundary.polygon_latest;
CREATE MATERIALIZED VIEW boundary.polygon_latest AS 
SELECT global_id, boundary_polygon,
       geom, name, code, level, properties,
       version_id
FROM  
(
    SELECT DISTINCT ON (global_id) global_id, boundary_polygon,
        geom, name, code, level, properties,
        version_id,
        is_deleted
    FROM boundary.polygon    
    ORDER BY global_id, version_id DESC 
) sq WHERE is_deleted IS False ;


CREATE INDEX polygon_latest_geom ON
    boundary.polygon_latest USING GIST (geom);

CREATE INDEX polygon_latest_boundary_polygon ON
    boundary.polygon_latest (boundary_polygon);
