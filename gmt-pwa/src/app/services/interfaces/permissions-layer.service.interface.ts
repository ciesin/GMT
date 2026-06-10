import { Observable} from "rxjs";
import {PermissionsResponse} from "../../utils/server-interfaces/PermissionsResponse";

export interface PermissionsLayerServiceInterface {
  /**
   * This method should be called once otherwise it should be improved to check
   * if local _permissions parameter is set
   */
  getPermissions(): Promise<PermissionsResponse>;

  getPermissionsObservable(): Observable<PermissionsResponse>;

  deletePermissions(): Promise<void>;
}
