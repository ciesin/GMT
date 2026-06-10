-- updated boundary table is more like reference to the real boundary because boundary_polygon shows the id of real boundary table
UPDATE boundary.polygon_edited SET boundary_polygon = global_id WHERE boundary_polygon IS NOT NULL;
DROP MATERIALIZED VIEW IF EXISTS boundary.polygon_edited_latest;
ALTER TABLE boundary.polygon_edited DROP COLUMN hf_guids;
ALTER TABLE boundary.polygon_edited DROP COLUMN hf_names;
ALTER TABLE boundary.polygon_edited DROP COLUMN level;
ALTER TABLE boundary.polygon_edited DROP COLUMN num_pop_squares;
ALTER TABLE boundary.polygon_edited DROP COLUMN computed_pop;

COMMENT ON COLUMN boundary.polygon_edited.boundary_polygon IS 'boundary_polygon is not admin2 but admin3 from the initial boundary table.';

CREATE MATERIALIZED VIEW IF NOT EXISTS boundary.polygon_edited_latest AS
 SELECT sq.global_id,
    sq.boundary_polygon,
    sq.geom,
    sq.name,
    sq.code,
    sq.bbox,
    sq.properties,
    sq.version_id
   FROM ( SELECT DISTINCT ON (polygon.global_id) polygon.global_id,
            polygon.boundary_polygon,
            polygon.geom,
            polygon.name,
            polygon.code,
            polygon.bbox,
            polygon.properties,
            polygon.version_id,
            polygon.is_deleted
           FROM boundary.polygon_edited polygon
          ORDER BY polygon.global_id, polygon.version_id DESC) sq
  WHERE (sq.is_deleted IS FALSE);