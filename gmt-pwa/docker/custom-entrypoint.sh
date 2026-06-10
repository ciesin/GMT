#!/usr/bin/env sh

set -e

SCRIPT_NAME=$(basename "$0")
echo "Entering ${SCRIPT_NAME}"

CONFIG_TEMPLATE_FILE="${CONFIG_TEMPLATE_FILE_OVERRIDE:-/usr/share/nginx/html/assets/config.json.template}"
CONFIG_FILE_DEST="${CONFIG_FILE_DEST_OVERRIDE:-/usr/share/nginx/html/assets/config.json}"

echo "CONFIG_TEMPLATE_FILE: ${CONFIG_TEMPLATE_FILE}"
echo "CONFIG_FILE_DEST: ${CONFIG_FILE_DEST}"

cmd=$@

if [[ "true" == "${ANGULAR_DO_SUBSTITUTE_CONFIG}" ]];
then
  if [[ -f "${CONFIG_TEMPLATE_FILE}" ]];
  then
    echo "Angular App config file template found at ${CONFIG_TEMPLATE_FILE}"
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
    echo "Angular App config file template not found at ${CONFIG_TEMPLATE_FILE}. Continuing with existing config file which should be at ${CONFIG_FILE_DEST}"
  fi
fi

echo "Done with the entrypoint. Executing command: ${cmd}"



MANIFEST_TEMPLATE_FILE="${MANIFEST_TEMPLATE_FILE_OVERRIDE:-/usr/share/nginx/html/assets/manifest.webmanifest.template}"
MANIFEST_FILE_DEST="${MANIFEST_FILE_DEST_OVERRIDE:-/usr/share/nginx/html/manifest.webmanifest}"
echo "MANIFEST_TEMPLATE_FILE: ${MANIFEST_TEMPLATE_FILE}"
echo "MANIFEST_FILE_DEST: ${MANIFEST_FILE_DEST}"

#cmd2=$@

if [[ "true" == "${ANGULAR_DO_SUBSTITUTE_CONFIG}" ]];
then
  if [[ -f "${MANIFEST_TEMPLATE_FILE}" ]];
  then
    echo "Angular App manifest.webmanifest file template found at ${MANIFEST_TEMPLATE_FILE}"
    if [[ -w ${MANIFEST_FILE_DEST} ]];
    then
      echo "Destination seems writable. Applying substitutions"
      cat "${MANIFEST_TEMPLATE_FILE}" | envsubst > "${MANIFEST_FILE_DEST}"
      if [[ "${?}" = 0 ]]; then
        echo "Done. Wrote ${MANIFEST_FILE_DEST}";
      else
        echo "Substitution failed Continuing with existing config file which should be at ${MANIFEST_FILE_DEST}";
      fi
    else
      echo "Destination is no writable at ${MANIFEST_FILE_DEST}. Continuing with existing config file which should be at ${MANIFEST_FILE_DEST}"
    fi;
  else
    echo "Angular App manifest.webmanifest file template not found at ${MANIFEST_TEMPLATE_FILE}. Continuing with existing config file which should be at ${MANIFEST_FILE_DEST}"
  fi
fi

# in order to keep the manifest the same, copy the icons over for the environment
echo "Copying PWA icons for environment [${ENV_NAME}]"
cp ${ANGULAR_SERVE_PATH}assets/icons/logo/${ENV_NAME}-72.png ${ANGULAR_SERVE_PATH}assets/icons/logo/icon-72.png
cp ${ANGULAR_SERVE_PATH}assets/icons/logo/${ENV_NAME}-96.png ${ANGULAR_SERVE_PATH}assets/icons/logo/icon-96.png
cp ${ANGULAR_SERVE_PATH}assets/icons/logo/${ENV_NAME}-128.png ${ANGULAR_SERVE_PATH}assets/icons/logo/icon-128.png
cp ${ANGULAR_SERVE_PATH}assets/icons/logo/${ENV_NAME}-144.png ${ANGULAR_SERVE_PATH}assets/icons/logo/icon-144.png
cp ${ANGULAR_SERVE_PATH}assets/icons/logo/${ENV_NAME}-152.png ${ANGULAR_SERVE_PATH}assets/icons/logo/icon-152.png
cp ${ANGULAR_SERVE_PATH}assets/icons/logo/${ENV_NAME}-192.png ${ANGULAR_SERVE_PATH}assets/icons/logo/icon-192.png
cp ${ANGULAR_SERVE_PATH}assets/icons/logo/${ENV_NAME}-384.png ${ANGULAR_SERVE_PATH}assets/icons/logo/icon-384.png
cp ${ANGULAR_SERVE_PATH}assets/icons/logo/${ENV_NAME}-512.png ${ANGULAR_SERVE_PATH}assets/icons/logo/icon-512.png


echo "Done with the entrypoint. Executing command: ${cmd}"

exec ${cmd}
