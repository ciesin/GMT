
CREATE INDEX point_geom ON
    generic.point USING GIST (geom);

CREATE INDEX point_boundary_polygon ON
    generic.point (boundary_polygon);    
            