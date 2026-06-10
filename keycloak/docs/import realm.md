# Import realm

## prerequisites:

- Keycloak container has to be running.
- The realm file to import has to be accessible in the container

## import

⚠️ The realm settings will be overridden.

    docker exec -it `docker ps -aqf "name=gmt_keycloak"` keycloak/bin/kcadm.sh update realms/gmt -f /tmp/gmt-realm.json --no-config --server http://localhost:8080/auth --realm master --user admin
