ALTER TABLE settlement.part
ADD COLUMN IF NOT EXISTS raster_width int NOT NULL DEFAULT 0;

COMMENT ON COLUMN settlement.part.raster_width IS 'The width of the sub raster, aligned to the pop raster.  The bit varying fields will be raster_width*raster_height # of bits';


ALTER TABLE settlement.part
ADD COLUMN IF NOT EXISTS raster_height int NOT NULL DEFAULT 0;

ALTER TABLE settlement.part
ADD COLUMN IF NOT EXISTS origin_x double precision NOT NULL DEFAULT 0;

COMMENT ON COLUMN settlement.part.origin_x IS 'Origin (top/left) corner of this rasterized settlement part';

ALTER TABLE settlement.part
ADD COLUMN IF NOT EXISTS origin_y double precision NOT NULL DEFAULT 0;

ALTER TABLE settlement.part
ADD COLUMN IF NOT EXISTS raster bit varying NOT NULL DEFAULT '';

ALTER TABLE settlement.part
ADD COLUMN IF NOT EXISTS is_fixed_post bit varying NOT NULL DEFAULT '';

ALTER TABLE settlement.part
ADD COLUMN IF NOT EXISTS is_outreach bit varying NOT NULL DEFAULT '';

COMMENT ON COLUMN settlement.part.original_guids IS 'When a settlement part is merged, this field contains the global_ids that were merged, as well as their original_ids, if any';

DROP MATERIALIZED VIEW IF EXISTS settlement.part_latest;
CREATE MATERIALIZED VIEW settlement.part_latest AS
SELECT global_id, boundary_polygon,
       geom, type,
       computed_pop,
       estimated_pop,
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
        estimated_pop,
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

--ALTER MATERIALIZED VIEW settlement.part_latest OWNER TO "gmt_dev";
