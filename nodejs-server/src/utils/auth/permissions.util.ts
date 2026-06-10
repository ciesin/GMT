import { Context } from "koa";

let jwt = require('jsonwebtoken');

import { pool } from "../../db-read/common";
import DefaultDict from "./../helpers/defaultDict";
import { Tables } from "../../config/tables.config";
import { APIError, HttpStatusCode, HttpStatusDefaultMessage, HttpStatusName } from '../errors/errors';
import { logError } from '../errors/errorsHandler.util';
import { UserInfo } from "../../api/user/profile";
import { formPermissionsTree } from "../../server-interfaces/utils/permissions.util";
import { PermissionsTree } from "../../server-interfaces/PermissionsResponse";
import { CrudAction } from "../../server-interfaces/CrudAction";
import { hasPermission, hasGeoPermission } from '../../server-interfaces/utils/permissions.util';
import { TokenContent } from "../../server-interfaces/Token";
import auth from "./authInit.util";
import GMT_CONFIG from "../../config/gmt.config";
import { AUTH_CONFIG } from "../../config/keycloak.config";
import { VectorLayerForPermissions } from "../../server-interfaces/VectorLayerName";


export type GeoPermissions = {
    geo_permissions: string[];
    hierarchical_geo_permissions: string[];
}
/**
 * Get roles from keycloak server in case the token contains the old ones
 * @param userInfo
 */
export async function getUserRolesFromKeycloak(userInfo: UserInfo): Promise<string[]> {
    if (userInfo && userInfo.client_roles) {
        return userInfo.client_roles;
    } else {
        return [];
    }
}

/**
 * Get user roles and associated permissions from the database
 * (reader access is given by default)
 * Roles will be retrieved from the keycloak token as the roles could be changed
 * @param ctx
 * @param roles
 */
export async function getUserPermissions(ctx: Context, roles: string[]): Promise<PermissionsTree> {
    try {

        let comma_separated_roles: string = "'gmt-reader'";
        if (roles) {
            comma_separated_roles += `,'${roles.join("','")}'`;
        }
        const permQuery = `SELECT permission.*
                                                  FROM ${Tables.auth_permissions} permission
                                                           INNER JOIN ${Tables.auth_role_permission} role_permission ON role_permission.permission_id = permission.id
                                                           INNER JOIN ${Tables.auth_role} role ON role.id = role_permission.role_id
                                                  WHERE role.code IN (${comma_separated_roles})
                                                    AND (role_permission.deletion_date is null OR
                                                         role_permission.deletion_date <= CURRENT_DATE)
                                                  ORDER BY LEVEL ASC`;
        //console.log(`EEE perm query ${permQuery}`);
        const all_permissions = await pool.query(permQuery);
        // has_permission(permissions_tree, 'settlement.polygon.geom', 'update');
        return formPermissionsTree(all_permissions.rows);
    } catch (err) {
        logError(err);
        let errorDescription: string = HttpStatusDefaultMessage.INTERNAL_SERVER;
        if (err.response && err.response.data && err.error_description) {
            errorDescription = err.response.data.error_description;
        }

        throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER, true, errorDescription);
    }
}


function _formConfirmedAndQueryableBoundaryIds(permittedBoundaries,
                                               maxBoundaryLevel: number,
                                               geoPermissionsAll: string[],
                                               queryBoundaries) {
    for (let permittedBoundary of permittedBoundaries.rows) {
        geoPermissionsAll.push(permittedBoundary['global_id']);
        if (permittedBoundary['level'] != maxBoundaryLevel) {
            queryBoundaries[permittedBoundary['level']].push(permittedBoundary['global_id']);
        }
    }
}

/**
 * Get user roles and associated permissions from the database
 * (reader access is given by default)
 * Roles will be retrieved from the keycloak token as the roles could be changed
 * @param ctx
 */
export async function getUserGeoPermissions(ctx: Context): Promise<GeoPermissions> {
    let token_obj: TokenContent = null;
    try {
        const bearer: string = ctx.get('Authorization');
        token_obj = jwt.decode(bearer.replace("Bearer ", ""));
    } catch (err) {
        // If user is not logged in no error should be thrown just geo permissions should be empty
        // console.log(err,'err');
    }
    if (!token_obj || typeof (token_obj['sub']) == "undefined") {
        return {
            geo_permissions: [],
            hierarchical_geo_permissions: [],
        };
    }
    const permittedBoundaries = await pool.query(
        `SELECT geo_permissions.boundary_polygon as global_id, boundaries.level, geo_permissions.parent_id
         FROM ${Tables.auth_geo_permissions} geo_permissions
                  INNER JOIN ${Tables.boundary_latest} boundaries
                             ON boundaries.global_id = geo_permissions.boundary_polygon
         WHERE user_id = '${token_obj.sub}'
           AND geo_permissions.deleted != true`);

    // In case of error in db check existance because Foreign key cannot exist on materialized view
    // commented out because it matches the situation when user does not have geo permissions
    // if(permitted_boundaries.rows.length == 0){
    //     throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER, false,
    //                        `User ${token_obj.sub} has invalid geo permissions`);
    // }

    let geoPermissionsAll: string[] = [];
    let queryBoundaries = new DefaultDict(Array);
    // if it is lowest level - just return as it is
    _formConfirmedAndQueryableBoundaryIds(permittedBoundaries,
        GMT_CONFIG.maxBoundaryLevel,
        geoPermissionsAll,
        queryBoundaries);


    // get all related boundary_polygon (currently retrieving from the database but maybe later better to cache
    // all polygons and query the tree)
    for (const x of Array(GMT_CONFIG.maxBoundaryLevel).keys()) {
        if (queryBoundaries[x].length == 0) {
            continue;
        }
        const permittedBoundaries = await pool.query(
            `SELECT boundaries.global_id, boundaries.level
             FROM ${Tables.boundary_latest} boundaries
             WHERE boundary_polygon IN ('${queryBoundaries[x].join("','")}')`);
        _formConfirmedAndQueryableBoundaryIds(permittedBoundaries,
            GMT_CONFIG.maxBoundaryLevel,
            geoPermissionsAll,
            queryBoundaries);
    }
    let mainPermittedBoundaries = permittedBoundaries.rows.filter(b => b.parent_id == null).map(b => b.global_id);
    return {
        geo_permissions: geoPermissionsAll.concat(queryBoundaries[GMT_CONFIG.maxBoundaryLevel]),
        hierarchical_geo_permissions: mainPermittedBoundaries,
    };
}


/**
 * Check all actions if the user has permissions and geo_permissions for specific action
 * If any fail - all request fail but all errors will be displayed
 * @param ctx
 * @param next
 */
export async function validateCrudActionsPermissions(ctx, next) {
    let crudActionsList: Array<CrudAction> = ctx.request.body;
    if (!crudActionsList || crudActionsList.constructor.name !== "Array" || crudActionsList.length == 0) {
        throw new APIError(ctx,//if (somevar.constructor.name == "Array") {
            HttpStatusName.BAD_REQUEST,
            HttpStatusCode.BAD_REQUEST, true,
            "No crud actions were submitted");
    }
    let crudAction: CrudAction;
    let userHasPermission: boolean;
    let changedField: string;
    let changedLayer: string;
    let errorMessage: string;
    //permission: string, action: PermissionActions
    let errorsList: string[] = []
    for (crudAction of crudActionsList) {
        changedLayer = crudAction.changed_layer.replace("__", ".");
        // validate each field
        if (crudAction.changed_fields.length > 0) {
            for (changedField of crudAction.changed_fields) {
                userHasPermission = hasPermission(ctx.user_permissions, `${changedLayer}.${changedField}`, crudAction.action);
                if (userHasPermission) {
                    continue;
                }
                // avoid duplicated error messages on bigger changes like microplan
                errorMessage = `User has no permission for '${changedLayer}.${changedField}' layer and action '${crudAction.action}'`;
                if (!errorsList.includes(errorMessage)) {
                    errorsList.push(errorMessage);
                }
            }
        } else { // validate blocks instead of separate fields
            userHasPermission = hasPermission(ctx.user_permissions, changedLayer, crudAction.action);
            if (userHasPermission) {
                continue;
            }
            errorMessage = `User has no permission for '${changedLayer}' layer and action '${crudAction.action}'`;
            if (!errorsList.includes(errorMessage)) {
                errorsList.push(errorMessage);
            }
        }
        //Remove server side permission checks because its assumed if a user has changes then the client
        //side changes are enough, and to prevent overly strict refusals
        //https://github.com/novelt/GMT/issues/2686#issue-2302243811
        // validate geo permissions geojson BEFORE
        /*
        userHasPermission = hasGeoPermission(ctx.user_geo_permissions, crudAction.geojson_before.properties["boundary_polygon"]);
        if (!userHasPermission) {
            errorMessage = `User has no geographic permission for boundary '${crudAction.geojson_before.properties["boundary_polygon"]}' for layer '${changedLayer}'`;
            if (!errorsList.includes(errorMessage)) {
                errorsList.push(errorMessage);
            }
        }
        // validate geo permissions geojson AFTER
        userHasPermission = hasGeoPermission(ctx.user_geo_permissions, crudAction.geojson_after.properties["boundary_polygon"]);
        if (!userHasPermission) {
            errorMessage = `User has no geographic permission for boundary '${crudAction.geojson_after.properties["boundary_polygon"]}' for layer '${changedLayer}'`;
            if (!errorsList.includes(errorMessage)) {
                errorsList.push(errorMessage);
            }
        }*/
    }

    if (errorsList.length > 0) {
        console.log("User with not enough permissions tried to submit crud actions", errorsList, crudActionsList);
        throw new APIError(ctx,
            HttpStatusName.FORBIDDEN_CLIENT_ERROR,
            HttpStatusCode.FORBIDDEN_CLIENT_ERROR, true,
            errorsList); // "User does not have permissions for this region."
    }
    await next();
}

export async function validateMainGeoPermissions(ctx, next) {
    let boundaryIds: Array<string> = ctx.request.body;    
    if (!boundaryIds || !Array.isArray(boundaryIds) || boundaryIds.length == 0) {
        throw new APIError(ctx,
            HttpStatusName.BAD_REQUEST,
            HttpStatusCode.BAD_REQUEST, true,
            "No boundary were submitted");
    }
    console.log(`validateMainGeoPermissions ${boundaryIds.length} boundaries`)
    let boundaryId: string;
    let userHasPermission: boolean;
    let errorMessage: string;
    let errorsList: string[] = []

    // avoid duplicated error messages on bigger changes like microplan
    for (boundaryId of boundaryIds) {
        // validate geo permissions geojson AFTER
        userHasPermission = await hasGeoPermissionUsingBoundaryTree(ctx.user_hierarchical_geo_permissions, boundaryId);
        if (!userHasPermission) {
            errorMessage = `User has no geographic permission for boundary '${boundaryId}'`;
            console.log(`validateMainGeoPermissions adding error ${errorMessage}`);
            if (!errorsList.includes(errorMessage)) {                
                errorsList.push(errorMessage);
            }
        }
    }
    if (errorsList.length > 0) {
        console.log("User with not enough permissions tried to apply changes to the boundaries", errorsList, boundaryIds);
        throw new APIError(ctx,
            HttpStatusName.FORBIDDEN_CLIENT_ERROR,
            HttpStatusCode.FORBIDDEN_CLIENT_ERROR, true,
            errorsList); // "User does not have permissions for this region."
    }
    await next();
}
/**
 * Get empty array of permissions for not logged in users
 * This method must go before auth.middleware().map(item => {app.use(item)})
 * to call userInfo on keycloak only once
 */
export async function setUserInfoAndPermissions(ctx: Context) {
    let userClientRoles: string[] = [];
    let userInfo: UserInfo;
    ctx.user_authenticated = false;
    ctx.user_permissions = {};
    ctx.user_geo_permissions = [];
    ctx.user_hierarchical_geo_permissions = [];
    if (ctx.get('Authorization').length > 0) {
        try {
            userInfo = await auth.grantManager.userInfo(ctx.get('Authorization'));
            userClientRoles = await getUserRolesFromKeycloak(userInfo);
            ctx.user_authenticated = true;
        } catch (err) {
            // roles are not retrieved likely because user is not logged in or has old or invalid token so no error
            // logging should be done
            if (err?.response?.data?.error_description) { // err.response && err.response.data &&
                console.log(err.response.data.error_description, ' (error_description) err while retrieving user info');
            } else if (err.response) {
                console.log(err.response, ' (response) err while retrieving user info');
            } else {
                console.log('error while retrieving user info');
            }
            return;
        }
    }
    ctx.user_info = userInfo;
    ctx.user_client_roles = userClientRoles;
    ctx.user_permissions = await getUserPermissions(ctx, ctx.user_client_roles);
    let geoPermissions = await getUserGeoPermissions(ctx);
    ctx.user_geo_permissions = geoPermissions.geo_permissions;
    ctx.user_hierarchical_geo_permissions = geoPermissions.hierarchical_geo_permissions;
}


export async function userIsAuthenticated(ctx: Context, next) {
    // checks token without asking information from keycloak
    await auth.protect();

    // checks token by retrieving userInfo
    await setUserInfoAndPermissions(ctx);

    if (!ctx.user_authenticated) {
        throw new APIError(ctx,
            HttpStatusName.UNAUTHENTICATED, HttpStatusCode.UNAUTHENTICATED,
            true, HttpStatusDefaultMessage.UNAUTHENTICATED
        );
    }
    await next();
}

export async function userHasEditorRole(ctx: Context, next) {
    if (!ctx.user_client_roles.includes(AUTH_CONFIG.dashboard_editor_role_id)) {
        console.log("User does not have gmt-editor role to submit the changes. User roles:", ctx.user_client_roles);
        throw new APIError(ctx,
            HttpStatusName.FORBIDDEN_CLIENT_ERROR, HttpStatusCode.FORBIDDEN_CLIENT_ERROR,
            true, HttpStatusDefaultMessage.FORBIDDEN_CLIENT_ERROR
        );
    }
    await next();
}

export async function userHasUsersAdministratorRole(ctx: Context, next) {
    if (!ctx.user_client_roles.includes(AUTH_CONFIG.users_admin_role_id)) {
        throw new APIError(ctx,
            HttpStatusName.FORBIDDEN_CLIENT_ERROR, HttpStatusCode.FORBIDDEN_CLIENT_ERROR,
            true, HttpStatusDefaultMessage.FORBIDDEN_CLIENT_ERROR
        );
    }
    await next();
}


export async function userHasApiRole(ctx: Context, next) {
    if (!ctx.user_client_roles.includes(AUTH_CONFIG.api_role_id)) {
        throw new APIError(ctx,
            HttpStatusName.FORBIDDEN_CLIENT_ERROR, HttpStatusCode.FORBIDDEN_CLIENT_ERROR,
            true, HttpStatusDefaultMessage.FORBIDDEN_CLIENT_ERROR
        );
    }
    await next();
}


export async function userHasAdminRole(ctx: Context, next) {
    if (!ctx.user_client_roles.includes(AUTH_CONFIG.dashboard_admin_role_id)) {
        throw new APIError(ctx,
            HttpStatusName.FORBIDDEN_CLIENT_ERROR, HttpStatusCode.FORBIDDEN_CLIENT_ERROR,
            true, HttpStatusDefaultMessage.FORBIDDEN_CLIENT_ERROR
        );
    }
    await next();
}

export async function userHasParticipationManagerRole(ctx: Context, next) {
    if (!ctx.user_client_roles.includes(AUTH_CONFIG.participation_manager_role_id)) {
        throw new APIError(ctx,
            HttpStatusName.FORBIDDEN_CLIENT_ERROR, HttpStatusCode.FORBIDDEN_CLIENT_ERROR,
            true, HttpStatusDefaultMessage.FORBIDDEN_CLIENT_ERROR
        );
    }
    await next();
}

export async function userHasMicroplanStatusManagerRole(ctx: Context, next) {
    if (!ctx.user_client_roles.includes(AUTH_CONFIG.microplan_status_manager_role_id)) {
        throw new APIError(ctx,
            HttpStatusName.FORBIDDEN_CLIENT_ERROR, HttpStatusCode.FORBIDDEN_CLIENT_ERROR,
            true, HttpStatusDefaultMessage.FORBIDDEN_CLIENT_ERROR
        );
    }
    await next();
}

/**
 * For each boundary id in geoPermissions check if it or it's children
 * are equal to boundary_polygon
 * Check using db so this function is not in utils/permissions.util.ts
 * @param geoPermissions
 * @param boundary_polygon
 */
async function hasGeoPermissionUsingBoundaryTree(geoPermissions: string[], boundary_polygon: string): Promise<boolean> {
    try {
        // if the boundary just matches the permission directly
        if (geoPermissions.includes(boundary_polygon)) {
            return true;
        }
        if (geoPermissions.length == 0) {
            return false;
        }
        for (const x of Array(GMT_CONFIG.maxBoundaryLevel).keys()) {
            const query = `SELECT boundaries.global_id
                 FROM ${Tables.boundary_latest} boundaries
                 WHERE boundary_polygon IN ('${geoPermissions.join("','")}')`;
            const permittedBoundaries = await pool.query(query);
            geoPermissions = geoPermissions.concat(permittedBoundaries.rows.map(b => b.global_id));
            if (geoPermissions.includes(boundary_polygon)) {
                return true;
            }
        }
    } catch (err) {
        console.log(err, 'err in hasGeoPermissionUsingBoundaryTree');
        return false;
    }
    return false;
}