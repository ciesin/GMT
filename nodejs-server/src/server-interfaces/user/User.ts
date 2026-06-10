import { object, string, number, bool, array } from 'yup';
import { Roles } from "./UserRoles";

export interface User {
  id: string,
  sub: string,
  email_verified: boolean,
  client_roles: string[],
  preferred_username: string,
  email: string,
  username: string,
  enabled: boolean,
  firstName: string,
  lastName: string
}

export interface KeycloakUser {
  id: string,
  createdTimestamp: number,
  username: string,
  enabled: boolean,
  totp: boolean,
  emailVerified: boolean,
  email: string,
  firstName: string,
  lastName: string,
  // not sure what isthe type for these lists that are not used
  // disableableCredentialTypes: [],
  // requiredActions: [],
  // federatedIdentities: [],
  notBefore: number,
  access: {
    manageGroupMembership: boolean,
    view: boolean,
    mapRoles: boolean,
    impersonate: boolean,
    manage: boolean
  }
}

export interface UsersInfo{
  data: User[]
}

export interface GeoPermission{
   global_id: string | null, // uuid
   boundary_polygon: string, // uuid
   parent_id: string | null, // uuid
   related_boundary_polygon: string[]
}

export type UserInfoField = "email" | "username" | "first_name" | "last_name";

export interface UserInfo{
  id: string,
  username: string,
  email: string,
  first_name: string,
  last_name: string,
  email_verified: boolean,
  enabled: boolean,
  created_timestamp: number | undefined,
  // boundary id could be any level
  geo_permissions?: Map<string, GeoPermission>,
  roles: string[],
  password?: string | undefined
}

export interface UserInfoForList extends UserInfo {
  geoPermissionLabels?: string[];
}

//: SchemaOf<UserInfo>
export const UserInfoSchema = object({
  username: string().required(),
  email: string().required().email(),
  first_name: string(),
  last_name: string(),
  email_verified: bool().notRequired(),
  password: string()
      .min(8)
      .matches(RegExp("(.*[a-z].*)"), "Lowercase")
      .matches(RegExp("(.*[A-Z].*)"), "Uppercase")
      .matches(RegExp("(.*\\d.*)"), "Number")
      .notRequired(),
  roles: array().of(string().oneOf(Roles.map(role => role.id))),
  created_timestamp: number().notRequired(),
}).defined();

export interface DefaultApiResponse{
  success: boolean;
}

export interface UserList{
  data: UserInfoForList[],
  total: number
}