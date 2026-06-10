import {PermissionsResponse} from "../../utils/server-interfaces/PermissionsResponse";
import {Observable} from "rxjs";
import {VectorLayerService} from "src/app/services/vector_layer/vector-layers.service";
import {PermissionsLayerServiceInterface} from "../interfaces/permissions-layer.service.interface";
import {Injectable} from "@angular/core";

@Injectable({
  providedIn: 'root'
})
export class PermissionsLayerService implements PermissionsLayerServiceInterface{
  constructor(protected vectorLayerService: VectorLayerService) {}
  /**
   * This method should be called once otherwise it should be improved to check
   * if local _permissions parameter is set
   */
  async getPermissions(): Promise<PermissionsResponse> {
    const permissions: PermissionsResponse | undefined = await this.vectorLayerService._db.permissions.get("permissions");
    if (permissions) {
      this.vectorLayerService.updatePermissionsLayer(permissions as PermissionsResponse);
      return permissions;
    } else {
      const emptyPermissions: PermissionsResponse = {permissions: {}, geo_permissions: [], hierarchical_geo_permissions: []};
      this.vectorLayerService.updatePermissionsLayer(emptyPermissions);
      return emptyPermissions;
    }

  }

  getPermissionsObservable(): Observable<PermissionsResponse> {
    return this.vectorLayerService.getPermissionsObservable();
  }

  async deletePermissions(): Promise<void> {
    await this.vectorLayerService._db.permissions.delete("permissions");
    this.vectorLayerService.updatePermissionsLayer({permissions: {}, geo_permissions: [], hierarchical_geo_permissions: []} as PermissionsResponse);
  }

}
