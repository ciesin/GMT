#!/bin/bash
set -e

# Make sure db migration files are clean
python3.8 /src/importer/create_initial_migration_files.py --clean

