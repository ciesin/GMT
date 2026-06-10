import {APIError, HttpStatusCode, HttpStatusName} from "../../utils/errors/errors";
import {
    getUserById,
    getUsersList,
    createUser,
    createUsers,
    editUserById,
    disableUserById,
    resetUserPassword,
    assignBoundaryPermissions,
    verifyUsersEmails,
    verifyBoundaryIds,
    editMultipleUsersRoles,
    editMultipleUsersGeoPermissions
} from "../../services/user-admin/manage_users";
import {
    validatePassword,
} from "../../middleware/user-admin/manage-users-validation.middleware";
import {GeoPermission, UserInfo, UserInfoForList, UserInfoSchema} from "../../server-interfaces/user/User";

/**
 * List all users
 * @param ctx
 * @param next
 */
export async function handleGetUsersList(ctx, next){
    ctx.body = {success: false};
    try{
        let filteredSearchText = ctx.request.query['searchText'];
        let users = await getUsersList(parseInt(ctx.request.query['first']),
                                      parseInt(ctx.request.query['max']),
                                      filteredSearchText);

        // workaround for Map to json case for geo permissions
        ctx.body = {
            data: users.data.map(user => {
                let geoPermissions = _geoPermissionMapToJson(user);
                return {...user, geo_permissions: geoPermissions}
            }),
            total: users.total
        }
    } catch(err){
        console.log(err,'handleGetUsersList error');
        throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER,true, err?.response?.statusText);
    }
    await next();
}


/**
 * Get user by id
 * @param ctx
 * @param next
 */
export async function handleGetUserById(ctx, next) {
    try {
        let user = await getUserById(ctx.request.params.id);
        // manual hack to convert map to json object
        let geoPermissions = _geoPermissionMapToJson(user);
        ctx.body = {...user, geo_permissions: geoPermissions};
    } catch (err) {
        console.log(err,'handleGetUserById error');
        throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER,true, err?.response?.statusText);
    }
    await next();
}


export async function handleCreateUser(ctx, next) {
    let user = ctx.request.body;
    try{
        await UserInfoSchema.validate(user, { abortEarly: false });
    } catch(err){
        throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, err.errors);
    }
    ctx.body = {success: false};
    try {
        ctx.body = await createUser(user);
    } catch (err) {
        if(err?.response?.data?.errorMessage){
            console.log(err?.response?.data?.errorMessage,'handleCreateUser error');
            throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, err?.response?.data?.errorMessage);
        } else{
            console.log(err,'handleCreateUser error');
            throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER,true, err?.response?.statusText);
        }
    }
    await next();
}

export async function handleCreateUsersFromCsv(ctx, next) {
    let users = ctx.request.body;
    // if validation fails - fail for all users, otherwise, it would fail for each user separately
    let validationIssues: string[] = [];
    for(let user of users){
        await UserInfoSchema.validate(user, { abortEarly: false }).catch(validationErrors => {
            for(let error of validationErrors.errors){
                validationIssues.push(user.email + ": " + error);
            }});
    }
    if(validationIssues.length > 0){
        console.log(validationIssues,'validationIssues');
        throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST, true, validationIssues);
    }
    ctx.body = {success: false};
    let creationFailures = [];
    try {
        creationFailures = await createUsers(ctx, users);
    } catch (err) {
        if(err?.response?.data?.errorMessage){
            console.log(err?.response?.data?.errorMessage,'handleCreateUsersFromCsv error');
            throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, err?.response?.data?.errorMessage);
        } else{
            console.log(err,'handleCreateUsersFromCsv error');
            throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER,true, err?.response?.statusText);
        }
    }
    if(creationFailures.length == 0){
        ctx.body = {success: true};
    } else {
        throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, creationFailures);
    }
    await next();
}

/**
 * Edit user by id
 * @param ctx
 * @param next
 */
export async function handleEditUserById(ctx, next) {
    let userAfter = ctx.request.body;
    try{
        await UserInfoSchema.validate(userAfter, { abortEarly: false });
    } catch(err){
        throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, err.errors);
    }

    ctx.body = {success: false};
    try {
        ctx.body = await editUserById(ctx.request.params.id, userAfter);
    } catch (err) {
        if(err?.response?.data?.errorMessage){
            console.log(err?.response?.data?.errorMessage,'handleEditUserById error');
            throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, err?.response?.data?.errorMessage);
        } else{
            console.log(err,'handleEditUserById error');
            throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER,true, err?.response?.statusText);
        }
    }
    await next();
}


/**
 * Edit multiple user roles
 * @param ctx
 * @param next
 */
export async function handleEditMultipleUsersRoles(ctx, next) {
    let data = ctx.request.body;
    try{
        // validate that roles are valid
        await UserInfoSchema.validateAt('roles', {roles: data.roles}, { abortEarly: false });
    } catch(err){
        throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, err.errors);
    }

    // validate that user ids are strings (dump validation....)
    if(data.userIds.length == 0){
        throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, ["No users were selected"]);
    }
    data.userIds.forEach(userId => {
        if(!userId || userId.length == 0){
            throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, ["User ids are incorrect"]);
        }
    });

    ctx.body = {success: false};
    try {
        ctx.body = await editMultipleUsersRoles(data.userIds, data.roles);
    } catch (err) {
        console.log(err?.response?.statusText,'handleEditMultipleUsersRoles error');
        throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER,true, err?.response?.statusText);
    }
    await next();
}

/**
 * Edit multiple geo permissions
 * @param ctx
 * @param next
 */
export async function handleEditMultipleUsersGeoPermissions(ctx, next) {
    console.log(ctx.request.body,'ctx.request.body');
    let data = ctx.request.body;

    // validate that user ids and boundary global ids are strings (dump validation....)
    data.geoPermissions.forEach(boundaryId => {
        if(!boundaryId || boundaryId.length == 0){
            throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, ["Boundary global ids are incorrect"]);
        }
    });
    if(data.userIds.length == 0){
        throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, ["No users were selected"]);
    }
    data.userIds.forEach(userId => {
        if(!userId || userId.length == 0){
            throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, ["User ids are incorrect"]);
        }
    });

    ctx.body = {success: false};
    try {
        ctx.body = await editMultipleUsersGeoPermissions(data.userIds, data.geoPermissions);
    } catch (err) {
        console.log(err?.response,'handleEditMultipleUsersRoles error');
        throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER,true, err?.response?.statusText);
    }
    await next();
}

/**
 * Soft delete user
 * @param ctx
 * @param next
 */
export async function handleDisableUserById(ctx, next) {
    let userId = ctx.request.params.id;
    ctx.body = {success: false};
    try {
        await disableUserById(userId);
        ctx.body = {success: true};
    } catch (err) {
        console.log(err?.response,'handleDisableUserById error');
        throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER,true, err?.response?.statusText);
    }
    await next();
}

/**
 * Reset user password to temporary
 * @param ctx
 * @param next
 */
export async function handleResetUserPassword(ctx, next) {
    let user = ctx.request.body;
    let userId = ctx.request.params.id;
    if(user.password){
        await validatePassword(ctx, user);
    }
    ctx.body = {success: false};
    try {
        await resetUserPassword(userId, user.password);
        ctx.body = {success: true};
    } catch (err) {
        // we clean input to not fail with known rules, so logging each error would help finding missed rules
        // thanks to keycloak we have several error formats... it would be nice to have separate class that handles responses from keycloak
        if(err?.response?.data?.error_description && err?.response?.data?.error_description.startsWith("Invalid password:")){
            console.log(err?.response?.data?.error_description,'handleResetUserPassword error');
            throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, err?.response?.data?.error_description);
        } else if(err?.response?.data?.errorMessage && err?.response?.data?.errorMessage){
            console.log(err?.response?.data.errorMessage,'handleResetUserPassword error');
            throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, err?.response?.data?.errorMessage);
        } else {
            console.log(err,'handleResetUserPassword error');
            throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER,true, err?.response?.statusText);
        }
    }
    await next();
}


export async function handleAssignBoundaryPermissions(ctx, next){
    /**
     * (Internal api method - not used in the UI)
     * For list of users emails assign boundary id list
     * If assign_neighbouring_boundaries is set to true, neighbouring boundaries
     * will be assigned as well
     */
    let errors: Array<string> = [];
    // simple validation
    if(!ctx.request.body.boundary_global_ids || !ctx.request.body.users_emails){
        throw new APIError(ctx,
            HttpStatusName.BAD_REQUEST,
            HttpStatusCode.BAD_REQUEST, true,
            ["boundary_global_ids and users_emails must be not empty"]);
    }

    try{
        let  boundaryGlobalIds: Array<string> = ctx.request.body.boundary_global_ids.split(',');
        const usersEmails: Array<string> = ctx.request.body.users_emails.split(',');
        const assignNeighbouringBoundaries: boolean = true;

        // verify data
        let usersIds: Array<string> = await verifyUsersEmails(usersEmails);
        boundaryGlobalIds = await verifyBoundaryIds(boundaryGlobalIds);

        // assign permissions
        for(let userId of usersIds) {
            await assignBoundaryPermissions(userId, boundaryGlobalIds, assignNeighbouringBoundaries);
        }
    } catch(err){
        console.log(err,'err in handleAssignBoundaryPermissions');
        errors.push(err);
    }
    if(errors.length > 0){
        throw new APIError(ctx,
            HttpStatusName.BAD_REQUEST,
            HttpStatusCode.BAD_REQUEST, true,
            errors);
    }else{
        ctx.body = {success: true};
    }
    await next();
}

function _geoPermissionMapToJson(user: UserInfo): {[key: string]: GeoPermission}{
    // workaround to convert map to json object
    let geoPermissions: {[key: string]: GeoPermission} = {};
    user.geo_permissions?.forEach((value, key) => {
      geoPermissions[key] = value
    });
    return geoPermissions;
}