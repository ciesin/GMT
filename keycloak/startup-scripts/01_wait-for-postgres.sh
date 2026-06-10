#!/bin/bash


echo "Waiting for postgres at "${DB_HOST}:${DB_PORT}""

IFS=':', read -ra addr <<< "${DB_HOST}:${DB_PORT}"

TIMEOUT=60
QUIET=0

echoerr() {
  if [ "${QUIET}" -ne 1 ]; then printf "%s\n" "$*" 1>&2; fi
}


for i in `seq ${TIMEOUT}` ; do
  # We ca't use netcat as it is not present in the image
  # This trick is chatty but it works.
  3<>/dev/tcp/${addr[0]}/${addr[1]} > /dev/null 2>&1

  result=$?
  if [ $result -eq 0 ] ; then
      echo "postgres is up"
      exit 0
  fi
  sleep 1
done
echo "Operation timed out"
exit 1
