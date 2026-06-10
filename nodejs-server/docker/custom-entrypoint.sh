#!/bin/bash

set -e

SCRIPT_NAME=$(basename "$0")
echo "Entering ${SCRIPT_NAME}"

CONFIG_TEMPLATE_FILE="/usr/src/app/src/views/queues-login/keycloak.json.template"
CONFIG_FILE_DEST="/usr/src/app/src/views/queues-login/keycloak.json"

echo "CONFIG_TEMPLATE_FILE: ${CONFIG_TEMPLATE_FILE}"
echo "CONFIG_FILE_DEST: ${CONFIG_FILE_DEST}"

cmd=$@

if [[ -f "${CONFIG_TEMPLATE_FILE}" ]];
then
  echo "NodeJS App config file template found at ${CONFIG_TEMPLATE_FILE}"
  touch ${CONFIG_FILE_DEST}
  if [[ -w ${CONFIG_FILE_DEST} ]];
  then
    echo "Destination seems writable. Applying substitutions"
    cat "${CONFIG_TEMPLATE_FILE}" | envsubst > "${CONFIG_FILE_DEST}"
    if [[ "${?}" = 0 ]]; then
      echo "Done. Wrote ${CONFIG_FILE_DEST}";
    else
      echo "Substitution failed Continuing with existing config file which should be at ${CONFIG_FILE_DEST}";
    fi
  else
    echo "Destination is no writable at ${CONFIG_FILE_DEST}. Continuing with existing config file which should be at ${CONFIG_FILE_DEST}"
  fi;
else
  echo "NodeJS App config file template not found at ${CONFIG_TEMPLATE_FILE}. Continuing with existing config file which should be at ${CONFIG_FILE_DEST}"
fi

echo "Done with the entrypoint. Executing command: ${cmd}"

exec ${cmd}
