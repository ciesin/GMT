import Router from "koa-router";
import {Context, DefaultState} from "koa";
import {handleDeleteToken, handleGenerateApiToken, handleListTokens} from "../api/user/api_token";
import {userHasApiRole, userIsAuthenticated} from "../utils/auth/permissions.util";

const router = new Router<DefaultState, Context>({prefix: '/api-token'});
router.post("/user/:id/generateApiToken", userIsAuthenticated, userHasApiRole, handleGenerateApiToken);
router.get("/tokens", userIsAuthenticated, userHasApiRole, handleListTokens);
router.post("/deleteToken", userIsAuthenticated, userHasApiRole, handleDeleteToken);

export default router;