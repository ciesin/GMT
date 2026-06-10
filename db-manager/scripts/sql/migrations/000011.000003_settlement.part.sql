
DROP TABLE IF EXISTS settlement.part CASCADE ;

DROP TYPE IF EXISTS settlement_part_type CASCADE ;
CREATE TYPE settlement_part_type AS ENUM (
    'gmt', 'bua','ssa', 'ha');

CREATE TABLE IF NOT EXISTS settlement.part
(
    global_id uuid NOT NULL,
    version_id bigint NOT NULL REFERENCES master.commits (id),
    is_deleted bool NOT NULL DEFAULT False,
    boundary_polygon uuid NOT NULL,
    geom geometry(MultiPolygon,4326) NOT NULL,
    type settlement_part_type NOT NULL,
    computed_pop real,
    estimated_pop real,
    bbox double precision[],
    original_guids uuid[] NOT NULL DEFAULT array[]::uuid[],
    properties jsonb,

    PRIMARY KEY(global_id, version_id)
);


CREATE INDEX part_geom ON
    settlement.part USING GIST (geom);

CREATE INDEX part_boundary_polygon ON
    settlement.part (boundary_polygon);


DROP MATERIALIZED VIEW IF EXISTS settlement.part_latest;
CREATE MATERIALIZED VIEW settlement.part_latest AS
SELECT global_id, boundary_polygon,
       geom, type,
       computed_pop,
       estimated_pop,
       bbox ,
       original_guids ,
       properties,
       version_id
FROM
(
    SELECT DISTINCT ON (global_id) global_id, boundary_polygon,
        geom, type,
        computed_pop,
        estimated_pop,
        bbox ,
        original_guids ,
        properties,
        version_id,
        is_deleted
    FROM settlement.part
    ORDER BY global_id, version_id DESC
) sq WHERE is_deleted IS False ;


CREATE INDEX part_latest_geom ON
    settlement.part_latest USING GIST (geom);

CREATE INDEX part_latest_boundary_polygon ON
    settlement.part_latest (boundary_polygon);
