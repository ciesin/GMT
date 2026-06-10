
ALTER TABLE boundary.polygon
ADD COLUMN num_pop_squares int NOT NULL DEFAULT 0;

COMMENT ON COLUMN boundary.polygon.num_pop_squares IS 'How many squares in this boundary have a population value greater than 0 excluding NO_DATA';

ALTER TABLE boundary.polygon
ADD COLUMN computed_pop double precision NOT NULL DEFAULT 0.0;

COMMENT ON COLUMN boundary.polygon.num_pop_squares IS 'Sum of the population.  Raster used is pop_4326.tif';

ALTER TABLE boundary.polygon
ADD COLUMN hf_guids uuid[] NOT NULL DEFAULT array[]::uuid[];

COMMENT ON COLUMN boundary.polygon.hf_guids IS 'In order to speed up the hierarchy fetching, the hf guids are stored here';

ALTER TABLE boundary.polygon
ADD COLUMN hf_names text[] NOT NULL DEFAULT array[]::text[];

COMMENT ON COLUMN boundary.polygon.hf_names IS 'In order to speed up the hierarchy fetching, the hf names are stored here.  The names are what is needed in the initial boundary selection screen';

ALTER TABLE boundary.polygon
ADD COLUMN bbox DOUBLE PRECISION[] NOT NULL DEFAULT array[]::double precision[];



DROP MATERIALIZED VIEW IF EXISTS boundary.polygon_latest;
CREATE MATERIALIZED VIEW boundary.polygon_latest AS
SELECT global_id, boundary_polygon,
       geom, name, code, level,
       num_pop_squares, computed_pop,
       hf_guids, hf_names, bbox,
       properties,
       version_id
FROM
(
    SELECT DISTINCT ON (global_id) global_id, boundary_polygon,
        geom, name, code, level,
        num_pop_squares, computed_pop,
        hf_guids, hf_names, bbox,
        properties,
        version_id,
        is_deleted
    FROM boundary.polygon
    ORDER BY global_id, version_id DESC
) sq WHERE is_deleted IS False ;


CREATE INDEX polygon_latest_geom ON
    boundary.polygon_latest USING GIST (geom);

CREATE INDEX polygon_latest_boundary_polygon ON
    boundary.polygon_latest (boundary_polygon);
