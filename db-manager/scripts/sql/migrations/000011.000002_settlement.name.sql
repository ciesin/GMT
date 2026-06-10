
DROP TABLE IF EXISTS settlement.name CASCADE ;

CREATE TABLE IF NOT EXISTS settlement.name
(
    global_id uuid NOT NULL,
    version_id bigint NOT NULL REFERENCES master.commits (id),
    is_deleted bool NOT NULL DEFAULT False,
    boundary_polygon uuid NOT NULL,
    --Settlement names can have a null geometry
    geom geometry(Point,4326) ,

    name text NOT NULL,
    --Not adding NULL constraint since on import we don't have the settlement parts yet
    --It could also be the case that the HF does not intersect any settlement_part
    settlement_part uuid,
    is_primary boolean NOT NULL DEFAULT False,

    --Null means unknown
    inaccessible boolean,
    --Null means unknown
    uninhabited boolean,
    population_perc real NOT NULL DEFAULT 100.0,
    synonyms text[] NOT NULL DEFAULT array[]::text[] ,
    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY(global_id, version_id)
);


CREATE INDEX name_geom ON
    settlement.name USING GIST (geom);

CREATE INDEX name_boundary_polygon ON
    settlement.name (boundary_polygon);


DROP MATERIALIZED VIEW IF EXISTS settlement.name_latest;
CREATE MATERIALIZED VIEW settlement.name_latest AS
SELECT global_id, boundary_polygon, geom,
       name,
       settlement_part, is_primary,
       inaccessible, uninhabited,
       population_perc, synonyms,
       properties,
       version_id
FROM
(
    SELECT DISTINCT ON (global_id) global_id,
        boundary_polygon, geom, name,
        settlement_part, is_primary,
        inaccessible, uninhabited,
        population_perc, synonyms,
        properties,
        version_id,
        is_deleted
    FROM settlement.name
    ORDER BY global_id, version_id DESC
) sq WHERE is_deleted IS False ;


CREATE INDEX name_latest_geom ON
    settlement.name_latest USING GIST (geom);

CREATE INDEX name_latest_boundary_polygon ON
    settlement.name_latest (boundary_polygon);


