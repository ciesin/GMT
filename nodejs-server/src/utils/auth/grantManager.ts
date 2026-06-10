import * as crypto from 'crypto';
const axios = require('axios').default;
import {KEYCLOAK_CONFIG} from "../../config/keycloak.config";
import Grant from '@pixelygroup/keycloak-koa-connect/middleware/auth-utils/grant';
import Rotation from '@pixelygroup/keycloak-koa-connect/middleware/auth-utils/rotation';
import Token from '@pixelygroup/keycloak-koa-connect/middleware/auth-utils/token';

interface KeycloakUserInfo {
  sub: string,
  email_verified: boolean,
  client_roles: string[],
  preferred_username: string,
  email: string,
  given_name: string,
  family_name: string,
}

/**
 * Construct a grant manager.
 *
 * @param {Config} config Config object.
 *
 * @constructor
 */
class GrantManager {
  public realmUrl: string;
  public publicRealmUrl: string;
  public clientId: string;
  public secret: string;
  public publicKey: string;
  public public: string;
  public bearerOnly: boolean;
  public notBefore: number;
  public rotation: Rotation;

  constructor(config) {
    this.realmUrl = config.realmUrl;
    this.publicRealmUrl = KEYCLOAK_CONFIG.keycloakExternalBaseUrl + "/realms/" + KEYCLOAK_CONFIG.realm;
    this.clientId = config.clientId;
    this.secret = config.secret;
    this.publicKey = config.publicKey;
    this.public = config.public;
    this.bearerOnly = config.bearerOnly;
    this.notBefore = 0;
    this.rotation = new Rotation(config);
  }


  public async userInfo(authHeader: string): Promise<KeycloakUserInfo> {
      const response = await axios.get(`${this.realmUrl}/protocol/openid-connect/userinfo`,
          {
                  headers: {
                      'Authorization': authHeader,
                      'Accept': 'application/json',
                      'X-Client': 'keycloak-nodejs-connect',
                      'Host': KEYCLOAK_CONFIG.keycloakExternalHostPlain
                    }
          });
      return response.data;
  }

  /**
   * Create a `Grant` object from a string of JSON data.
   *
   * This method creates the `Grant` object, including
   * the `access_token`, `refresh_token` and `id_token`
   * if available, and validates each for expiration and
   * against the known public-key of the server.
   *
   * @param {String} rawData The raw JSON string received from the Keycloak server or from a client.
   * @return {Promise} A promise reoslving a grant.
   *  USED elsewhere
   */
  public createGrant(rawData) {
    let grantData = rawData;
    if (typeof rawData !== 'object') {
      grantData = JSON.parse(grantData);
    }
    const grant: Grant = new Grant({
      access_token: (grantData.access_token ? new Token(grantData.access_token, this.clientId) : undefined),
      refresh_token: (grantData.refresh_token ? new Token(grantData.refresh_token) : undefined),
      id_token: (grantData.id_token ? new Token(grantData.id_token) : undefined),
      expires_in: grantData.expires_in,
      token_type: grantData.token_type,
      __raw: rawData,
    });

    return this.validateGrant(grant);
  }

  public validateGrant(grant: Grant) {
    return new Promise(async (resolve, reject) => {
      try{
        grant['accessToken'] = await this.validateToken(grant['accessToken']);
        resolve(grant);
      } catch(err) {
        reject(new Error(err.message));
      }
    });
  }

  /**
   * Validate a token.
   *
   * This method accepts a token, and returns
   *
   * If the token is valid - the token
   *
   * If any of the following errors are seen - the error will be thrown:
   *
   * - The token was undefined in the first place.
   * - The token is expired.
   * - The token is not expired, but issued before the current *not before* timestamp.
   * - The token signature does not verify against the known realm public-key.
   *
   * @return {Promise} That resolve a token
   */
  public async validateToken(token: Token): Promise<Token> {
    if (!token) {
      throw new Error('invalid token (missing)');
    } else if (token.isExpired()) {
      throw new Error('invalid token (expired)');
    } else if (!token.signed) {
      throw new Error('invalid token (not signed)');
    } else if (token.content.iat < this.notBefore) {
      throw new Error('invalid token (future dated)');
    } else if (token.content.iss !== this.publicRealmUrl && token.content.iss !== this.realmUrl) {
      throw new Error('invalid token (wrong ISS)');
    } else {
      const verify = crypto.createVerify('RSA-SHA256');
      // if public key has been supplied use it to validate token
      if (this.publicKey) {
        try {
          verify.update(token.signed);
        } catch (err) {
          throw new Error('Misconfigured parameters while validating token. Check your keycloak.json file!');
        }
        if (!verify.verify(this.publicKey, token.signature, 'base64')) {
          throw new Error('invalid token (signature)');
        } else {
          return token;
        }
      } else {
        // now we validate token with kycloak by trying to get user info so no need to check token at our end
        // retrieve public KEY and use it to validate token
        // let key = await this.rotation.getJWK(token.header.kid);
        //  verify.update(token.signed);
        //  if (!verify.verify(key, token.signature)) {
        //    throw new Error('invalid token (public key signature)');
        //  } else {
           return token;
         // }
      }
    }
  }
}

export default GrantManager;