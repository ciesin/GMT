
DROP MATERIALIZED VIEW IF EXISTS generic.polygon_latest;
CREATE MATERIALIZED VIEW generic.polygon_latest AS 
SELECT global_id, boundary_polygon,
       geom, name,
       type, properties,
       version_id
FROM  
(
    SELECT DISTINCT ON (global_id) global_id, boundary_polygon,
        geom, name,
        type, properties,
        version_id,
        is_deleted
    FROM generic.polygon    
    ORDER BY global_id, version_id DESC 
) sq WHERE is_deleted IS False ;


CREATE INDEX polygon_latest_geom ON
    generic.polygon_latest USING GIST (geom);

CREATE INDEX polygon_latest_boundary_polygon ON
    generic.polygon_latest (boundary_polygon);
