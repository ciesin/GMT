
-- Add new table for simplified polygons
DROP TABLE IF EXISTS boundary.polygon_simplified CASCADE;
CREATE TABLE IF NOT EXISTS boundary.polygon_simplified
(
    global_id uuid NOT NULL,
    boundary_polygon uuid NOT NULL,
    geom geometry(MultiPolygon,4326) NOT NULL,
    name text,
    level smallint NOT NULL
);