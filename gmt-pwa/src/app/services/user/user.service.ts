import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AppConfigService } from "src/app/utils/app-config.service";
import { PermissionsResponse } from "src/app/utils/server-interfaces/PermissionsResponse";
import { NGXLogger } from 'ngx-logger';

@Injectable({
  providedIn: 'root'
})
export class UserService {

  constructor(private http: HttpClient,
              private logger: NGXLogger) { }

  getPermissions() : Observable<PermissionsResponse> {
    this.logger.info(`${ AppConfigService.conf.api_url }/me`);
    return this.http.get<PermissionsResponse>(`${ AppConfigService.conf.api_url }/me`);
  }
}
