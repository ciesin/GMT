-- ALTER TABLE ri.polygon OWNER TO gmt_dev;
ALTER TABLE ri.polygon ADD COLUMN is_deleted bool NOT NULL DEFAULT False;
ALTER TABLE ri.polygon ADD COLUMN version_id bigint NOT NULL DEFAULT -1;
--DROP TABLE partitions.ri_polygon CASCADE;