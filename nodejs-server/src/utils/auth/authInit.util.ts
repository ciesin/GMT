import GrantManager from "./grantManager";
import {KEYCLOAK_CONFIG} from "../../config/keycloak.config";
import { HttpStatusCode, HttpStatusDefaultMessage } from "../errors/errors";
const KeycloakConnect = require('@pixelygroup/keycloak-koa-connect').default
const auth = new KeycloakConnect({}, KEYCLOAK_CONFIG);

auth.grantManager = new GrantManager(auth.config);
// override default behaviour when 403 status is thrown
auth.accessDenied = (ctx, _) => {
    ctx.throw(HttpStatusCode.UNAUTHENTICATED, HttpStatusDefaultMessage.UNAUTHENTICATED);
}

/**
 * Validate token with keycloak instead of pure offline validation
 * This helps to
 * 1) validate if the token was forced to expire on keycloak
 * 2) validate if new role was added/removed for the user
 * @param ctx
 */
auth.getGrant = async (ctx) => {
    // check user info from keycloak to make sure if the token was not forced to expire and to verify that token is valid
    if(ctx.user_authenticated === false){
        return;
    }
    let rawData;
    for (const item of auth.stores) {
      rawData = item.get(ctx);
      if (rawData) {
        break;
      }
    }
    let grantData = rawData;
    if (typeof (grantData) === 'string') {
        grantData = JSON.parse(rawData);
    }
    if (grantData && !grantData.error) {
        let grant = await auth.grantManager.createGrant(JSON.stringify(grantData))
            .then((grant) => {
            auth.storeGrant(grant, ctx);
            return grant;
        })
            .catch((e) => {
            return Promise.resolve();
        });

        if(ctx.user_client_roles){
            grant.accessToken.content.resource_access = { [KEYCLOAK_CONFIG.clientId]: {roles: ctx.user_client_roles}};
        }
        return grant;
    }
    return Promise.resolve();
}

export default auth;
