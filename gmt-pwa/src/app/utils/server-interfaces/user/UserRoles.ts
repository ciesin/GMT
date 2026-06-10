export interface Role {
  id: string,
  name: string
}
//IMPORTANT Keep in sync with nodejs-server/src/server-interfaces/user/UserRoles.ts
export const EditorRole: Role = { id: "gmt-editor", name: 'Editor'};
export const UserAdminRole: Role = { id: "gmt-users-administrator", name: 'Users administrator'};
export const AdminRole: Role = { id: "gmt-admin", name: 'Admin'};
export const ParticipationManagerRole: Role = { id: "gmt-participation-manager", name: 'Participation manager'};
export const MicroplanStatusManagerRole: Role = { id: "gmt-microplan-status-manager", name: 'Microplan Status manager'};
export const ApiRole: Role = { id: "gmt-api", name: 'API Access'};

export const Roles: Role[] = [EditorRole,
  UserAdminRole, AdminRole, ParticipationManagerRole, MicroplanStatusManagerRole, ApiRole];
