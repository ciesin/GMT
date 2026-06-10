#!/bin/bash

# Keycloak ADMIN
gmt_realm_roles=`for r in view-realm query-realms query-users view-authorization query-clients impersonation manage-clients create-client query-groups manage-identity-providers view-events view-users manage-events manage-authorization manage-realm manage-users view-clients view-identity-providers ; do echo -n "gmt-realm/$r,"; done`
/opt/jboss/keycloak/bin/add-user-keycloak.sh -u ${KEYCLOAK_GMT_REALM_USER} -p ${GMT_KEYCLOAK_ADMIN_USER_PASSWORD} --roles $gmt_realm_roles

# GMT Admin (has all roles for all geographic regions)
gmt_user_administration_roles=`for r in manage-authorization manage-users query-clients query-users view-users view-clients; do echo -n "realm-management/$r,"; done`
/opt/jboss/keycloak/bin/add-user-keycloak.sh -r gmt -u ${GMT_ADMIN_USER} -p ${GMT_KEYCLOAK_GMT_ADMIN_USER_PASSWORD} --roles dashboard/gmt-admin,offline_access,$gmt_user_administration_roles

# Queues admin (have access to the admin queues client and UI)
/opt/jboss/keycloak/bin/add-user-keycloak.sh -r gmt -u ${QUEUE_ADMIN_USER} -p ${QUEUE_ADMIN_USER_PASSWORD} --roles queues/queues-admin

# GMT Editor (has editor role for one geographic region)
/opt/jboss/keycloak/bin/add-user-keycloak.sh -r gmt -u ${GMT_EDITOR_USER} -p ${GMT_USER_PASSWORD} --roles dashboard/gmt-editor,offline_access

# GMT Reader (has reader role for one geographic region but still can see all)
/opt/jboss/keycloak/bin/add-user-keycloak.sh -r gmt -u ${GMT_READER_USER} -p ${GMT_USER_PASSWORD} --roles offline_access

# GMT Users administrator (has access to edit other users)
/opt/jboss/keycloak/bin/add-user-keycloak.sh -r gmt -u ${GMT_USERS_ADMIN} -p ${GMT_USER_PASSWORD} --roles dashboard/gmt-users-administrator,offline_access


#max=8000
#for i in `seq 11 $max`
#do
#    echo "$i"
#    /opt/jboss/keycloak/bin/add-user-keycloak.sh -r gmt -u test_$i -p test_$i --roles api/gmt-admin
#done