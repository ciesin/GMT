#!/usr/bin/env bash

set -e

i=0
if [[ "${WAIT_FOR_DATABASE+x}" ]]; then

  echo "Waiting for ${DB_HOST}:${DB_PORT} for ${WAIT_FOR_DATABASE_TIMEOUT}s"

  wait-for.sh "${DB_HOST}":"${DB_PORT}" -t "${WAIT_FOR_DATABASE_TIMEOUT}"

  echo "${DB_HOST}:${DB_PORT} is up. Now waiting we can execute commands"

  # the database startup can take a while, if the db needs to repair, so wait 20 minutes (30 seconds * 40)
  until PGPASSWORD=$(echo -n "${DB_ADMIN_PASSWORD}") psql -h "${DB_HOST}" -U "${DB_ADMIN_USER}" -d ${POSTGRES_DB} -c '\l' > /dev/null; do
    >&2 echo "Database is unavailable - sleeping"
    sleep 30
    ((i=i+1))
    if [ $i -gt 40 ]
    then
      exit 1
      echo "Timeout connecting to the DB"
    fi
  done
  echo "Seems all good!"
else
  echo "Not waiting for ${DB_HOST}:${DB_PORT} (WAIT_FOR_DATABASE = '${WAIT_FOR_DATABASE}') "
fi

exec "${@}"
