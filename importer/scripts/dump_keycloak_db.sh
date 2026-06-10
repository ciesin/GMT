rm -rf /data/db_backup_keycloak
mkdir /data/db_backup_keycloak
PGPASSWORD="${DB_ADMIN_PASSWORD}" pg_dump \
    -U "${DB_ADMIN_USER}" \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -x \
    --dbname="${DB_KEYCLOAK_DATABASE_NAME}" \
    --format=d \
    --disable-triggers \
    --quote-all-identifiers \
    --file "/data/db_backup_keycloak"

