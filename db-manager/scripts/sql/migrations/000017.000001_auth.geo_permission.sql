ALTER TABLE auth.geo_permission DROP CONSTRAINT IF EXISTS geo_permission_pkey;

ALTER TABLE auth.geo_permission
ADD COLUMN IF NOT EXISTS global_id uuid PRIMARY KEY DEFAULT uuid_generate_v4();

ALTER TABLE auth.geo_permission
ADD COLUMN IF NOT EXISTS parent_id uuid DEFAULT NULL;

ALTER TABLE auth.geo_permission
ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false;