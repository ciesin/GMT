#!/bin/bash

echo "SECRETS_ROOT=${SECRETS_ROOT}"

for f in $(find "${SECRETS_ROOT}" -type f ! -name '*.sh' | while read filename; do printf '%s\n' "$filename"; done)
do
  secret_name=$(echo -n $(basename "${f}") | tr '[:lower:]' '[:upper:]')
  secret_value=$(cat "${f}")

  echo "Will unset (if present) and export ${secret_name}"
  unset "${secret_name}"
  export "${secret_name}=${secret_value}"
done
