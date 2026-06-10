
DROP TABLE IF EXISTS generic.point CASCADE ;

CREATE TABLE IF NOT EXISTS generic.point
(
    global_id uuid NOT NULL,
    version_id bigint NOT NULL REFERENCES master.commits (id),
    is_deleted bool NOT NULL DEFAULT False,
    boundary_polygon uuid NOT NULL,
    geom geometry(Point,4326) NOT NULL,
    name text,
    type text NOT NULL,
    properties jsonb,

    PRIMARY KEY(global_id, version_id)
);
