import {Injectable} from '@angular/core';
import {DefaultQueueResponse} from "../utils/server-interfaces/CrudAction";
import {AppConfigService} from "../utils/app-config.service";
import { HttpClient } from "@angular/common/http";
import {firstValueFrom, interval, Observable, of} from "rxjs";
import {JobStatusResponse, JobStatusState} from "../utils/server-interfaces/JobStatus";
import {filter, switchMap, take} from "rxjs/operators";
import {NGXLogger} from 'ngx-logger';
import {IsLoadingService} from './is-loading.service';
import {CancelService} from "@services/cancel.service";


const LOG_PREFIX = "Indicator Service";

export type IndicatorEnumName = "sn_uninhabited_reason" | "hf_level_of_care" | "sn_problematic" | "hf_microplan_status";


@Injectable({
  providedIn: 'root'
})
export class IndicatorService {


   constructor(private http: HttpClient,
               private loadingService: IsLoadingService,
               private cancelService: CancelService,
               private logger: NGXLogger) {

   }

   // async getDbEnumIndexes(): Promise<Map<IndicatorEnumName, number>> {
   //    this.logger.info(`${AppConfigService.conf.api_url}/db_enum_indexes`);
   //    const httpData = await firstValueFrom(this.http.get<Map<IndicatorEnumName, number>>(
   //      `${AppConfigService.conf.api_url}/db_enum_indexes`, {})
   //      );
   //    this.logger.info(httpData, 'httpData');
   //    return httpData;
   // }

   async requestFullIndicatorUpdate(updateCommitVersion: boolean, forceRefresh: boolean): Promise<number> {
      this.logger.info(`${AppConfigService.conf.api_url}/request_all_indicator_update`);
      const httpData = await firstValueFrom(this.http.post<DefaultQueueResponse>(
        `${AppConfigService.conf.api_url}/request_all_indicator_update`, {
            //if true, will create a commit entry once the indicator calculations are completed
            updateCommitVersion,

            //Normally indicators only update if the version id changed, this can force it, useful if after a full catchment update
            forceRefresh
          }
        ));
      this.logger.info(httpData, 'httpData');
      return httpData.jobId;
  }

  /**
   * Calls setLoading false when done
   *
   * Polls the job status until it finishes
   *
   * Returns true if the update job finished ok, false if not
   * @param jobId
   * @returns
   */
  public async indicatorsJobStatusMonitoring(jobId: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // if interface failed and user clicked submit without any changes
      if (jobId == -1) {
        this.loadingService.setLoading(false);
        reject("Job id is -1");
        return;
      }
      // Create an Observable that emits every 20 seconds
      interval(20000).pipe(
        switchMap(() => this.getIndicatorJobStatus(jobId)),

        // Filter only the successful http responses
        filter((data: JobStatusResponse) => {
          this.logger.info(JSON.stringify(data));
          return [JobStatusState.completed, JobStatusState.failed].includes(data?.state);
        }),

        // Emit only the first value emitted by the source
        take(1),

        // Don't include a timeout since indicators can be long for state level
        //timeout(1.2e+6),
      ).subscribe({
        next: async (result: JobStatusResponse) => {

          if ([JobStatusState.completed].includes(result?.state)) {
            this.logger.info("Updates done");
            this.loadingService.setLoading(false);
            resolve(true);
          } else {
            this.logger.error('Indicator refresh failed');

            this.loadingService.setLoading(false);
            reject("Something failed while refreshing indicators");
          }
        },
        error: error => {
          this.logger.info('Error: ' + error);
          this.loadingService.setLoading(false);
          reject(error);
        }
      });
    });
  }


  async requestCatchmentUpdate(boundaryIds: Array<string>): Promise<number> {
      this.logger.info(`${AppConfigService.conf.api_url}/request_catchment_update`, boundaryIds);
      const httpData = await firstValueFrom(this.http.post<DefaultQueueResponse>(
        `${AppConfigService.conf.api_url}/request_catchment_update`, boundaryIds)
        );
      this.logger.info(httpData, 'httpData');
      return httpData.jobId;
  }

  async getCatchmentJobStatus(jobId: number): Promise<JobStatusResponse> {

    //Special case, if the jobId is -1, then it is because there are no Crud actions to submit, and we are done
    if (jobId < 0) {
      return {
        state: JobStatusState.completed,
        progress: 100,
      };
    }
    this.logger.info(`${AppConfigService.conf.api_url}/catchmentUpdateJob/${jobId}`);
    return this.cancelService.doGet<JobStatusResponse>(`${AppConfigService.conf.api_url}/catchmentUpdateJob/${jobId}`);
  }

  getIndicatorJobStatus(jobId: number): Observable<JobStatusResponse> {

    //Special case, if the jobId is -1, then it is because there are no Crud actions to submit, and we are done
    if (jobId < 0) {
      return of({
        state: JobStatusState.completed,
        progress: 100,
      });
    }
    this.logger.info(`${AppConfigService.conf.api_url}/indicatorUpdateJob/${jobId}`);
    return this.http.get<JobStatusResponse>(`${AppConfigService.conf.api_url}/indicatorUpdateJob/${jobId}`, {});
  }

  async refreshCatchments(boundaryIds: Array<string>) : Promise<boolean> {

    this.logger.info(`Refreshing catchment for ${boundaryIds.length} boundaries...`);

    const jobId: number = await this.requestCatchmentUpdate(boundaryIds);

    if (jobId == -1) {
      throw new Error("Error while requesting catchment update, no job id");
    }

    let milliSecondsLeftToWait = 20 * 60 * 1000;
    const waitTimeMs = 2000;

    while (milliSecondsLeftToWait > 0) {

      await new Promise(r => setTimeout(r, waitTimeMs));

      const jobStatus = await this.getCatchmentJobStatus(jobId);

      this.logger.debug(`Catchment job status ms time left ${milliSecondsLeftToWait}`, jobStatus);

      if (!jobStatus || jobStatus.state == JobStatusState.failed) {
        this.logger.error(`Catchment update failed`, jobStatus);
        throw new Error(`Catchment update failed`);
      }

      if (jobStatus.state == JobStatusState.completed) {
        return true;
      }

      milliSecondsLeftToWait -= waitTimeMs;

    }

    throw new Error("Catchment update timed out");
  }
}
