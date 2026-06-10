CREATE TABLE IF NOT EXISTS ri.polygon (
    global_id uuid NOT NULL,
    health_facility_point uuid NOT NULL,
    boundary_polygon uuid NOT NULL,
    ri_catchmen_items jsonb NULL default NULL,
    geom geometry(Polygon,4326) NOT NULL,
    PRIMARY KEY(global_id)
);