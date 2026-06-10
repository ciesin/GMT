
CREATE INDEX line_geom ON
    generic.line USING GIST (geom);

CREATE INDEX line_boundary_polygon ON
    generic.line (boundary_polygon);    
            