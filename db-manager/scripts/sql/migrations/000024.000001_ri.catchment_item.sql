
--ri.catchment_items and ri.polygons are both partitioned and generated, so we remove the 
--non partitioned tables

--note the main.py script in partitions is what creates the partitions, not the migrations
DROP MATERIALIZED VIEW IF EXISTS ri.catchment_item_latest CASCADE;

DROP TABLE IF EXISTS ri.catchment_item CASCADE;
DROP TABLE IF EXISTS ri.polygon CASCADE;

DROP SCHEMA IF EXISTS ri;

DROP TYPE IF EXISTS ci_type CASCADE;

CREATE TYPE ci_type AS ENUM (
    'generated', 'include', 'exclude');

--Make sure migration ids are correct
SELECT setval('migrations_id_seq', max(id), true)
from public.migrations;    
