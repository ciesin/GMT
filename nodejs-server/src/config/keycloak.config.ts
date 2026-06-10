// const secrets = require('./helpers/docker_secrets');
const KEYCLOAK_CONFIG = {
    realm: process.env.KEYCLOAK_GMT_REALM_NAME,
    authServerUrl: process.env.KEYCLOAK_INTERNAL_BASE_URL,
    keycloakExternalHostPlain: process.env.KEYCLOAK_HOST,
    keycloakExternalHost: process.env.KEYCLOAK_EXTERNAL_HOST,
    keycloakInternalBaseUrl: process.env.KEYCLOAK_INTERNAL_BASE_URL,
    keycloakExternalBaseUrl: process.env.KEYCLOAK_EXTERNAL_BASE_URL,
    clientId: process.env.KEYCLOAK_WEB_CLIENT_NAME,
    bearerOnly: true,
    adminUsername: process.env.KEYCLOAK_NODEJS_ADMIN_USERNAME,
    adminPassword: process.env.GMT_KEYCLOAK_GMT_ADMIN_USER_PASSWORD,
};

let KEYCLOAK_CONFIG_QUEUES = JSON.parse(JSON.stringify(KEYCLOAK_CONFIG));
KEYCLOAK_CONFIG_QUEUES.clientId = 'queues';

const AUTH_CONFIG = {
    queues_admin_role_id: "queues-admin",
    dashboard_admin_role_id: "gmt-admin",
    participation_manager_role_id: "gmt-participation-manager",
    microplan_status_manager_role_id: "gmt-microplan-status-manager",
    users_admin_role_id: "gmt-users-administrator",
    dashboard_editor_role_id: "gmt-editor",
    api_role_id: "gmt-api"
}
export { KEYCLOAK_CONFIG, KEYCLOAK_CONFIG_QUEUES, AUTH_CONFIG };