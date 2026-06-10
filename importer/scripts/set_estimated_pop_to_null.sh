# Sets estimated pop to NULL when it is 0 for https://github.com/novelt/GMT/issues/2551
# this is also fixed in the import, so this is only needed to fix an already published database

PGPASSWORD="${DB_PWD}" psql --echo-all -v ON_ERROR_STOP=1 \
-h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" --dbname "${DB_NAME}" <<-EOSQL

DO \$\$
    declare
    myrow record;
BEGIN

  FOR myrow in
    SELECT table_schema, table_name FROM
    information_schema.tables
    WHERE table_schema = 'partitions_settlement_name'
      AND table_type = 'BASE TABLE'

  LOOP

    EXECUTE 'UPDATE ' || myrow.table_schema || '.' || myrow.table_name ||
    ' SET estimated_pop = NULL where estimated_pop = 0';

    EXECUTE 'REFRESH MATERIALIZED VIEW ' || myrow.table_schema || '.' || myrow.table_name ||
    '_latest';

  END LOOP;

END \$\$;

EOSQL

