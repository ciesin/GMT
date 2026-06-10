
CREATE INDEX polygon_simplified_geom ON
    boundary.polygon_simplified USING GIST (geom);

CREATE INDEX polygon_simplified_boundary_polygon ON
    boundary.polygon_simplified (boundary_polygon);

CREATE INDEX polygon_simplified_level ON
    boundary.polygon_simplified (level);

CREATE INDEX polygon_simplified_global_id ON
    boundary.polygon_simplified (global_id);
