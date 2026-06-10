import * as KeycloakMock from "keycloak-mock";
import {AUTH_CONFIG, KEYCLOAK_CONFIG} from "../../config/keycloak.config";
import {DeleteViewFn, PostViewFn, ViewFn} from "keycloak-mock/lib/types";

export async function getValidToken(){
    const keycloak = await KeycloakMock.createMockInstance({
        authServerURL: KEYCLOAK_CONFIG.authServerUrl,
        realm:  KEYCLOAK_CONFIG.realm,
        clientID: "testclient",
        clientSecret: "test",
    });

    // all requests to `http://keycloak:4248/auth` will now be
    // intercepted and replied to
    // let keycloakMockOptions = new MockOptions()
    try{
        const mock = KeycloakMock.activateMock(keycloak,
        {
            getUserInfoView: (instance, request) => {
               return [200, {
                  sub: "sub",
                  email_verified: true,
                  client_roles: [AUTH_CONFIG.dashboard_editor_role_id],
                  preferred_username: "my_username"
               }];
            },
          });
    } catch(err){
        // do not throw error
        console.log(err, "err");
    }
    // TODO maybe make random user creation
    const user = keycloak.database.createUser({
        email: "test@test.com",
        credentials: [{
            value: "mypassword",
        }]
    });
    return keycloak.createBearerToken(user.profile.id);
}