
DROP TYPE IF EXISTS settlement_name_accessibility_type CASCADE ;
CREATE TYPE settlement_name_accessibility_type AS ENUM (
    'Nomadic', 'Polio high-risk',
  'Security compromised',
  'Hard to reach', 'Riverine',
    'Other');

ALTER TABLE settlement.name
ADD COLUMN inaccessible_reasons settlement_name_accessibility_type[]  NOT NULL DEFAULT array[]::settlement_name_accessibility_type[];

ALTER TABLE settlement.name
DROP COLUMN inaccessible CASCADE ;


DROP MATERIALIZED VIEW IF EXISTS settlement.name_latest;
CREATE MATERIALIZED VIEW settlement.name_latest AS
SELECT global_id, boundary_polygon, geom,
       name,
       settlement_part, is_primary,
       inaccessible_reasons, uninhabited,
       population_perc, synonyms,
       properties,
       version_id
FROM
(
    SELECT DISTINCT ON (global_id) global_id,
        boundary_polygon, geom, name,
        settlement_part, is_primary,
        inaccessible_reasons, uninhabited,
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