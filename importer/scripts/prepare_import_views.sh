#!/usr/bin/env bash

# Some materialized views that were dropped to save space are needed in the import

PGPASSWORD="${DB_ADMIN_PASSWORD}" psql --echo-all -v ON_ERROR_STOP=1 \
-h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_ADMIN_USER}" --dbname "${DB_NAME}" <<-EOSQL

CREATE OR REPLACE FUNCTION create_latest_view(v_schema_name TEXT, v_table_name TEXT)
RETURNS VOID
AS \$\$
DECLARE
    column_list text;
BEGIN

    SELECT string_agg(column_name, ', ')
    INTO column_list
    FROM information_schema.columns
    WHERE table_name = v_table_name
    and table_schema = v_schema_name
    and column_name not in ('global_id', 'is_deleted')
    ;

    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS ' || v_schema_name || '.' || v_table_name || '_latest';

    EXECUTE 'CREATE MATERIALIZED VIEW ' || v_schema_name || '.' || v_table_name || '_latest AS
     SELECT global_id, ' || column_list || ' FROM
(
    SELECT DISTINCT ON (global_id) global_id, is_deleted, ' || column_list ||
    ' FROM ' || v_schema_name || '.' || v_table_name ||
    ' ORDER BY global_id, version_id DESC
) sq WHERE is_deleted IS False' ;

    EXECUTE 'CREATE INDEX ' || v_schema_name || '_' || v_table_name || '_latest_geom ON '
    || v_schema_name || '.' || v_table_name ||
    '_latest USING GIST (geom)';

    EXECUTE 'CREATE INDEX ' || v_schema_name || '_' || v_table_name || '_latest_boundary_polygon ON '
    || v_schema_name || '.' || v_table_name ||
    '_latest (boundary_polygon)';


END;
\$\$ LANGUAGE plpgsql;

SELECT create_latest_view('health_facility', 'point');
SELECT create_latest_view('settlement', 'polygon');
SELECT create_latest_view('settlement', 'part');
SELECT create_latest_view('settlement', 'name');

EOSQL

