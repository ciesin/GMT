#!/usr/bin/env bash

echo "Entering custom-entrypoint.sh"

cmd=$@
set -e

echo "Docker template"

cat /config_files/docker_local_db.yml.template | envsubst > /config_files/docker_local_db.yml

wait-for.sh "${DB_HOST}":"${DB_PORT}" -t 120

echo "Activating python environment"
. /usr/gmt-venv/bin/activate

echo "Executing $cmd"

exec ${cmd}



