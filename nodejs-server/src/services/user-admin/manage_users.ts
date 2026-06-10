import {KEYCLOAK_CONFIG} from "../../config/keycloak.config";
import KcAdminClient from '@keycloak/keycloak-admin-client';
import {getGeoPermissions} from "../../models/user-admin/manage_users";
import {GeoPermission, KeycloakUser, UserInfo, UserList} from "../../server-interfaces/user/User";
import {arrayEquals} from "../../utils/helpers/array_helper";
import { pool} from "../../db-read/common";
import {Tables}  from "../../config/tables.config";
import {Boundary} from "../../server-interfaces/Boundary";
import {
    getOnlySurroundingBoundariesGuids,
    getSurroundingBoundariesGuids
} from "../../db-read/get_surrounding_boundaries";
import {escapeString} from "../../utils/helpers/escapeString.util";
import {convertKeycloakToGmtUser} from "../../models/user-admin/user.serializer";
import GMT_CONFIG from "../../config/gmt.config";

const DEFAULT_PAGINATION_SIZE = 10;

interface KeycloakRole {
    name: string
}

enum RequiredActionAlias {
  VERIFY_EMAIL = 'VERIFY_EMAIL',
  UPDATE_PROFILE = 'UPDATE_PROFILE',
  CONFIGURE_TOTP = 'CONFIGURE_TOTP',
  UPDATE_PASSWORD = 'UPDATE_PASSWORD',
  terms_and_conditions = 'terms_and_conditions',
}

interface KeycloakDashboardClient {
    id: string,
    clientId: string,
    rootUrl: string,
    adminUrl: string,
    surrogateAuthRequired: boolean,
    enabled: boolean,
    alwaysDisplayInConsole: boolean,
    clientAuthenticatorType: string,
    redirectUris: string[],
    webOrigins: string[],
    notBefore: number,
    bearerOnly: boolean,
    consentRequired: boolean,
    standardFlowEnabled: boolean,
    implicitFlowEnabled: boolean,
    directAccessGrantsEnabled: boolean,
    serviceAccountsEnabled: boolean,
    publicClient: boolean,
    frontchannelLogout: boolean,
    protocol: string,
    attributes: {
    'access.token.lifespan': string,
    'saml.force.post.binding': string,
    'saml.multivalued.roles': string,
    'oauth2.device.authorization.grant.enabled': string,
    'backchannel.logout.revoke.offline.tokens': string,
    'saml.server.signature.keyinfo.ext': string,
    'use.refresh.tokens': string,
    'oidc.ciba.grant.enabled': string,
    'backchannel.logout.session.required': string,
    'client_credentials.use_refresh_token': string,
    'client.offline.session.idle.timeout': string,
    'saml.client.signature': string,
    'client.offline.session.max.lifespan': string,
    'client.session.max.lifespan': string,
    'pkce.code.challenge.method': string,
    'client.session.idle.timeout': string,
    'id.token.as.detached.signature': string,
    'saml.assertion.signature': string,
    'saml.encrypt': string,
    'saml.server.signature': string,
    'exclude.session.state.from.auth.response': string,
    'saml.artifact.binding': string,
    saml_force_name_id_format: string,
    'tls.client.certificate.bound.access.tokens': string,
    'saml.authnstatement': string,
    'display.on.consent.screen': string,
    'saml.onetimeuse.condition': string
    },
    authenticationFlowBindingOverrides: object,
    fullScopeAllowed: boolean,
    nodeReRegistrationTimeout: number,
    protocolMappers: object[],
    defaultClientScopes: string[],
    optionalClientScopes: string[],
    access: { view: true, configure: true, manage: true }
}

/**
 * List all users
 */
export async function getUsersList(first: number | undefined, max: number | undefined, searchText: string | undefined): Promise<UserList> {
    let kcAdminClient = await _getKeycloakClient();
    let searchParameters = {
        briefRepresentation: true,
    };
    // more api options: https://www.keycloak.org/docs-api/12.0/rest-api/
    if(searchText){
        searchParameters["search"] = escapeString(searchText);
    }else if(first || first === 0){
        // we cannot set first and text search, otherwise the search will not work
        searchParameters["first"] = first;
        searchParameters["max"] = DEFAULT_PAGINATION_SIZE;
    }
    if(max){
        searchParameters["max"] = max;
    }

    const numUsers = await kcAdminClient.users.count();
    const users = await kcAdminClient.users.find(searchParameters);
    const client = await _getDashboardClient(kcAdminClient);
    let gmtUsers: UserInfo[] = [];
    for(let user of users){
        const roles = await _getUserRoles(kcAdminClient, user.id, client.id);
        const geoPermissions = await getGeoPermissions(user.id, null);
        // as KeycloakUser because keycloak admin api returns it's type
        gmtUsers.push(convertKeycloakToGmtUser(user as KeycloakUser, roles, geoPermissions));
    }
    return {
        data: gmtUsers,
        total: numUsers
    } as UserList;
}

/**
 * Get user by id
 * @param userId
 */
export async function getUserEmailById(userId: string): Promise<string> {
    let kcAdminClient = await _getKeycloakClient();
    const cleanUserId = _cleanId(userId);
    let keycloakUser = await kcAdminClient.users.findOne({
      id: cleanUserId!,
    }) as KeycloakUser;
    return keycloakUser.email;
}

/**
 * Get user by id
 * @param userId
 */
export async function getUserById(userId: string): Promise<UserInfo> {
    let kcAdminClient = await _getKeycloakClient();
    const cleanUserId = _cleanId(userId);
    let keycloakUser = await kcAdminClient.users.findOne({
      id: cleanUserId!,
    }) as KeycloakUser;
    const client = await _getDashboardClient(kcAdminClient);
    const roles = await _getUserRoles(kcAdminClient, cleanUserId, client.id);
    const geoPermissions = await getGeoPermissions(cleanUserId, null);

    return convertKeycloakToGmtUser(keycloakUser, roles, geoPermissions);
}

export async function createUser(user: UserInfo): Promise<boolean> {
    let kcAdminClient = await _getKeycloakClient();
    return await _createUser(kcAdminClient, user);
}


export async function createUsers(ctx, users: UserInfo[]): Promise<string[]> {
    let kcAdminClient = await _getKeycloakClient();
    let creationFailures: string[] = [];
    for(let user of users){
        try {
            await _createUser(kcAdminClient, user);
        } catch (err) {
            if(err?.response?.data?.errorMessage){
                creationFailures.push(user.email + ":" + err?.response?.data?.errorMessage);
            } else {
                throw err;
            }
        }
    }
    return creationFailures;
}

/**
 * Edit user by id
 * @param userId: string
 * @param userAfter: UserInfo
 */
export async function editUserById(userId: string, userAfter: UserInfo): Promise<boolean> {
    let kcAdminClient = await _getKeycloakClient();
    const cleanUserId = _cleanId(userId);
    const userBefore = await kcAdminClient.users.findOne({
      id: cleanUserId!,
    });
    await kcAdminClient.users.update(
      {id: userBefore.id!},
      {
        email: userAfter.email,
        firstName: userAfter.first_name,
        lastName: userAfter.last_name,
        // emailVerified: userAfter.email_verified,
        enabled: userAfter.enabled,
      },
    );
    const client = await _getDashboardClient(kcAdminClient);
    await _assignClientRoles(kcAdminClient, userAfter.roles, cleanUserId, client.id);
    await _assignGeoPermissions(cleanUserId, userAfter.geo_permissions);

    return true;
}


/**
 * Edit only users roles
 * @param userIds: string
 * @param userRoles: string[] - list of role ids that should be assigned to the user
 */
export async function editMultipleUsersRoles(userIds: string[], userRoles: string[]): Promise<boolean> {
    let kcAdminClient = await _getKeycloakClient();
    const client = await _getDashboardClient(kcAdminClient);
    userIds.forEach(async (userId:string) => await _assignClientRoles(kcAdminClient, userRoles, _cleanId(userId), client.id));
    // TODO Could response fail?
    return true;
}

/**
 * Edit only users geo permissions
 * @param userIds: string
 * @param userGeoPermissions: string[] - list of boundary ids that should be assigned to the user
 */
export async function editMultipleUsersGeoPermissions(userIds: string[], userGeoPermissions: string[]): Promise<boolean> {
    for(const userId of userIds){
        let geoPermissionsBefore = await getGeoPermissions(userId, null);
        await _updateGeoPermissions(Array.from(geoPermissionsBefore.keys()), userGeoPermissions, userId)
    }
    // TODO Could response fail?
    return true;
}


/**
 * Assign user geo permissions if they do not exist
 * (assigment date would not be updated in this case)
 * @param userId
 * @param boundaryGlobalIds
 * @param assignNeighbouringBoundaries
 */
export async function assignBoundaryPermissions(userId: string,
                                                boundaryGlobalIds: Array<string>,
                                                assignNeighbouringBoundaries: boolean): Promise<void>{

    for(let boundaryGlobalId of boundaryGlobalIds){
        boundaryGlobalId = boundaryGlobalId.replace(/'/g,'');
        const permissionGlobalId = await _insertGeoPermissionIfNotExists(userId, boundaryGlobalId, null);
        if(! assignNeighbouringBoundaries || permissionGlobalId == ""){
            continue;
        }
        // getSurroundingBoundariesGuids returns various levels and we want to assign geo permissions
        // only to the lowest level
        const surroundingBoundaries: Array<Boundary> = await getOnlySurroundingBoundariesGuids(boundaryGlobalId);
        console.log(surroundingBoundaries,'surroundingBoundaries in assignBoundaryPermissions');
        for(let surroundingBoundary of surroundingBoundaries){
            // skip admin 2 admin 1 admin 0 as getSurroundingBoundariesGuids returns them as well
            if(surroundingBoundary.level != GMT_CONFIG.maxBoundaryLevel){
                continue;
            }
            await _insertGeoPermissionIfNotExists(userId, surroundingBoundary.global_id, permissionGlobalId);
        }
    }
}


export async function disableUserById(userId: string): Promise<void> {
    let kcAdminClient = await _getKeycloakClient();
    await kcAdminClient.users.update(
      {id: userId!},
      {enabled: false},
    );
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<void> {
    let kcAdminClient = await _getKeycloakClient();
    const cleanUserId = _cleanId(userId);

    if(newPassword){
        await kcAdminClient.users.resetPassword({
            id: cleanUserId!,
            credential: {
                temporary: true,
                type: 'password',
                value: newPassword,
            }
        });
    } else{
         //send user an email asking to update password - not updated to novel-t style email
         await kcAdminClient.users.executeActionsEmail({
          id: cleanUserId!,
          lifespan: 2678400,
          redirectUri: GMT_CONFIG.pwaUrl,
          clientId: KEYCLOAK_CONFIG.clientId,
          actions: [RequiredActionAlias.UPDATE_PASSWORD],
        });
    }
}


export async function verifyUsersEmails(usersEmails: Array<string>): Promise<Array<string>>{
    if(!usersEmails || usersEmails.length == 0){
        throw 'There are no "users_emails" given';
    }
    let usersIds: Array<string> = [];
    // get all users ids
    for(let userEmail of usersEmails) {
        const userId = await getUserIdByEmail(escapeString(userEmail));
        if (userId === null) {
            throw `User id for user email ${escapeString(userEmail)} was not found`;
        }
        usersIds.push(userId as string);
    }
    return usersIds
}


export async function verifyBoundaryIds(boundary_global_ids: Array<string>): Promise<Array<string>>{
    if(!boundary_global_ids || boundary_global_ids.length == 0){
        throw 'There are no "boundary_global_ids" are given';
    }
    boundary_global_ids = escapeStringList(boundary_global_ids);
    const sql: string = `SELECT DISTINCT global_id FROM ${Tables.boundary_latest} 
                          WHERE NOT EXISTS (SELECT * FROM ${Tables.boundary_latest}
                            WHERE global_id::text IN ('${ boundary_global_ids.join("','")}')) LIMIT 1;`;
    const result = await pool.query(sql);
    if(result.rowCount > 0 ){
        console.log(sql,'sql',result.rows);
        throw 'Some boundary ids does not exist.';
    }
    return boundary_global_ids;
}


function escapeStringList(strings_list: Array<string>): Array<string>{
    for(let i = 0; i<strings_list.length; i++){
        strings_list[i] = escapeString(strings_list[i]);
    }
    return strings_list;
}


function _cleanId(id: string): string{
    return id.replace(/[^a-zA-Z0-9- ]/g, "")
}



async function getUserIdByEmail(email: string): Promise<string | null>{
    // user list get a lot of unnecessary data for verification but as this api is used only by us rarely, it is ok
    let keycloakUsers = await getUsersList(0, 1, email)
    if(keycloakUsers.data.length > 0 && keycloakUsers.data[0].id){
        return keycloakUsers.data[0].id;
    } else{
        return null;
    }
}


async function _createUser(kcAdminClient, user: UserInfo): Promise<boolean>{
    let createdUser = await kcAdminClient.users.create(
      {
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        emailVerified: user.email_verified,
        enabled: true,
      },
    );
    if(user.password){
        await kcAdminClient.users.resetPassword({
            id: createdUser.id!,
            credential: {
                temporary: true,
                type: 'password',
                value: user.password,
            }
        });
    } else{
         //send user an email asking to update password - not updated to novel-t style email
         await kcAdminClient.users.executeActionsEmail({
          id: createdUser.id!,
          lifespan: 2678400, // 1 month is given for the user to finish his user account creation
          actions: [RequiredActionAlias.UPDATE_PASSWORD],
          redirectUri: GMT_CONFIG.pwaUrl,
          clientId: KEYCLOAK_CONFIG.clientId,
        });
    }

    const client = await _getDashboardClient(kcAdminClient);
    if(user.roles){
        await _assignClientRoles(kcAdminClient, user.roles, createdUser.id, client.id);
    }
    if(user.geo_permissions){
        let boundaryIds = new Set(Object.getOwnPropertyNames(user.geo_permissions));
        await assignBoundaryPermissions(createdUser.id, Array.from(boundaryIds), true);
    }
    return true;
}


async function _getKeycloakClient(){
    const kcAdminClient = new KcAdminClient({
        baseUrl: KEYCLOAK_CONFIG.keycloakInternalBaseUrl,
        realmName: KEYCLOAK_CONFIG.realm,
    });
    await kcAdminClient.auth({
      username: KEYCLOAK_CONFIG.adminUsername,
      password: KEYCLOAK_CONFIG.adminPassword,
      grantType: 'password',
      clientId: 'admin-cli',
    });
    return kcAdminClient
}


async function _getDashboardClient(kcAdminClient): Promise<KeycloakDashboardClient>{
    const clients = await kcAdminClient.clients.find({clientId: KEYCLOAK_CONFIG.clientId});
    return clients[0];
}

async function _getUserRoles(kcAdminClient, userId: string, clientId: string): Promise<string[]>{
    const roles: KeycloakRole[] = await kcAdminClient.users.listClientRoleMappings({
      id: userId!,
      clientUniqueId: clientId!,
    });
    return roles.map(role => role.name);
}

async function _assignClientRoles(kcAdminClient, rolesAfter: string[], userId: string, clientId: string): Promise<void> {
    const rolesBefore = await _getUserRoles(kcAdminClient, userId, clientId);

    if(!arrayEquals(rolesBefore, rolesAfter)){
        const availableRoles = await kcAdminClient.clients.listRoles({
            id: clientId!,
        });
        let roleNamesToDelete = rolesBefore.filter(role => rolesAfter.indexOf(role) === -1);
        let roleNamesToAdd = rolesAfter.filter(role => rolesBefore.indexOf(role) === -1);

        let rolesToDelete = availableRoles.filter(role => roleNamesToDelete.indexOf(role.name) !== -1).map(role => ({ ... role }));
        let rolesToAdd = availableRoles.filter(role => roleNamesToAdd.indexOf(role.name) !== -1).map(role => ({ ... role }));

        // delete roles that were removed
        if(rolesToDelete.length > 0){
            await kcAdminClient.users.delClientRoleMappings({
                id: userId!,
                clientUniqueId: clientId!,
                roles: rolesToDelete,
            });
        }
        // add new roles
        if(rolesToAdd.length > 0){
            await kcAdminClient.users.addClientRoleMappings({
                id: userId!,
                clientUniqueId: clientId!,
                roles: rolesToAdd,
            });
        }
    }
}

async function _assignGeoPermissions(userId: string, geoPermissions: Map<string, GeoPermission>): Promise<void> {
    const geoPermissionsBefore = await getGeoPermissions(userId, null);
    let geoPermissionsAfter = Object.getOwnPropertyNames(geoPermissions);
    await _updateGeoPermissions(Array.from(geoPermissionsBefore.keys()), geoPermissionsAfter, userId);
}

async function _updateGeoPermissions(boundayIdsBefore: string[],
                                     boundayIdsAfter: string[],
                                     userId: string){
    let boundaryIdsAfterSet = new Set(boundayIdsAfter);
    let boundaryIdsBeforeSet = new Set(boundayIdsBefore);
    let boundaryIdsToDelete = [...boundaryIdsBeforeSet].filter(x => !boundaryIdsAfterSet.has(x));

    if(boundaryIdsToDelete.length > 0){
        console.log(boundaryIdsToDelete,'boundaryIdsToDelete');
        await _deleteBoundaryPermissions(userId, boundaryIdsToDelete);
    }

    let boundaryIdsToInsert = [...boundaryIdsAfterSet].filter(x => !boundaryIdsBeforeSet.has(x));

    /*
    console.log("_updateGeoPermissions before " + boundayIdsBefore.join(", ") +
        " after " + boundayIdsAfter.join(", ") + " to del " +
        boundaryIdsToDelete.join(", ") + " to ins " + boundaryIdsToInsert.join(", "));
    */

    if(boundaryIdsToInsert.length > 0) {
        await assignBoundaryPermissions(userId, boundaryIdsToInsert, true);
    }
}


/**
 * already has country permissions
 * ALSO now 2 queries for 1 geo permission is not necessarily optimal but is simple,
 *  getter to insert all at once maybe with uniqueness rule and skip uniqueness failure
 * @param userId
 * @param boundaryGlobalId
 * @param parentId
 */
async function _insertGeoPermissionIfNotExists(userId: string, boundaryGlobalId: string, parentId: string): Promise<string> {
    let existsQueryBase = `SELECT global_id FROM ${Tables.auth_geo_permissions} 
                       WHERE user_id='${userId}' AND deleted=false AND boundary_polygon='${boundaryGlobalId}'`;
    let existsQuery = `${existsQueryBase}`;
    if(parentId){
        existsQuery += ` AND parent_id='${parentId}'`
    }
    const exists = await pool.query(existsQuery);

    if(exists.rowCount > 0){
        return "";
    }
    let insertQuery =`INSERT INTO ${Tables.auth_geo_permissions} 
             (user_id, boundary_polygon)
             VALUES ('${userId}', '${boundaryGlobalId}')`;
    if(parentId){
        insertQuery = `INSERT INTO ${Tables.auth_geo_permissions} 
             (user_id, boundary_polygon, parent_id)
             VALUES ('${userId}', '${boundaryGlobalId}', '${parentId}')`;
    }
    const response = await pool.query(insertQuery);
    if(!parentId){
        const globalId = await pool.query(existsQuery);
        if(globalId.rows.length > 0){
            return globalId.rows[0].global_id;
        }
    }
    return "";
}

/**
 * Delete main and all related (boundaries that are in the extent) geo permissions
 * @param userId
 * @param boundaryGlobalIds
 */
async function _deleteBoundaryPermissions(userId: string, boundaryGlobalIds: string[]){
    const permissionForDeletion = await pool.query(
        `SELECT global_id FROM ${Tables.auth_geo_permissions}
                    WHERE user_id='${userId}' AND deleted=false
                      AND boundary_polygon = ANY($1::uuid[]) AND parent_id IS NULL`,[boundaryGlobalIds]);
    let deletionQuery = `UPDATE ${Tables.auth_geo_permissions} SET deleted=true WHERE user_id='${userId}' 
                         AND (boundary_polygon = ANY($1::uuid[]) `
    let permissionForDeletionIds = [];
    if(permissionForDeletion.rows.length > 0){
        permissionForDeletionIds = permissionForDeletion.rows.map(row => row.global_id);
        deletionQuery += `OR parent_id = ANY($2::uuid[])`;
    }
    deletionQuery += ")";
    const response = await pool.query(deletionQuery, [boundaryGlobalIds, permissionForDeletionIds]);
    return response.rows;
}