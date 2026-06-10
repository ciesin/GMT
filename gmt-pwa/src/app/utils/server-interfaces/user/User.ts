import { object, string, number, bool, array } from 'yup';
import {Roles} from "./UserRoles";

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

export interface UsersInfo{
  data: User[]
}

export interface GeoPermission{
   global_id: string | null, // uuid
   boundary_polygon: string, // uuid
   parent_id: string | null, // uuid
   related_boundary_polygon: string[]
}

export type UserInfoField = "email" | "username" | "first_name" | "last_name" | "password" | "password_confirmation";
export interface UserInfo{
  id?: string,
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

export const DefaultUserInfoProperties = {
  id: undefined,
  first_name: "",
  last_name: "",
  email_verified: true,
  enabled: true,
  created_timestamp: undefined,
  // boundary id could be any level
  geo_permissions: new Map<string, GeoPermission>(),
  roles: [] as string[],
  // password?: string | undefined
}

export interface UserInfoForList extends UserInfo {
  geoPermissionLabels?: string[];
}

//: SchemaOf<UserInfo>
export const UserInfoSchema = object({
  username: string().min(2).required(),
  email: string().required().email(),
  first_name: string(),
  last_name: string(),
  email_verified: bool().notRequired(),
  password: string()
      .min(8)
      // .matches(/^(|.{8,20})$/, "Password should contain from 8 to 20 characters")
      .matches(RegExp("(.*[a-z].*)"), "Lowercase")
      .matches(RegExp("(.*[A-Z].*)"), "Uppercase")
      .matches(RegExp("(.*\\d.*)"), "Number"),
  roles: array().of(string().oneOf(Roles.map(role => role.id))),
  created_timestamp: number().notRequired(),
}).defined();

export interface DefaultApiResponse{
  success: boolean;
}

export interface UserList {
  data: UserInfoForList[],
  total: number
}
