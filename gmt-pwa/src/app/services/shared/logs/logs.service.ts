import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {AppConfigService} from "src/app/utils/app-config.service";
import {DefaultQueueResponse} from "src/app/utils/server-interfaces/CrudAction";

@Injectable({
  providedIn: 'root'
})
export class LogsService {

  constructor(private http: HttpClient) { }

  async uploadLogs(filename: string, logsBlob: Blob) : Promise<boolean> {
    const httpData = await this.http
      .post<DefaultQueueResponse>(`${AppConfigService.conf.api_url}/logs/upload`,  logsBlob, {
					headers: {
						"Content-Type": logsBlob.type,
            'Accept-Encoding': 'gzip, deflate, br'
					},
					params: {
						clientFilename: filename,
						mimeType: logsBlob.type
					}
				}).toPromise();

    return true;
  }
}
