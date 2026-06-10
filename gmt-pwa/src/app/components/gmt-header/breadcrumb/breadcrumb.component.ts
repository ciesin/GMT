import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CoverageBoundary } from '@components/catchment-card/sett-catchment-card.component';
import { callBlockingUiUntilDone } from '@components/wizard/wizard-location-control/helper-methods';
import { BoundaryVectorLayersService } from '@services/boundary-vector-layers.service';
import { IsLoadingService } from '@services/is-loading.service';
import { MapEventsService } from '@services/map/base/map-events.service';
import { MicroplanMapEventsService } from '@services/map/MicroplanMapEventsService';
import { ConfirmationService } from '@services/shared/notifications/confirmation.service';
import { MessageService } from '@services/shared/notifications/message.service';
import { UserContextService } from '@services/user-context.service';
import { AuthService } from '@services/user/auth.service';
import { BoundaryLayerService } from '@services/vector_layer/boundary-layer.service';
import { CrudLayerService } from '@services/vector_layer/crud-layer.service';
import { VectorLayerService } from '@services/vector_layer/vector-layers.service';
import {
  ACTION_LIST,
  AUTO_SYNC_ENABLED,
  SP_TO_SYNC_LIST,
} from '@services/vector_layer/VectorLayerDatabase';
import * as _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { filter, Subject, switchMap, takeUntil } from 'rxjs';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { BreadcrumbService } from 'src/app/services/breadcrumb.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { getNumberSafe } from 'src/app/utils/server-interfaces/utils/indicator.util';
import { formatPopulation } from 'src/app/utils/string-formatting';
import { v4 as uuidv4 } from 'uuid';
import { GeoJsonSettlementPart } from '../../../utils/server-interfaces/GeoJson';

@Component({
  selector: 'gmt-breadcrumb',
  templateUrl: './breadcrumb.component.html',
  styleUrls: ['./breadcrumb.component.less'],
  standalone: false,
})
export class BreadcrumbComponent implements OnInit, OnDestroy {
  public boundaryCoverage: CoverageBoundary;
  private riModule: boolean = false;
  private boundaryId: string | null = null;
  private unsubscribe = new Subject();

  public isAutoCatchmentEnabled: boolean = true;
  public itemsToRecalc = 0;

  constructor(
    public breadcrumbService: BreadcrumbService,
    private activatedRoute: ActivatedRoute,
    private boundaryLayerService: BoundaryLayerService,
    private bvService: BoundaryVectorLayersService,
    public crudLayerService: CrudLayerService,
    private router: Router,
    private mapEvents: MapEventsService,
    private userContextService: UserContextService,
    public isLoadingService: IsLoadingService,
    public microplanMapEvents: MicroplanMapEventsService,
    private vectorLayerService: VectorLayerService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private authService: AuthService,
    private logger: NGXLogger
  ) {
    this.resetCatchmentInfo();
  }

  async ngOnInit() {
    this.router.events
      .pipe()
      .subscribe(
        () =>
          (this.riModule = this.router.url.includes(
            RoutesChunks.ROUTINE_IMMUNIZATION
          ))
      );
    // all this chain is just not to ask for vector data before it is loaded
    this.breadcrumbService
      .getBoundaryIdObs()
      .pipe(
        switchMap(async (boundaryId) => {
          this.boundaryId = boundaryId;
          this.resetCatchmentInfo();
          if (boundaryId === null) {
            return;
          }
          await this.addCatchmentDataFromIndicators();
          return this.bvService.ensureBoundaryLoaded(boundaryId);
        }),
        switchMap((_) => {
          return this.crudLayerService.suppressUserInterfaceUpdates.asObservable();
        }),
        filter((suppressUi) => !suppressUi),
        switchMap((_ok) => {
          return this.mapEvents.getIsMapInitialized();
        }),
        filter((mapInit) => {
          return mapInit;
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe(async (boundaryId) => {
        // if we are in RI module, let's try to get updated data
        if (this.riModule) {
          const updatedCatchmentData =
            this.breadcrumbService.getLowestAdminCatchmentInfo();

          if (updatedCatchmentData && updatedCatchmentData.pop > 0) {
            this.boundaryCoverage = updatedCatchmentData;
          }
        }
      });

    //load first to prevent saving the defaults to indexdb
    await this.loadAutoSyncValues();

    this.subscribeToAutoUpdates();
  }

  private subscribeToAutoUpdates() {
    this.userContextService.isAutoCatchmentMode$
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async (newValue) => {
        this.isAutoCatchmentEnabled = newValue;

        await this.vectorLayerService._db.key_value.put(
          newValue,
          AUTO_SYNC_ENABLED
        );
      });

    this.userContextService.spGuidsToCalc$
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async (spSet) => {
        this.updateItemToRecalcCount();

        const spList = Array.from(spSet);
        await this.vectorLayerService._db.key_value.put(
          spList,
          SP_TO_SYNC_LIST
        );
      });
  }

  private async loadAutoSyncValues() {
    //load initial value from indexdb
    let autoSync = (await this.vectorLayerService._db.key_value.get(
      AUTO_SYNC_ENABLED
    )) as boolean;
    if (!_.isBoolean(autoSync)) {
      autoSync = true;
    }
    this.userContextService.isAutoCatchmentMode$.next(autoSync);

    let syncList = (await this.vectorLayerService._db.key_value.get(
      SP_TO_SYNC_LIST
    )) as Array<string>;
    if (!_.isArray(syncList)) {
      syncList = [];
    }
    this.userContextService.spGuidsToCalc$.next(new Set<string>(syncList));
  }

  private updateItemToRecalcCount() {
    this.itemsToRecalc = this.userContextService.spGuidsToCalc$.value.size;
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  public redirectToRoot() {
    this.router.navigate(['/']).then();
  }

  public formatPopulation(pop: number | null) {
    return formatPopulation(pop);
  }

  public changeIsAutoCatchmentEnabled(isAutoCatchmentEnabled: boolean) {
    const summary = isAutoCatchmentEnabled
      ? 'Catchments will refresh automatically whenever you do changes that could affect them (default behaviour).'
      : 'From now on, catchments won’t refresh automatically whenever you do changes that could affect them.';

    this.messageService.add({ summary, detail: '', severity: 'info' });

    this.userContextService.isAutoCatchmentMode$.next(isAutoCatchmentEnabled);

    //Note if we do have changes and are switching back to auto mode, trigger a sync
    //Only do this on the manual switch to auto mode since we don't want to do this during switching/loading default values
    if (
      isAutoCatchmentEnabled &&
      this.userContextService.spGuidsToCalc$.value.size > 0
    ) {
      this.logger.info(
        'Recalculating catchment during switch back to auto mode'
      );
      this.recalculateCatchment().then();
    }
  }

  public async confirmRecalculateCatchment() {
    this.confirmationService.confirm({
      message: `Catchments will be updated.  This may take some time.`,
      header: 'Refresh all catchments?',
      icon: 'refresh',
      rejectLabel: 'Cancel',
      acceptLabel: 'Refresh',
      showRejectButton: true,
      accept: () => {
        this.recalculateCatchment().then();
      },
    });
  }

  private async recalculateCatchment() {
    this.logger.info('Recalc catchment');
    const spIds = Array.from(
      this.userContextService.spGuidsToCalc$.value.values()
    );

    const spList: Array<GeoJsonSettlementPart> = [];

    for (const spId of spIds) {
      const sp = this.bvService.data.spMap.get(spId);

      if (!sp) {
        this.logger.warn(`Could not find sp ${spId} to recalculate`);
        continue;
      }
      spList.push(sp);
    }

    const autoCalcValue = this.userContextService.isAutoCatchmentMode$.value;

    const _ok = await callBlockingUiUntilDone(this, async () => {
      const actionId = uuidv4();

      //needs to be true temporarily for the computeAllCatchmentAssignments call
      this.userContextService.isAutoCatchmentMode$.next(true);

      //This should be done for outreach or fixed post
      await this.bvService.computeAllCatchmentAssignments(
        spList,
        actionId,
        new Set()
      );

      //Re-establish value
      this.userContextService.isAutoCatchmentMode$.next(autoCalcValue);

      this.userContextService.spGuidsToCalc$.next(new Set<string>());

      return true;
    });

    this.microplanMapEvents.triggerCatchmentRendering();

    this.logger.info('Recalc catchment done');
  }

  private resetCatchmentInfo() {
    this.boundaryCoverage = {
      pop: 0,
      fixedPost: 0,
      outreach: 0,
      unclaimed: 0,
      problematic: 0,
    };
  }

  private async addCatchmentDataFromIndicators() {
    const boundary = await this.boundaryLayerService.fetchBoundaryById(
      this.boundaryId!
    )!;
    if (!boundary) {
      return;
    }
    this.boundaryCoverage = {
      pop: getNumberSafe(boundary.properties.boundary_pop),
      fixedPost: getNumberSafe(boundary.properties.catchment_pop_fp),
      outreach: getNumberSafe(boundary.properties.catchment_pop_outreach),
      unclaimed: getNumberSafe(boundary.properties.catchment_pop_unclaimed),
      problematic: getNumberSafe(boundary.properties.catchment_pop_problematic),
    };
  }
}
