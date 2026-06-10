CREATE SCHEMA IF NOT EXISTS ri;

DROP TABLE IF EXISTS ri.microplan CASCADE ;

CREATE TABLE IF NOT EXISTS ri.microplan
(
    global_id uuid NOT NULL,
    version_id bigint NOT NULL REFERENCES master.commits (id),
    is_deleted bool NOT NULL DEFAULT False,
    boundary_polygon uuid NOT NULL,
    geom geometry(MultiPolygon,4326) NOT NULL,

    name text NOT NULL,
    start_date date,
    end_date date,

    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY(global_id, version_id)
);

CREATE INDEX microplan_boundary_polygon ON
    ri.microplan (boundary_polygon);

CREATE INDEX microplan_geom ON
    ri.microplan USING GIST (geom);



--Insert default microplans

insert into master.commits (publish_user, comment)
values ('system', 'Import initial microplan versions');

WITH country as (
    select *
    from boundary.polygon_latest p
    where p.level = 0
    limit 1
), vv as (
    select *
    from master.commits
    order by id desc
    limit 1
), mp_names AS (
    SELECT * FROM
    (
    --keep in sync with MicroplanNameType in typescript
        VALUES ('BASELINE'),
               ('BASELINE_WITH_USER_INPUT'),
               ('USER')
    ) AS t (mp_name)
)
INSERT INTO ri.microplan
(
    global_id, version_id, is_deleted,
    boundary_polygon, geom, name,
    start_date, end_date, properties
)
SELECT
    uuid_generate_v4(),
    vv.id,
    false,
    country.global_id,
    GeomFromEWKT('SRID=4326;MULTIPOLYGON(EMPTY)'),
    mp_names.mp_name,
    null, null, '{}'::jsonb
FROM country, vv, mp_names;

--create view after data, so the view is already refreshed


DROP VIEW IF EXISTS ri.microplan_latest;
CREATE MATERIALIZED VIEW ri.microplan_latest AS
SELECT global_id, boundary_polygon, geom,
       name, start_date, end_date,
       properties
FROM
(
    SELECT DISTINCT ON (global_id) global_id,
        boundary_polygon, geom,
        name, start_date, end_date,
        properties,
        is_deleted
    FROM ri.microplan
    ORDER BY global_id, version_id DESC
) sq WHERE is_deleted IS False ;

CREATE INDEX microplan_latest_boundary_polygon ON
    ri.microplan_latest (boundary_polygon);

CREATE INDEX microplan_latest_geom ON
    ri.microplan_latest USING GIST (geom);