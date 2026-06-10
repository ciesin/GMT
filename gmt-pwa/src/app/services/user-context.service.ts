import { Injectable } from "@angular/core";
import { BehaviorSubject, firstValueFrom, Observable, Subject, } from "rxjs";
import { hasPermission, hasGeoPermission } from "../utils/server-interfaces/utils/permissions.util";
import {
    PermissionActions,
    PermissionsResponse,
    PermissionsTree
} from "../utils/server-interfaces/PermissionsResponse";
import { VectorLayerForPermissions } from "../utils/server-interfaces/VectorLayerName";
import { AppConfigService } from 'src/app/utils/app-config.service';
import { PermissionsLayerService } from "./vector_layer/permissions-layer.service";
import { BBox2d } from "@turf/helpers/dist/js/lib/geojson";
import { NGXLogger } from "ngx-logger";
import { DefaultQueueResponse } from "../utils/server-interfaces/CrudAction";
import { HttpClient, HttpHeaders, HttpParams } from "@angular/common/http";
import { AuthService } from "@services/user/auth.service";

export interface CurrentBoundaryInfo {
    boundaryId: string,
    level: number,
    surroundingBoundaryIds: Set<string>,
    boundingBox: BBox2d,
    //For speed, we want to know what we should render around the checked out boundary
    surroundingBoundingBox: BBox2d
}


@Injectable({
    providedIn: 'root'
})
export class UserContextService {

    //subject needs an initial value, but we filter this in the observable
    private isEditing = new BehaviorSubject<boolean>(true);

    //If true, catchment is updated automatically
    //If false, user has to manually update the catchment
    public isAutoCatchmentMode$ = new BehaviorSubject<boolean>(false);

    //When auto catchment is off, the hfs and sps to recalc are here
    //We can't just recalc the entire ward because some are quite large
    public spGuidsToCalc$ = new BehaviorSubject<Set<string>>(new Set<string>());

    private currentBoundary = new BehaviorSubject<CurrentBoundaryInfo | null>(null);
    private _permissions: PermissionsResponse = {
        permissions: {},
        geo_permissions: [],
        hierarchical_geo_permissions: [],
    };

    public showDevMenu = AppConfigService.conf.developer_mode;

    public leftPanelIsOpened = new BehaviorSubject<boolean>(true);

    constructor(private permissionsLayerService: PermissionsLayerService,
        private http: HttpClient,
        private authService: AuthService,
        private logger: NGXLogger) {
        this.permissionsLayerService.getPermissionsObservable().subscribe(permissions => {
            this._permissions = permissions;
        });
    }

    /**
     * Checks if user has permission to create/update/delete specific schema in specific boundary
     * @param permission
     * @param action
     * @param boundary_global_id
     */
    public userHasPermissions(permission: VectorLayerForPermissions, action: PermissionActions, boundary_global_id: string): boolean {
        const userHasPermission: boolean = hasPermission(this._permissions["permissions"] as PermissionsTree, permission, action);
        const userHasGeoPermission: boolean = hasGeoPermission(this._permissions["geo_permissions"] as Array<string>, boundary_global_id);

        //this.logger.debug(`EEE userHasPermissions ${permission} for boundary ${boundary_global_id} action ${action}: userHasPermission ${userHasPermission} userHasGeoPermission ${userHasGeoPermission}`);
        //this.logger.debug(`EEE perms`, this._permissions["permissions"]);
        return userHasPermission && userHasGeoPermission;
    }

    public getUserMainPermissions(): string[] {
        return this._permissions["hierarchical_geo_permissions"] as Array<string>;
    }

    public getIsEditingObservable(): Observable<boolean> {
        return this.isEditing.asObservable();
    }

    public getIsEditing(): boolean {
        return this.isEditing.value;
    }

    public setIsEditing(isEditingValue: boolean) {
        //Important to call next even if same value, to trigger listeners
        this.isEditing.next(isEditingValue);
    }

    public getCurrentBoundaryObservable(): Observable<CurrentBoundaryInfo | null> {
        return this.currentBoundary.asObservable();
    }

    public setCurrentBoundary(boundaryId: CurrentBoundaryInfo | null): boolean {

        //If both are null, do nothing
        if (!boundaryId && !this.currentBoundary.value) {
            return false;
        }

        //If both are not null, then check the boundary id (level should be the same)
        if (boundaryId && this.currentBoundary.value && boundaryId.boundaryId == this.currentBoundary.value.boundaryId) {
            return false;
        }

        this.logger.info('Current boundary has changed to ' + boundaryId);

        //the value changed, so send it
        this.currentBoundary.next(boundaryId);

        return true;
    }

    public async logPermissions() {
        const userName = this.authService.getUserName()!;
        const roles = this.authService.getUserRoles();
        const logMessage = "Permission Snapshot";
        const params = new HttpParams().set('message', logMessage).set("userName", userName);

        const hierarchical_geo_permissions = this._permissions["hierarchical_geo_permissions"];

        await firstValueFrom(this.http.post<string>(`${AppConfigService.conf.api_url}/add_log_message`,
            //the condensed form of the permissions (so Nigeria is nigeria and not all children)
            {
                hierarchical_geo_permissions,
                roles
            },
            { params }));
    }

    public async addServerLogMessage(logMessage: string, logPayload: object) {
        const userName = this.authService.getUserName()!;
        let params = new HttpParams().set('message', logMessage).set("userName", userName).set("appVersion", AppConfigService.conf.app_version);

        const gitHash = await AppConfigService.fetchGitHash();
        if (gitHash.length > 0) {
            params = params.set("gitHash", gitHash);
        }

        await firstValueFrom(this.http.post<string>(`${AppConfigService.conf.api_url}/add_log_message`, logPayload,
            { params }));

    }

}
