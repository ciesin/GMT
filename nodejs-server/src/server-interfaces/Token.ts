interface RealmAccess {
    roles: string[]
}
interface ResourceAccess {
    api: RealmAccess,
    account: RealmAccess
}

export interface TokenContent {
  exp: number,
  iat: number,
  auth_time: number,
  jti: string,
  iss: string,
  aud: string[],
  sub: string,
  typ: string,
  azp: string,
  nonce: string,
  session_state: string,
  acr: string,
  'allowed-origins': string[],
  realm_access: RealmAccess
  resource_access: ResourceAccess,
  scope: string,
  email_verified: boolean,
  preferred_username: string
}

export interface IdentityTokenContent {
  exp: number,
  iat: number,
  auth_time: number,
  jti: string,
  iss: string,
  aud: string[],
  sub: string,
  typ: string,
  azp: string,
  nonce: string,
  session_state: string,
  acr: string,
  email_verified: boolean,
  preferred_username: string,
  client_roles: Array<string>,
  email: string,
  at_hash: string
}
