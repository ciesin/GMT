import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { saveAs } from 'file-saver';
import { NGXLogger } from 'ngx-logger';
import { firstValueFrom, Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { DefaultQueueResponse } from 'src/app/utils/server-interfaces/CrudAction';
import {
    JobStatusResponse,
    JobStatusState,
} from '../../utils/server-interfaces/JobStatus';

@Injectable({
  providedIn: 'root',
})
export class DataExportService {
  constructor(private http: HttpClient, private logger: NGXLogger) {}

  /*
  gdb is the gdb file export
  excel is the non REW excel export
  */
  async submitDataExportRequest(boundaryIds: string[],
    gdb: boolean, excel: boolean, rew: boolean, boundariesSingle: boolean): Promise<number> {
    const httpData = await firstValueFrom(this.http
      .post<DefaultQueueResponse>(
        `${AppConfigService.conf.api_url}/export/data`,
        { boundaryIds, gdb, excel, rew, boundariesSingle }
      ));
    this.logger.info(httpData, 'httpData in submitDataExportRequest');
    return httpData!.jobId;
  }

  getExportJobStatus(jobId: number): Observable<JobStatusResponse> {
    // if something failed while submitting the export job - not sure if this scenario is valid
    if (jobId < 0) {
      return of({
        state: JobStatusState.completed,
        progress: 100,
      });
    }

    return this.http.get<JobStatusResponse>(
      `${AppConfigService.conf.api_url}/export/exportJob/${jobId}`
    );
  }

  async downloadDataExport(jobId: number): Promise<void> {
    // (ArrayBuffer | null | string)[]
    this.logger.info(
      `${AppConfigService.conf.api_url}/export/download/${jobId}`
    );
    await firstValueFrom(
      this.http
        .get(`${AppConfigService.conf.api_url}/export/download/${jobId}`, {
          observe: 'response',
          responseType: 'arraybuffer',
        })
        .pipe(
          map((response: HttpResponse<ArrayBuffer>) => {
            let filename = 'gmt_data_export.gdb.zip';
            if (response.headers.get('filename')) {
              filename = response.headers.get('filename') as string;
            }
            if (response && response.body) {
              let blob = new Blob([response.body], { type: 'application/zip' });
              saveAs(blob, filename);
            }
          })
        )
    );
  }

  //

  async refreshStateExports(): Promise<void> {
    const ok = await firstValueFrom(
      this.http.get(
        `${AppConfigService.conf.api_url}/export/refreshStateExports`,
        {}
      )
    );
    this.logger.info('Refresh state exports called', ok);
  }
}
