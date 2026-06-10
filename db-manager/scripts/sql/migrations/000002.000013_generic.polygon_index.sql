
CREATE INDEX polygon_geom ON
    generic.polygon USING GIST (geom);

CREATE INDEX polygon_boundary_polygon ON
    generic.polygon (boundary_polygon);
            