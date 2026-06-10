import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AppConfigService } from "src/app/utils/app-config.service";
import {
    UserInfo,
    DefaultApiResponse,
    UserList, GeoPermission
} from "src/app/utils/server-interfaces/user/User";
import { NGXLogger } from 'ngx-logger';

@Injectable({
    providedIn: 'root'
})
export class UserManagementService {

    constructor(private http: HttpClient,
        private logger: NGXLogger) { }

    getUsers(first: number | undefined,
        max: number | undefined,
        searchText: string | undefined | null): Observable<UserList> {
        let params = "";
        if (max) {
            params += `max=${max}`;
        }
        if (first || first === 0) {
            if (params.length > 0) { params += `&` }
            params += `first=${first}`;
        }
        if (searchText) {
            if (params.length > 0) { params += `&` }
            params += `searchText=${searchText}`;
        }
        this.logger.info(`${AppConfigService.conf.api_url}/admin/user?${params}`);
        return this.http.get<UserList>(`${AppConfigService.conf.api_url}/admin/user?${params}`);
    }

    createUser(user: UserInfo) {
        let geoPermissions = this.geoPermissionMapToJson(user);
        return this.http.post<UserInfo>(`${AppConfigService.conf.api_url}/admin/user`, {
            ...user,
            geo_permissions: geoPermissions
        });
    }

    createUsers(users: UserInfo[]) {
        // any because of missmatch of UserInfo geo_permissions being Map and then mapped to json object
        let usersWithUpdatedGeoPermissions: any = [];
        users.forEach(user => {
            usersWithUpdatedGeoPermissions.push({ ...user, geo_permissions: this.geoPermissionMapToJson(user) })
        })
        return this.http.post<UserInfo[]>(`${AppConfigService.conf.api_url}/admin/users`, usersWithUpdatedGeoPermissions);
    }

    getUserById(userId: string): Observable<UserInfo> {
        return this.http.get<UserInfo>(`${AppConfigService.conf.api_url}/admin/user/${userId}`);
    }

    /*
    Note that surrounding boundaries are added automatically via
    getOnlySurroundingBoundariesGuids, only for the operating boundary level (normally 3, wards in NGA)
    */
    updateUserById(userId: string, user: UserInfo): Observable<UserInfo> {
        let geoPermissions = this.geoPermissionMapToJson(user);

        this.logger.info(`updateUserById [${userId}]`, geoPermissions);

        return this.http.put<UserInfo>(`${AppConfigService.conf.api_url}/admin/user/${userId}`, {
            ...user,
            geo_permissions: geoPermissions
        });
    }

    updateMultipleUsersRoles(userIds: string[], roles: Set<string>): Observable<UserInfo> {
        return this.http.put<UserInfo>(`${AppConfigService.conf.api_url}/admin/users/roles`, {
            userIds: userIds,
            roles: Array.from(roles)
        });
    }

    updateMultipleUsersGeoPermissions(userIds: string[], geoPermissions: Set<string>): Observable<UserInfo> {
        return this.http.put<UserInfo>(`${AppConfigService.conf.api_url}/admin/users/geoPermissions`, {
            userIds: userIds,
            geoPermissions: Array.from(geoPermissions)
        });
    }

    updateUserByIdWithFormedGeoPermissions(userId: string, user: UserInfo): Observable<UserInfo> {
        return this.http.put<UserInfo>(`${AppConfigService.conf.api_url}/admin/user/${userId}`, user);
    }

    disableUserById(userId: string): Observable<DefaultApiResponse> {
        return this.http.delete<DefaultApiResponse>(`${AppConfigService.conf.api_url}/admin/user/${userId}`);
    }

    resetUserPassword(userId: string, password: string | undefined): Observable<UserInfo> {
        let parameters = {};
        if (password) {
            parameters = { password };
        }
        return this.http.post<UserInfo>(`${AppConfigService.conf.api_url}/admin/user/${userId}/resetPassword`, parameters);
    }

    private geoPermissionMapToJson(user: UserInfo): { [key: string]: GeoPermission } {
        // workaround to convert map to json object
        let geoPermissions: { [key: string]: GeoPermission } = {};
        user.geo_permissions?.forEach((value, key) => {
            geoPermissions[key] = value
        });
        return geoPermissions;
    }
}
