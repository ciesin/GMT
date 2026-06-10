import Router from "koa-router";
import { DefaultState, Context } from 'koa';
import {
    userHasAdminRole, userHasMicroplanStatusManagerRole,
    userHasParticipationManagerRole,
    userIsAuthenticated,
    validateMainGeoPermissions
} from "../utils/auth/permissions.util";
import { handleRegisterBoundaryParticipation, handleResetMicroPlanning, handleUnregisterAllParticipatingBoundaries } from "../api/db-write/microplan_edit";

const router = new Router<DefaultState, Context>({prefix: '/editMicroplan'});

router.post("/resetMicroplan", userIsAuthenticated, userHasMicroplanStatusManagerRole, validateMainGeoPermissions, handleResetMicroPlanning);
router.post("/updateParticipatingBoundaries", userIsAuthenticated, userHasParticipationManagerRole, validateMainGeoPermissions, handleRegisterBoundaryParticipation);
router.post("/unregisterAllParticipatingBoundaries", userIsAuthenticated, userHasAdminRole, handleUnregisterAllParticipatingBoundaries);

export default router;