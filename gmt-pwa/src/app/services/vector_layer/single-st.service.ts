import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MapEventsService } from '@services/map/base/map-events.service';
import { MicroplanMapEventsService } from '@services/map/MicroplanMapEventsService';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { BehaviorSubject, filter, Subject, switchMap, takeUntil } from 'rxjs';
import { callBlockingUiUntilDone } from 'src/app/components/wizard/wizard-location-control/helper-methods';
import { UninhabitedPopupDialogData } from 'src/app/routine-immu/st-details/st-details-content/uninhabited-popup/uninhabited-popup.component';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { RIRouteService } from 'src/app/services/shared/route/ri-route.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { PermissionsLayerService } from 'src/app/services/vector_layer/permissions-layer.service';
import { SingleStProcessingService } from 'src/app/services/vector_layer/single-st-processing.service';
import {
  FIXED_HEALTH_FACILITY_TYPE,
  GeoJsonHealthFacility,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
  OUTREACH_HEALTH_FACILITY_TYPE,
  ProblematicOption,
} from 'src/app/utils/server-interfaces/GeoJson';
import { VectorLayerForPermissions } from 'src/app/utils/server-interfaces/VectorLayerName';
import { v4 as uuidv4 } from 'uuid';

//Represents cumulative coverage of this fixed post + its outreach
//For the single settlement
interface FixedPostCatchment {
  //percentage 100 based
  percFixedPost: number;
  percOutreach: number;
  fixedPostJson: GeoJsonHealthFacility;
  outreachJsons: Array<GeoJsonHealthFacility>;
}

@Injectable({
  providedIn: 'root',
})
export class SingleStService {
  private stId: string | null;
  public stName = new BehaviorSubject<GeoJsonSettlementName | null>(null);
  // subNamesOpened: boolean = false;
  //showTab: "attribution" | "suggested" | "excluded" = "attribution";
  //showUninhabitedFreeTextInput: boolean = false;

  // populationTotal: number = -1;
  // outreachTotal: number = -1;
  // outreachTotalAfterFilter: number = -1;
  // outreachProportion: number = -1;
  // fixedPostTotal: number = -1;
  // fixedPostPopClaimedAfterFilters: number = -1;
  // fixedPostProportion: number = -1;
  // unclaimedTotal: number = -1;
  // unclaimedProportion: number = -1;
  // estimatedPopString = "";

  public fixedPostEntries: Map<string, FixedPostCatchment> = new Map();

  //primary name being edited
  public settlementName!: GeoJsonSettlementName;

  // //Because the name can change from edits being saved, we want to store this apart
  // //this assumes basically the name won't change other than from this form
  // //https://github.com/novelt/GMT/issues/442
  // public nameToEdit: string = "";

  // //The settlement part pointed to by the FK in settlement name
  public settlementPart: GeoJsonSettlementPart | undefined;

  // public canEditBoundary = AppConfigService.canEditBoundaryAttributes;
  // public selectedLocation: string;
  // public locationOptions: { [boundaryId: string]: { optionHtml: string } };

  // //Updated by observable
  // public editing = false;
  public userHasPermissionsUpdateSettlement = false;
  public userHasPermissionsCreateSettlement = false;
  public userHasPermissionToCreateHf: boolean = false;
  // public loaded = false;

  // public calculateTravelTime = AppConfigService.calculateTravelTime;

  // public accessibilityList: Array<ProblematicOption> = ALL_PROBLEMATIC_OPTIONS.map(t => t as ProblematicOption);

  // public settlementIsNotFound: boolean = false;

  // public multiplePrimaryNames: boolean = false;
  // public newLatStr: string;
  // public newLonStr: string;
  // private params: Params;

  private estimatedPopClearTimeout: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe = new Subject();

  constructor(
    private logger: NGXLogger,
    private riRouteService: RIRouteService,
    private bvService: BoundaryVectorLayersService,
    private userContextService: UserContextService,
    public crudLayerService: CrudLayerService, // callBlockingUiUntilDone
    private dialog: MatDialog,
    public isLoadingService: IsLoadingService, // callBlockingUiUntilDone
    private mapEvents: MapEventsService,
    private permissionsLayerService: PermissionsLayerService,
    public microplanMapEvents: MicroplanMapEventsService,
    private messageService: MessageService,
    // using other service that is not initialized from the id from url
    private singleStProcessingService: SingleStProcessingService
  ) {
    this.listenForStData();
  }

  public async nameChange(newName: string) {
    // using other service that is not initialized from the id from url
    return await this.singleStProcessingService.nameChange(
      this.settlementName,
      newName
    );
  }

  public async commentsChange(newComments: string) {
    // using other service that is not initialized from the id from url
    return await this.singleStProcessingService.commentsChange(
      this.settlementName,
      newComments
    );
  }

  public async synonymChange(newSynonyms: string[]) {
    if (
      _.isEqual(
        _.sortBy(this.settlementName.properties.synonyms),
        _.sortBy(newSynonyms)
      )
    ) {
      return;
    }
    this.settlementName.properties.synonyms = newSynonyms;
    await this.crudLayerService.updateItem(
      'settlement__name',
      this.settlementName
    );
  }

  public async problematicChange(
    newProblematic: ProblematicOption[]
  ): Promise<boolean> {
    if (!newProblematic) {
      return false;
    }
    if (_.isNil(this.stName.value)) {
      this.logger.warn('Settlement name nil!');
      return false;
    }
    if (
      this.stName.value.properties.problematic &&
      _.isEqual(
        newProblematic.sort(),
        this.stName.value.properties.problematic.sort()
      )
    ) {
      return false;
    }

    return callBlockingUiUntilDone(this, async () => {
      if (_.isNil(this.settlementPart)) {
        this.logger.warn('Settlement part nil!');
        return false;
      }
      if (_.isNil(this.stName.value)) {
        this.logger.warn('Settlement name nil!');
        return false;
      }

      const hadProblemsBefore =
        Array.isArray(this.stName.value.properties.problematic) &&
        this.stName.value.properties.problematic.length > 0;
      const haveProblemsNow = newProblematic.length > 0;

      this.stName.value.properties.problematic = newProblematic;

      let actionId = uuidv4();
      await this.crudLayerService.updateItem(
        'settlement__name',
        this.stName.value,
        true,
        true,
        actionId
      );

      //For the rest, we only need to recalculate and/or redraw the catchment if we are going from
      //0 problems => >0 or >0 => 0
      if (hadProblemsBefore == haveProblemsNow) {
        return false;
      }

      //If this settlement is part of a health facility catchment, we need to refresh the all settlement parts
      //belonging to that health facility to make sure the HF catchment gets updated in the catchment recalculation
      //Basically hfs are updated when all their SP are included in the catchment recalculation request
      const spCatchment = this.bvService.data.getCatchmentForSp(
        this.settlementPart.properties.global_id,
        true,
        true
      );
      const hfIds = new Set<string>();
      for (const ri of spCatchment) {
        hfIds.add(ri.properties.health_facility_point);
      }
      if (hfIds.size > 0) {
        const hfList: Array<GeoJsonHealthFacility> = [];
        for (const hfId of hfIds) {
          hfList.push(this.bvService.data.hfMap.get(hfId)!);
        }

        const spList = this.bvService.getSpListForHfList(hfList);
        await this.singleStProcessingService.redrawCatchment(
          this.settlementName,
          this.settlementPart,
          this.stName.value.properties.uninhabited,
          actionId,
          spList
        );
      } else {
        await this.singleStProcessingService.redrawCatchment(
          this.settlementName,
          this.settlementPart,
          this.stName.value.properties.uninhabited,
          actionId
        );
      }
      return true;
    });
  }
  /**
   * Trigger estimated pop change and related actions
   * Pass stName as a parameter in case user changes the page quickly before
   * estimatedPopClearTimeout ends
   * @param stName
   * @param newPop
   */
  public async handleEstimatedPopChange(newPop: number) {
    if (_.isNil(this.settlementPart)) {
      this.logger.warn('Settlement part nil!');
      return false;
    }
    return await this.singleStProcessingService.handleEstimatedPopChange(
      this.settlementName,
      this.settlementPart,
      newPop
    );
  }

  public async uninhabitedChange(
    uninhabited: UninhabitedPopupDialogData,
    actionId: string | null = null
  ) {
    if (_.isNil(this.settlementPart)) {
      this.logger.warn('Settlement part nil!');
      return false;
    }
    return await this.singleStProcessingService.uninhabitedChange(
      this.settlementName,
      this.settlementPart,
      uninhabited,
      actionId
    );
  }

  public async redrawCatchment(uninhabited: boolean, actionId: string) {
    if (_.isNil(this.settlementPart)) {
      this.logger.warn('Settlement part nil!');
      return false;
    }
    return await this.singleStProcessingService.redrawCatchment(
      this.settlementName,
      this.settlementPart,
      uninhabited,
      actionId
    );
  }

  public enableLocationWizard() {
    if (_.isNil(this.settlementPart)) {
      this.logger.warn('Settlement part nil!');
      return false;
    }
    this.singleStProcessingService.enableLocationWizard(
      this.settlementName,
      this.settlementPart
    );
    return true;
  }

  private listenForStData() {
    this.riRouteService
      .getBoundaryIdObs()
      .pipe(
        filter((boundaryId) => !!boundaryId),
        switchMap((boundaryId) => {
          return this.bvService.ensureBoundaryLoaded(boundaryId!);
        }),
        switchMap((_ok) => {
          this.stId = null;
          return this.riRouteService.getStIdObs();
        }),
        filter((stId) => this.stId != stId),
        switchMap((stId) => {
          this.stId = stId;
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
      .subscribe(() => {
        if (this.stId) {
          this.initializeComponentOnceLoaded();
        }
      });

    this.permissionsLayerService
      .getPermissionsObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((_) => {
        this.setComponentPermissions();
      });
  }

  private initializeComponentOnceLoaded() {
    this.settlementName = this.bvService.data.snMap.get(this.stId!)!;

    if (!this.settlementName) {
      this.logger.warn(
        `No settlement name found for [${this.stId}] ${this.bvService.data.snMap.size} ${this.bvService.boundaryInfo?.boundary?.properties.global_id} `
      );
      //This can happen during sync
      //this.messageService.add({ summary: "Error loading settlement name, data not found", severity: 'error' });
      // this.settlementIsNotFound = true;
      // this.loaded = true;
      return;
    } else {
      this.logger.info(
        `settlement name found for [${this.stId}] ${this.bvService.data.snMap.size} ${this.bvService.boundaryInfo?.boundary?.properties.global_id} `
      );
    }

    this.settlementPart = this.bvService.data.spMap.get(
      this.settlementName.properties.settlement_part!
    )!;

    this.buildHealthFacilityList();

    this.setComponentPermissions();

    //Update observable that we have loaded a new settlement name
    this.stName.next(this.settlementName);
  }

  private setComponentPermissions(): void {
    if (!this.bvService.boundaryInfo?.boundary) {
      return;
    }

    this.userHasPermissionsCreateSettlement =
      this.userContextService.userHasPermissions(
        VectorLayerForPermissions.settlement,
        'create',
        this.bvService.boundaryInfo.boundary.properties.global_id
      );
    this.userHasPermissionsUpdateSettlement =
      this.userContextService.userHasPermissions(
        VectorLayerForPermissions.settlement,
        'update',
        this.bvService.boundaryInfo.boundary.properties.global_id
      );
    this.userHasPermissionToCreateHf =
      this.userContextService.userHasPermissions(
        VectorLayerForPermissions.healthFacility,
        'create',
        this.bvService.boundaryInfo.boundary.properties.global_id
      );
  }

  /**
   * This is calculating for the current settlement, which health facilities have coverage in that settlement.
   *
   * It adds up the % values from the ri items, so
   * Hf id 123, fp 10% means that this hf fixed post is covering 10% of this settlements population
   * @returns
   */
  private buildHealthFacilityList() {
    if (!this.settlementPart) {
      return;
    }

    this.fixedPostEntries.clear();

    // const fixedPostHealthFacilities: Array<HealthFacilityCatchment> = [];
    // const outreachHealthFacilities: Array<HealthFacilityCatchment> = [];
    // const excludedColumnSorted: Array<HealthFacilityCatchment> = [];

    const catchments = this.bvService.data.getCatchmentForSp(
      this.settlementPart.properties.global_id,
      true,
      false
    );

    //Note that we may be related to a fixed post via an outreach parent too, and we don't want duplicates

    for (const catchment of catchments) {
      const healthFacilityJson = this.bvService.data.hfMap.get(
        catchment.properties.health_facility_point
      )!;

      if (catchment.properties.type == 'exclude') {
        //excludedColumnSorted.push(healthFacility);
        continue;
      }

      //Note because explicit includes also create the computed ones, we do not want them
      //double counted
      if (catchment.properties.type == 'include') {
        continue;
      }

      let fixedPostId: string | null = null;
      if (healthFacilityJson.properties.type === FIXED_HEALTH_FACILITY_TYPE) {
        fixedPostId = healthFacilityJson.properties.global_id;
      } else if (
        healthFacilityJson.properties.type === OUTREACH_HEALTH_FACILITY_TYPE
      ) {
        fixedPostId = healthFacilityJson.properties.parent;
      }

      if (fixedPostId == null) {
        throw new Error('fixedPostId null!');
      }
      if (!this.fixedPostEntries.has(fixedPostId)) {
        this.fixedPostEntries.set(fixedPostId, {
          fixedPostJson: this.bvService.data.hfMap.get(fixedPostId)!,
          outreachJsons: [],
          percFixedPost: 0,
          percOutreach: 0,
        });
      }

      const fixedPostCatchment = this.fixedPostEntries.get(fixedPostId)!;

      if (healthFacilityJson.properties.type === FIXED_HEALTH_FACILITY_TYPE) {
        fixedPostCatchment.percFixedPost +=
          catchment.properties.population_perc;
      } else if (
        healthFacilityJson.properties.type === OUTREACH_HEALTH_FACILITY_TYPE
      ) {
        fixedPostCatchment.outreachJsons.push(healthFacilityJson);
        fixedPostCatchment.percOutreach += catchment.properties.population_perc;
      }
    }
  }

  // private getSuggestedOutreachSites() {
  //   const sites: SuggestedOutreachSite[] = [];
  //   if (this.unclaimedProportion < 0.1) {
  //     return sites;
  //   }
  //   this.bvService.data.getHfsPerformingRI().forEach(healthFacility => {
  //     if (healthFacility.properties.type !== "fixed_post") {
  //       return;
  //     }
  //
  //     const distanceMeters = safeDistance(this.settlementName, healthFacility, -1);
  //     sites.push({
  //       name: healthFacility.properties.name,
  //       color: healthFacility.properties.color!,
  //       index: healthFacility.properties.index!,
  //       json: healthFacility,
  //       distanceMeters,
  //       travelTimeCar: distanceMeters / AppConfigService.DRIVING_SPEED_MS,
  //       travelTimeWalking: distanceMeters / AppConfigService.WALKING_SPEED_MS,
  //     });
  //   });
  //
  //   return sites;
  // }

  // private settlementHasMultiplePrimaryNames() {
  //   if (this.settlementPart) {
  //     const allSubNames = this.bvService.data.spToSnMap.get(this.settlementPart.properties.global_id) || [];
  //     const primaryNames = allSubNames.filter(sn => sn.properties.is_primary);
  //     return primaryNames.length > 1
  //   }
  //   return false;
  // }
}
