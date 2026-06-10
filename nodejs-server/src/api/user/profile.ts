// import auth from "@utils/auth/authInit.util";
import auth from "../../utils/auth/authInit.util";
let jwt = require('jsonwebtoken');

export interface UserInfo {
  sub: string,
  email_verified: boolean,
  client_roles: string[],
  preferred_username: string
}

export async function handleGetUserInfo(ctx, next) {
    /**
     * Get user account info from the path /protocol/openid-connect/userinfo
     * The method is copied from keycloak package "userInfo" just Host is changed to external one because
     * Otherwise token validation would fail as token is retrieved through the UI with external keycloak provider
     * Would be useful to implement our interface for this data as not all fields seem to be useful.
     * TODO - handle token failure cases with the right failure messages
     */
    try {
        // Will return object like UserInfo
        // this request is already called for retrieving user roles from keycloak
        //await auth.grantManager.userInfo(ctx.get('Authorization'));
        ctx.body = ctx.user_info;
    } catch (err) {
        if (err.response && err.response.data && err.response.data.error) {
            ctx.throw(401, err.response.data);
        } else {
            ctx.throw(401, "Cannot authorize because of unknown error"); // check all possible failing scenarios
        }
    }
    await next();
}
