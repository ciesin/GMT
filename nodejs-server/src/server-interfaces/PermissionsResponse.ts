export type PermissionActions = "read" | "create" | "update" | "delete";

export const CRUD_PERMISSIONS: Array<PermissionActions> = ["create", "update", "delete"];

export type Permission = {
     id: number
     resource: string
     action: PermissionActions
     level: number
     allow: boolean
     description?: string | null
}

type PermissionsT = {
  permissions?: Permission[];
}
type PermissionsOrKey = {
  [key: string]: (PermissionsOrKey | Permission[]);
}
export type PermissionsTree = PermissionsOrKey & PermissionsT;


export interface PermissionsResponse {
  permissions?: PermissionsTree,
  geo_permissions?: string[]
}
