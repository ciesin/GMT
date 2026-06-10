import {Context} from "koa";
const passport = require('koa-passport');
import {UserInfo} from "../../api/user/profile";
import auth from "../../utils/auth/authInit.util";
import {getUserRolesFromKeycloak} from "../../utils/auth/permissions.util";
import {AUTH_CONFIG} from "../../config/keycloak.config";

export async function isLoggedIn(ctx: Context, next: Function) {
  let url = '/queues'
  if(!ctx.isAuthenticated || !ctx.isAuthenticated()) {
    if(ctx.session) {
      ctx.session.returnTo = ctx.originalUrl || ctx.req.url;
    }
    if(ctx.url.includes('/queue/')){
      return ctx.redirect(url);
    }
 }
 await next();
};

export async function loginAdminUser(ctx: Context, next: Function){
  return passport.authenticate('local', async (err, userPassport, info, status) => {
    let userClientRoles: string[] = [];
    let user: UserInfo;
    let message = "";
    if(ctx.get('Authorization').length > 0){
        try{
          user = await auth.grantManager.userInfo(ctx.get('Authorization'));
          userClientRoles = await getUserRolesFromKeycloak(user);
          if(! userClientRoles.includes(AUTH_CONFIG.queues_admin_role_id)){
            user = null;
          }
        } catch(err){
          // roles are not retrieved likely because user is not logged in or has old or invalid token so no error
          // logging should be done
          message = ' (error_description) err while retrieving user info';
          if(err?.response?.data?.error_description) {
            console.log(err.response.data.error_description, message);
          }else if(err.response){
            console.log(err.response, message);
          }else{
            console.log(err, message);
          }
        }
    }
    if (user) {
      ctx.login(user);
      ctx.status = 200;
      ctx.body = { status: 'ok' };
    } else {
      ctx.status = 400;
      ctx.body = { status: 'error', message: message };
    }
  })(ctx);
  await next();
}
export async function logoutAdminUser(ctx: Context, next: Function){
  if (ctx.isAuthenticated()) {
    await ctx.logout();
    ctx.session = null;
  }
  ctx.response.body = true;
  await next();
}