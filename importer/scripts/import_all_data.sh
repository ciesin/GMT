#!/bin/bash

# exit on error
set -e

# echo
set -x

IMPORT_SH_PATH=/data/import.sh

rm -f "${IMPORT_SH_PATH}"

/usr/gmt-venv/bin/python /src/importer/generate_script_for_geopode.py

chmod 755 "${IMPORT_SH_PATH}"
"${IMPORT_SH_PATH}"
#