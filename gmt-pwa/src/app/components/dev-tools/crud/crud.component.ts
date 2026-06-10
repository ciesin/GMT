import { Component, OnDestroy, OnInit } from '@angular/core';
import { VectorLayerService } from "src/app/services/vector_layer/vector-layers.service";
import { takeUntil } from "rxjs/operators";
import { PwaUpdateService } from "src/app/services/pwa-update.service";
import { IsLoadingService } from "src/app/services/is-loading.service";
import { testLocalStorageLimits } from "src/app/utils/container";
import { CrudLayerService } from "src/app/services/vector_layer/crud-layer.service";
import {firstValueFrom, Subject} from "rxjs";
import { IndicatorService } from "src/app/services/indicator.service";
import { NGXLogger } from 'ngx-logger';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { UserContextService } from "src/app/services/user-context.service";
import { DataExportService } from '@services/export/data-export.service';
import {AppConfigService} from "../../../utils/app-config.service";
import {DefaultQueueResponse} from "../../../utils/server-interfaces/CrudAction";
import { HttpClient } from "@angular/common/http";

@Component({
    selector: 'app-crud',
    templateUrl: './crud.component.html',
    styleUrls: ['./crud.component.less'],
    standalone: false
})
export class CrudComponent implements OnInit, OnDestroy {
  isEdit: boolean;

  notifier = new Subject();
  // public userHasParticipationManagerRole: boolean = false;
  private unsubscribe = new Subject();

  constructor(
    // private authService: AuthService,
    private vectorLayerService: VectorLayerService,
    private crudLayerService: CrudLayerService,
    private pwaUpdateService: PwaUpdateService,
    private loadingService: IsLoadingService,
    private indicatorService: IndicatorService,
    private logger: NGXLogger,
    private _bottomSheetRef: MatBottomSheetRef<CrudComponent>,
    private userContextService: UserContextService,
    private dataExportService: DataExportService,
    private http: HttpClient
    // private microplanEditService: MicroplanEditService,
  ) {
  }

  ngOnInit(): void {
    this.userContextService.getIsEditingObservable().pipe(
      takeUntil(this.unsubscribe)
    ).subscribe(edit => this.isEdit = edit);
    // this.authService.loggedIn().pipe(takeUntil(this.unsubscribe)).subscribe(
    //   (loggedIn: boolean | null) => {
    //     if (loggedIn) {
    //       this.saveAndUpdatePermissions();
    //     }
    //   });
  }

  ngOnDestroy(): void {
    this.notifier.next(null);
    this.notifier.complete();
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  async clearCrudActions() {
    this.logger.info("Clearing edits");
    await this.crudLayerService.clearEdits();
    this.closeBottomSheet();
  }

  async clearIndexDB() {
    await this.vectorLayerService.clearAll();
    this.closeBottomSheet();
  }

  async refreshOfflineData() {
    this.logger.info("refresh offline data");
    await this.vectorLayerService.refreshOfflineData(false);
    await this.crudLayerService.checkIfNeedsSync();
    this.closeBottomSheet();
  }

  async refreshPwa() {
    await this.pwaUpdateService.checkPwaUpdate();
    this.closeBottomSheet();
  }

  async handleTestOfflineStorageLimits() {
    await testLocalStorageLimits();
    this.closeBottomSheet();
  }


  // async resetParticipationFlags() {
  //   await this.microplanEditService.resetParticipationFlags();
  // }

  async refreshIndicators() {
    //Assume is online
    this.logger.info("Refreshing indicators...");
    this.loadingService.setLoading(true);
    //add commit to force other clients to update, this is important if we are doing this after a catchment update
    //and want dashboard data to update without intervention
    const jobId: number = await this.indicatorService.requestFullIndicatorUpdate(true, true);

     // const jobId: number =  await this.indicatorService.requestIndicatorUpdate(['3814a499-0649-407c-912e-2482932be65f']);
    this.indicatorService.indicatorsJobStatusMonitoring(jobId);
  }

  async refreshStateExports() {
    await this.dataExportService.refreshStateExports();
  }

  async refreshAllCatchments() {
    const url = `${AppConfigService.conf.api_url}/updateAllCatchments`;
    this.logger.info(url);
      const httpData = await firstValueFrom(this.http.post<{ jobIds: Array<number> }>(
        url, {
            startFromIndex: 0
          }
        ));
      this.logger.info(httpData, 'httpData');
      this.logger.info("Refresh All Catchments job started");
  }

  async handleEditChange(newIsEditing: boolean) {
    this.userContextService.setIsEditing(newIsEditing);
  }

  private closeBottomSheet() {
    this._bottomSheetRef.dismiss();
  }

  // private saveAndUpdatePermissions(): void {
  //   let roles = this.authService.getUserRoles();
  //   this.userHasParticipationManagerRole = roles.includes(ParticipationManagerRole.id);
  // }

}
