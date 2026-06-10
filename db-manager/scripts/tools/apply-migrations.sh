#!/usr/bin/env bash

set -e

one_transaction_per_migration="${ONE_TRANSACTION_PER_MIGRATION:-false}"
tmp_migrations_root="/tmp/migrations_${APP_VERSION:-NO_VERSION}"
force_no_transaction_header='--FORCE_NO_TRANSACTION'

echo "one_transaction_per_migration: ${one_transaction_per_migration}"

echo "Cleaning temp migrations root at ${tmp_migrations_root}"

rm -rf ${tmp_migrations_root}
mkdir -p ${tmp_migrations_root}

#if [[ "${one_transaction_per_migration}" = 'true' ]]; then
#  migrations_temp_file="${tmp_migrations_root}/migrations.sql"
#fi

migrations_summary_file="${tmp_migrations_root}/migrations-summary"

tmp_migration_file_index=0
new_file='true'
at_least_one='false'
previous_force_no_transaction='false'

for f in $(find /migrations -type f -name '*.sql' | while read file; do printf '%s/%s\n' $(basename $file) "$file"; done | sort -t'/' -k1 | cut -d'/' -f2-)
do
  echo "Found migration file: ${f}"

  fname=$(basename "${f}")
  query="SELECT COUNT(*) FROM public.migrations WHERE name = '${fname}';"

  migration_found=$(PGPASSWORD="${DB_PWD}" psql -t -A -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" \
  -U "${DB_USER}" --dbname "${DB_NAME}" \
  -c "${query}")

  if [[ "${migration_found}" = 0 ]]; then
    echo "Migration $fname not applied. will be applied"

    if [[ $(head -n 1 "${f}") = "${force_no_transaction_header}" ]]; then
      force_no_transaction='true'
      echo "Detected presence of ${force_no_transaction_header}. Will not wrap ${fname} statement into a single, explicit, transaction"
    else
      force_no_transaction='false'
      echo "No force transction header [${force_no_transaction_header}] detected. Will  wrap ${fname} statement into a single, explicit, transaction"
    fi

    if [[ "${one_transaction_per_migration}" = 'true' || "${force_no_transaction}" = 'true' ]]; then
      new_file='true'
    fi

    if [[ "${new_file}" = 'true' ]]; then
      previous_migrations_temp_file="${migrations_temp_file}"

      if [[ "${tmp_migration_file_index}" -gt 0 && "${previous_force_no_transaction}" = 'false' ]]; then
        echo "COMMIT;" >> "${previous_migrations_temp_file}"
      fi

      if [[ "${one_transaction_per_migration}" = 'true' ]]; then
        migrations_temp_file="${tmp_migrations_root}/${fname}"
      else
        migrations_temp_file=$(printf "%s/%06d_%s" "${tmp_migrations_root}" "${tmp_migration_file_index}" 'migrations.sql')
        tmp_migration_file_index=$((tmp_migration_file_index+1))
      fi

      if [[ "${force_no_transaction}" != 'true' ]]; then
        echo "BEGIN;" > "${migrations_temp_file}"
        new_file='false'
        previous_force_no_transaction='false'
      else
        previous_force_no_transaction='true'
      fi

      touch "${migrations_summary_file}"
      at_least_one='true'
    fi

    cat "${f}" >> "${migrations_temp_file}"

    echo "" >> "${migrations_temp_file}"
    echo "INSERT INTO public.migrations (name, version) VALUES ('${fname}', '${APP_VERSION}');" >> "${migrations_temp_file}"
    echo "${migrations_temp_file} --> ${fname}" >> "${migrations_summary_file}"
    echo "" >> "${migrations_temp_file}"

    if [[ "${one_transaction_per_migration}" = 'true' && "${force_no_transaction}" != 'true' ]]; then
      echo "COMMIT;" >> "${migrations_temp_file}"
    fi
  else
    echo "Migration ${fname} already applied. Skipping"
  fi
done

echo "Preparation work done"

if [[ "${at_least_one}" = 'true' ]]; then
  if [[ "${one_transaction_per_migration}" != 'true' ]]; then
    echo "COMMIT;" >> "${migrations_temp_file}"
  fi

  echo "Will apply all sql files found in ${tmp_migrations_root}"
  for f in $(find "${tmp_migrations_root}" -type f -name '*.sql' | while read file; do printf '%s/%s\n' $(basename $file) "$file"; done | sort -t'/' -k1 | cut -d'/' -f2-)
  do
    echo ""
    echo "Applying ${f}"
    PGPASSWORD="${DB_PWD}" psql -t -A -v ON_ERROR_STOP=1 -h "${DB_HOST}" -p "${DB_PORT}" \
    -U "${DB_USER}" --dbname "${DB_NAME}" \
    -f "${f}"
  done

  if [[ $? = 0 ]]; then
    echo
    echo "The following migrations had been applied:"
    cat "${migrations_summary_file}"
  else
    echo "Problem applying migrations. Changes had been rolled back"
    echo "The following migrations had NOT been applied"
    cat "${migrations_summary_file}"
  fi
else
  echo "Found no migrations to apply"
fi
