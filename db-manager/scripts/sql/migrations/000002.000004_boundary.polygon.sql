
DROP TABLE IF EXISTS boundary.polygon CASCADE ;

CREATE TABLE IF NOT EXISTS boundary.polygon
(
    global_id uuid NOT NULL,
    version_id bigint NOT NULL REFERENCES master.commits (id),
    is_deleted bool NOT NULL DEFAULT False,
    boundary_polygon uuid NOT NULL,
    geom  geometry(MultiPolygon,4326) NOT NULL,
    name text,
    code text,
    level smallint NOT NULL,
    properties jsonb,

    PRIMARY KEY(global_id, version_id)
);
