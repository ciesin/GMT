import {GeoPermission, KeycloakUser, UserInfo} from "../../server-interfaces/user/User";


export function convertKeycloakToGmtUser(keycloakUser: KeycloakUser,
                                         userRoles: string[],
                                         geoPermissions: Map<string, GeoPermission>): UserInfo{
    return {
      id: keycloakUser.id,
      username: keycloakUser.username,
      email: keycloakUser.email ? keycloakUser.email: "",
      first_name: keycloakUser.firstName ? keycloakUser.firstName: "",
      last_name: keycloakUser.lastName? keycloakUser.lastName: "",
      email_verified: keycloakUser.emailVerified,
      enabled: keycloakUser.enabled,
      created_timestamp: keycloakUser.createdTimestamp,
      geo_permissions: geoPermissions,
      roles: userRoles,
    };
}