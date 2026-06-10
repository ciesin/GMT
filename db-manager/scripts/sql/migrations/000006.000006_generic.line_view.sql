
DROP MATERIALIZED VIEW IF EXISTS generic.line_latest;
CREATE MATERIALIZED VIEW generic.line_latest AS 
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
    FROM generic.line    
    ORDER BY global_id, version_id DESC 
) sq WHERE is_deleted IS False ;


CREATE INDEX line_latest_geom ON
    generic.line_latest USING GIST (geom);

CREATE INDEX line_latest_boundary_polygon ON
    generic.line_latest (boundary_polygon);
