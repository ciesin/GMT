import Router from "koa-router";
import {DefaultState, Context} from 'koa';
import {
    handleAssignBoundaryPermissions,
    handleGetUsersList,
    handleGetUserById,
    handleCreateUser,
    handleCreateUsersFromCsv,
    handleEditUserById,
    handleDisableUserById,
    handleResetUserPassword,
    handleEditMultipleUsersRoles,
    handleEditMultipleUsersGeoPermissions
} from "../api/user-admin/manage_users";
import {userHasUsersAdministratorRole, userIsAuthenticated} from "../utils/auth/permissions.util";

const router = new Router<DefaultState, Context>({prefix: '/admin'});
router.use(userIsAuthenticated);
router.use(userHasUsersAdministratorRole);
// it would be nice to compose these middlewares, maybe with https://github.com/koajs/compose
router.get("/user", handleGetUsersList);
router.get("/user/:id", handleGetUserById);
router.post("/user", handleCreateUser);
// create multiple users
router.post("/users", handleCreateUsersFromCsv);
router.put("/user/:id", handleEditUserById);
// update multiple users (only roles and geo permissions are supported)
router.put("/users/roles", handleEditMultipleUsersRoles);
router.post("/assignGeoPermissions", handleAssignBoundaryPermissions);
router.put("/users/geoPermissions", handleEditMultipleUsersGeoPermissions);
router.delete("/user/:id", handleDisableUserById);
router.post("/user/:id/resetPassword", handleResetUserPassword);

export default router;