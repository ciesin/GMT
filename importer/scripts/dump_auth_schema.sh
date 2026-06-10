rm -rf /data/db_backup_auth
mkdir /data/db_backup_auth
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
    --schema auth \
    --verbose \
    --file "/data/db_backup_auth"

