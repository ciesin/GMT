rm -rf /data/db_backup
mkdir /data/db_backup
PGPASSWORD="${DB_ADMIN_PASSWORD}" pg_dump \
    -U "${DB_ADMIN_USER}" \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -x \
    --dbname="${DB_NAME}" \
    --format=d \
    --disable-triggers \
    --no-owner \
    --quote-all-identifiers \
    --schema-only \
    --exclude-schema=staging_postgres \
    --exclude-schema=staging_gmt_dev \
    --exclude-schema=zonal_stats_import \
    --exclude-schema=calc_strategy_work \
    --exclude-schema=eric_backup \
    --exclude-schema=work \
    --file "/data/db_backup"

