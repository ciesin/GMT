import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { IndicatorService } from '@services/indicator.service';
import { ConfirmationService } from '@services/shared/notifications/confirmation.service';
import { MessageService } from '@services/shared/notifications/message.service';
import { NGXLogger } from 'ngx-logger';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { DefaultResponse } from 'src/app/utils/server-interfaces/CrudAction';

@Injectable({
  providedIn: 'root',
})
export class MicroplanEditService {
  constructor(
    private confirmationService: ConfirmationService,
    private http: HttpClient,
    private indicatorService: IndicatorService,
    private messageService: MessageService,
    private loadingService: IsLoadingService,
    private logger: NGXLogger
  ) {}

  enableParticipation(boundaryIds: string[]) {
    let warningWaitMessage = '';
    if (boundaryIds.length > 10) {
      warningWaitMessage =
        "Note this can take a long time (30+ minutes) dependending on how many boundaries are selected.  This time is to recalculate indicator statistics.  It's recommended to not do more than 1 state at a time.";
    }

    this.confirmationService.confirm({
      message: `Are you sure you want to enable participation in GMT microplanning for the selected boundaries? ${warningWaitMessage}`,
      header: 'Enable participation',
      icon: 'noicon',
      rejectLabel: 'No',
      showRejectButton: true,
      acceptLabel: 'Continue',
      accept: async () => {
        try {
          this.loadingService.setLoading(true);
          await this.enableBoundaryParticipation(boundaryIds);
          //Because we changed the participating flags, we should recalc indicators

          //pass a parameter to request full indicator update in order to change the version to retrigger
          //an update on clients as they connect.  This is to update the dashboard map (that shows the indicators)
          const jobId = await this.indicatorService.requestFullIndicatorUpdate(
            true,
            false
          );
          const success =
            await this.indicatorService.indicatorsJobStatusMonitoring(jobId);

          //Now we want to ask the user to refresh the page
          if (success) {
            this.confirmationService.confirm({
              message:
                'Indicators recalculated successfully, would you like to refresh the page to see the updated statistics?',
              accept: () => {
                location.reload();
              },
              showRejectButton: true,
              reject: () => {
                // Do nothing
              },
            });
          } else {
            //Trigger the catch block below to inform the user
            throw new Error('Indicator update failed');
          }
        } catch (e) {
          this.messageService.add({
            summary: 'Something failed while enabling participation',
            detail: e,
            severity: 'error',
            sticky: true,
            key: 'error-details',
          });
          this.logger.error('Something failed while enabling participation', e);
          this.loadingService.setLoading(false);
        }
      },
    });
  }

  public async resetMicroplanForBoundaries(
    boundaryId: string,
    adminName: string
  ) {
    this.confirmationService.confirm({
      message: `Are you sure you want to reset microplan for the \`${adminName}\` boundary?`,
      header: 'Reset microplan',
      icon: 'noicon',
      rejectLabel: 'No',
      showRejectButton: true,
      acceptLabel: 'Continue',
      accept: async () => {
        await this.doResetMicroplanForBoundaries(boundaryId);
      },
    });
  }

  private async doResetMicroplanForBoundaries(boundaryId: string) {
    this.loadingService.setLoading(true);
    try {
      await this.resetMicroplan([boundaryId]);

      //Because we changed the HF flags, we should recalc indicators
      //Not sure if we need to trigger a country wide reload...so passing updateCommitVersion=false to requestFullIndicatorUpdate
      const jobId = await this.indicatorService.requestFullIndicatorUpdate(
        false,
        false
      );
      this.indicatorService.indicatorsJobStatusMonitoring(jobId).then();
    } finally {
      this.loadingService.setLoading(false);
    }
  }

  public async resetParticipationFlags() {
    this.loadingService.setLoading(true);
    await this.disableAllBoundaryParticipation();

    //Because we changed the participating flags, we should recalc indicators
    const jobId = await this.indicatorService.requestFullIndicatorUpdate(
      true,
      false
    );
    const success = await this.indicatorService.indicatorsJobStatusMonitoring(
      jobId
    );

    //Now we want to ask the user to refresh the page, note this is a dev option, but still nice to see status
    this.confirmationService.confirm({
      message: `Participation flgas reset, indicators updated with success ${success}.  Reload page?`,
      accept: () => {
        location.reload();
      },
      reject: () => {
        // Do nothing
      },
      showRejectButton: true,
    });
  }

  private async enableBoundaryParticipation(boundaryIds: string[]) {
    /*
    The flow here is

    handleRegisterBoundaryParticipation is called, this changes the boundary table flags without creating a new commit version
    The indicator boundary version is changed to 0 to trigger an indicator calculation

    Then after, the caller of this method should call requestFullIndicatorUpdate with the option to create a commit version.
    this will update only the indicators that need to be updated (so the ones from above)

    This will also set all indicator versions to the latest commit version to avoid recalculating already up to date indicators.

    Now we have --
    version updated, to force clients to update
    the required indicators computed from the ones that had their participating flag changed


    BoundaryIds should be "condenced".  Only parents should be sent, not all children nodes
    See saveMPBoundaries
    */
    const url = `${AppConfigService.conf.api_url}/editMicroplan/updateParticipatingBoundaries`;
    this.logger.info(`${url} called with ${boundaryIds.length} boundaries`);

    const httpData = await firstValueFrom(
      this.http.post<DefaultResponse>(url, boundaryIds)
    );
    this.logger.debug(httpData, 'httpData');
    return httpData.success;
  }

  private async disableAllBoundaryParticipation() {
    const url = `${AppConfigService.conf.api_url}/editMicroplan/unregisterAllParticipatingBoundaries`;
    const httpData = await firstValueFrom(
      this.http.post<DefaultResponse>(url, {})
    );
    this.logger.debug(httpData, 'httpData');
    return httpData.success;
  }

  private async resetMicroplan(boundaryIds: string[]) {
    const url = `${AppConfigService.conf.api_url}/editMicroplan/resetMicroplan`;
    this.logger.info(url, boundaryIds);
    const httpData = await firstValueFrom(
      this.http.post<DefaultResponse>(url, boundaryIds)
    );
    this.logger.debug(httpData, 'httpData');
    return httpData.success;
  }
}
