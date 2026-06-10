CREATE TABLE IF NOT EXISTS boundary.polygon_edited AS SELECT * FROM boundary.polygon WHERE level=3; -- TODO hardcoded level
CREATE MATERIALIZED VIEW IF NOT EXISTS boundary.polygon_edited_latest AS
 SELECT sq.global_id,
    sq.boundary_polygon,
    sq.geom,
    sq.name,
    sq.code,
    sq.level,
    sq.num_pop_squares,
    sq.computed_pop,
    sq.hf_guids,
    sq.hf_names,
    sq.bbox,
    sq.properties,
    sq.version_id
   FROM ( SELECT DISTINCT ON (polygon.global_id) polygon.global_id,
            polygon.boundary_polygon,
            polygon.geom,
            polygon.name,
            polygon.code,
            polygon.level,
            polygon.num_pop_squares,
            polygon.computed_pop,
            polygon.hf_guids,
            polygon.hf_names,
            polygon.bbox,
            polygon.properties,
            polygon.version_id,
            polygon.is_deleted
           FROM boundary.polygon_edited polygon
          ORDER BY polygon.global_id, polygon.version_id DESC) sq
  WHERE (sq.is_deleted IS FALSE);
--ALTER SCHEMA boundary OWNER TO gmt_dev;
-- GRANT USAGE ON SCHEMA boundary TO gmt_dev;
-- GRANT ALL ON ALL TABLES IN SCHEMA boundary TO gmt_dev;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA boundary TO gmt_dev;
