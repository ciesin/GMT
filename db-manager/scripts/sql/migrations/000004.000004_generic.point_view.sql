
DROP MATERIALIZED VIEW IF EXISTS generic.point_latest;
CREATE MATERIALIZED VIEW generic.point_latest AS 
SELECT global_id,
       boundary_polygon, geom,
       name, type, properties,
       version_id
FROM  
(
    SELECT DISTINCT ON (global_id) global_id,
        boundary_polygon, geom,
        name, type, properties,
        version_id,
        is_deleted
    FROM generic.point    
    ORDER BY global_id, version_id DESC 
) sq WHERE is_deleted IS False ;


CREATE INDEX point_latest_geom ON
    generic.point_latest USING GIST (geom);

CREATE INDEX point_latest_boundary_polygon ON
    generic.point_latest (boundary_polygon);
