DROP MATERIALIZED VIEW IF EXISTS settlement.part_latest;

ALTER TABLE settlement.part
DROP COLUMN IF EXISTS estimated_pop ;

ALTER TABLE settlement.part ALTER computed_pop
   SET DATA TYPE double precision USING computed_pop::double precision;



CREATE MATERIALIZED VIEW settlement.part_latest AS
SELECT global_id, boundary_polygon,
       geom, type,
       computed_pop,
       bbox ,
       original_guids ,
       raster_width, raster_height,
       origin_x, origin_y,
       raster, is_fixed_post, is_outreach,
       properties,
       version_id
FROM
(
    SELECT DISTINCT ON (global_id) global_id, boundary_polygon,
        geom, type,
        computed_pop,
        bbox ,
        original_guids ,
       raster_width, raster_height,
       origin_x, origin_y,
       raster, is_fixed_post, is_outreach,
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