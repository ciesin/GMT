
CREATE INDEX polygon_geom ON
    settlement.polygon USING GIST (geom);

CREATE INDEX polygon_boundary_polygon ON
    settlement.polygon (boundary_polygon);    
            