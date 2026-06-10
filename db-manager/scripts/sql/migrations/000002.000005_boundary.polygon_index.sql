
CREATE INDEX polygon_geom ON
    boundary.polygon USING GIST (geom);

CREATE INDEX polygon_boundary_polygon ON
    boundary.polygon (boundary_polygon);    
            