import { Injectable } from '@angular/core';
import {
  MapEventsService,
  ZoomMode,
} from '@services/map/base/map-events.service';
import { NGXLogger } from 'ngx-logger';
import { BehaviorSubject, filter, Subject, switchMap, takeUntil } from 'rxjs';
import {
  BoundaryVectorLayersService,
  DropdownBoundary,
} from 'src/app/services/boundary-vector-layers.service';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { RIRouteService } from 'src/app/services/shared/route/ri-route.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { PermissionsLayerService } from 'src/app/services/vector_layer/permissions-layer.service';
import {
  computeCatchmentPopulation,
  getSettlements,
  SingleHfProcessingService,
} from 'src/app/services/vector_layer/single-hf-processing.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  catchmentDistanceMeters,
  getExtentedBoundingBoxForFeatures,
  safeDistance,
} from 'src/app/utils/coords';
import {
  CATCHMENT_STATUS_IN_PROGRESS,
  FIXED_HEALTH_FACILITY_TYPE,
  GeoJsonCatchmentItem,
  GeoJsonHealthFacility,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
  HealthFacilityLevelOfCare,
  HealthFacilityServices,
  OUTREACH_HEALTH_FACILITY_TYPE,
  SettlementListItem,
} from 'src/app/utils/server-interfaces/GeoJson';
import { isEmpty } from 'src/app/utils/server-interfaces/utils/geom.util';
import {
  getCiComputedPop,
  getSpComputedPop,
  safeDivide,
} from 'src/app/utils/server-interfaces/utils/indicator.util';
import { VectorLayerForPermissions } from 'src/app/utils/server-interfaces/VectorLayerName';
import { HealthFacilityOwnership } from '../../constants/hf.constants';

import _ from 'lodash';

export interface HealthFacilitySite {
  name: string;
  json: GeoJsonHealthFacility;
}

export interface CatchedSettlement extends BaseSettlement, SettlementListItem {
  //catchedProportion: number;
  //because a settlement may be related to a fixed post and its child, we need an array
  //These are catchments of the currently selected hf (fp & outreaches)
  catchmentJson: Array<GeoJsonCatchmentItem>;
  //inAnotherBoundaryTooltip: string,
  settlementName: GeoJsonSettlementName;
  settlementPart: GeoJsonSettlementPart;
  //totalPopulation: number; //catched + not catched
  //type: "settlement",
}

interface BaseSettlement {
  inBoundary: boolean;
}

interface SuggestedSettlement extends BaseSettlement {
  catchments: Array<GeoJsonCatchmentItem>;
  fixedPostPopulation: number;
  fixedPostProportion: number;
  inBoundary: boolean;
  outreachPopulation: number;
  outreachProportion: number;
  settlementName: GeoJsonSettlementName;
  settlementPart: GeoJsonSettlementPart;
  unclaimedPopulation: number;
  unclaimedProportion: number;
}

interface CatchmentStats {
  estPop: number;
  population: number;
  travelTimeWalking: number;
  travelTimeMixed: number;
  totalCountSettlements: number;
}

@Injectable({
  providedIn: 'root',
})
export class SingleHfService {
  outreachesPopulation: number;
  public catchmentStats: CatchmentStats = {
    totalCountSettlements: -1,
    population: -1,
    estPop: -1,
    travelTimeMixed: -1,
    travelTimeWalking: -1,
  };
  public editing = false;
  //Note this is the current hfId from the router, which could be an outreach id
  public hfId: string | null = null;
  //Note that even if we navigate to an outreach, this will be set to the parent fixed post
  public hf = new BehaviorSubject<GeoJsonHealthFacility | null>(null);
  public hfColor: string = '';

  // if user navigates to the outreach, we should open parent fixed post but with opened outreach accordion
  public outreachGuid: string | null = null;

  //to be independent of the above, this is just if an outreach has been expanded in the ui in order to preserve
  //that state
  public expandedOutreachGuid: string | null = null;

  //For both the following maps
  //Keys are Settlement name global ids, includes for fixed post and all outreach children
  public includedSettlementsMap: Map<string, CatchedSettlement> = new Map();
  public excludedSettlementsMap: Map<string, CatchedSettlement> = new Map();

  //public outreachGuid: string = null;
  public loaded = false;
  public outreaches: Array<HealthFacilitySite> = [];
  public suggestedSettlements: SuggestedSettlement[] = [];
  public surroundingBoundaryOptions: Array<DropdownBoundary> = [];

  //Note these permissions often need to be paired with this.bvService.isOffline
  //because even if a user has rights to a boundary, if they don't have it checked out, then
  //they will change it without a possibility of syncing their changes
  public userHasPermissionsCreateHf = false;
  public userHasPermissionsUpdateCatchment = false;
  public userHasPermissionsUpdateHf = false;
  private isDeleting = false;
  private alreadyHighlighted: boolean = false;
  private unsubscribe = new Subject();

  constructor(
    private crudLayerService: CrudLayerService,
    private permissionsLayerService: PermissionsLayerService,
    public mapEvents: MapEventsService,
    private userContextService: UserContextService,
    //used by the page for boundaryParents, so public
    public bvService: BoundaryVectorLayersService,
    public messageService: MessageService,
    public logger: NGXLogger,
    private riRouteService: RIRouteService,
    public singleHfProcessingService: SingleHfProcessingService
  ) {
    this.listenForHfData();
  }

  public async nameChange(newName: string) {
    if (_.isNil(this.hf.value)) {
      this.logger.warn('hf null');
      return;
    }
    return await this.singleHfProcessingService.nameChange(
      this.hf.value,
      newName
    );
  }

  public async commentsChange(newComments: string) {
    if (_.isNil(this.hf.value)) {
      this.logger.warn('hf null');
      return;
    }
    return await this.singleHfProcessingService.commentsChange(
      this.hf.value,
      newComments
    );
  }

  public async ownershipChange(newOwnership: HealthFacilityOwnership) {
    if (_.isNil(this.hf.value)) {
      this.logger.warn('hf null');
      return;
    }
    return await this.singleHfProcessingService.ownershipChange(
      this.hf.value,
      newOwnership
    );
  }

  public async typeChange(newType: HealthFacilityLevelOfCare) {
    if (_.isNil(this.hf.value)) {
      this.logger.warn('hf null');
      return;
    }
    return await this.singleHfProcessingService.typeChange(
      this.hf.value,
      newType
    );
  }
  public async serviceChange(newServices: HealthFacilityServices[]) {
    if (_.isNil(this.hf.value)) {
      this.logger.warn('hf null');
      return;
    }
    return await this.singleHfProcessingService.serviceChange(
      this.hf.value,
      newServices
    );
  }
  public ownershipMap(privateHf: boolean) {
    return this.singleHfProcessingService.ownershipMap(privateHf);
  }

  public handleShowHfSiteOnMap() {
    if (_.isNil(this.hf.value)) {
      this.logger.warn('hf null');
      return;
    }
    return this.singleHfProcessingService.handleShowHfSiteOnMap(this.hf.value);
  }

  public enableLocationWizard() {
    if (_.isNil(this.hf.value)) {
      this.logger.warn('hf null');
      return;
    }
    this.singleHfProcessingService.enableLocationWizard(this.hf.value);
  }

  private listenForHfData() {
    this.userContextService
      .getIsEditingObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((v) => {
        this.editing = v;
      });
    this.riRouteService
      .getBoundaryIdObs()
      .pipe(
        filter((boundaryId) => !!boundaryId),
        switchMap((boundaryId) => {
          return this.bvService.ensureBoundaryLoaded(boundaryId!);
        }),
        switchMap((_ok) => {
          return this.riRouteService.getHfIdObs();
        }),
        //Don't check if the hfId changed, because data may have been refreshed
        filter((hfId) => !!hfId),
        switchMap((hfId) => {
          this.hfId = hfId;
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
      .subscribe(async () => {
        await this.initializeComponentOnceLoaded();
      });
    // Not sure we need this, redo should trigger crud actions
    // this.crudLayerService.getRedoEventObservable().pipe(takeUntil(this.unsubscribe)).subscribe(_ => {
    //   this.initializeComponentOnceLoaded();

    // });
    this.permissionsLayerService
      .getPermissionsObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((_) => {
        this.setComponentPermissions();

        //Because components updating on hf perms listen to is editing, we set it to trigger the observable
        this.userContextService.setIsEditing(this.userContextService.getIsEditing());
      });
  }

  private async initializeComponentOnceLoaded() {
    if (this.isDeleting) {
      return;
    }

    this.outreachGuid = null;
    this.loaded = false;
    this.logger.info(
      `Health facility edit.  hf id ${this.hfId} boundary ${this.bvService.boundaryInfo.boundary.properties.global_id} ${this.bvService.boundaryInfo.boundary.properties.name}`
    );

    //, should only be called once usually since data already fetched"
    //and when user adds a catchment

    let hf = this.bvService.data.hfMap.get(this.hfId!)!;

    if (!hf) {
      this.logger.error(`Cannot find health facility with id ${this.hfId}`);
      return;
    }
    // if user navigates to the outreach, we should open parent fixed post but with opened outreach accordion
    const isOutreach = hf.properties.parent !== null;
    if (isOutreach) {
      this.outreachGuid = hf.properties.global_id;
      hf = this.bvService.data.hfMap.get(hf.properties.parent!)!;
      if (!hf) {
        this.logger.error(
          `Cannot find parent health facility with id ${this.hfId}`
        );
        return;
      }
    }
    if (hf.properties.mp_status === 'Unknown') {
      //The work is in progress #567
      this.setDefaultCatchmentStatus(hf);
    }

    // TODO finish
    // if (isEmpty(this.hf)) {
    //   this.hfErrorMessage = "No catchment can be allocated to this health facility until you give it a location.";
    // } else {
    //   this.newLonStr = this.hf.geometry.coordinates[0].toFixed(5);
    //   this.newLatStr = this.hf.geometry.coordinates[1].toFixed(5);
    // }

    //See comments in settlement-edit for why  -- https://github.com/novelt/GMT/issues/442
    // if (this.hfEditName.length == 0) {
    //   this.hfEditName = hf.properties.name;
    // }
    this.buildCatchedSettlementTree(hf);
    this.buildSuggestedSettlements(hf);

    this.setComponentPermissions();

    this.surroundingBoundaryOptions =
      (await this.bvService.buildSurroundingBoundaryDropdownItems(false))!;
    //this.selectedWard = this.surroundingBoundaryOptions.find( dv => dv.boundaryId == hf.properties.boundary_polygon);

    this.setDefaultCatchmentStatus(hf);
    this.loaded = true;

    if (hf) {
      //this.logger.debug(`EEE single hf service firing for HF ${hf.properties.name}`);
      this.hf.next(hf);
    }
  }

  private setComponentPermissions(): void {
    if (this.bvService.boundaryInfo?.boundary) {
      this.userHasPermissionsCreateHf =
        this.userContextService.userHasPermissions(
          VectorLayerForPermissions.healthFacility,
          'create',
          this.bvService.boundaryInfo.boundary.properties.global_id
        );
      this.userHasPermissionsUpdateHf =
        this.userContextService.userHasPermissions(
          VectorLayerForPermissions.healthFacility,
          'update',
          this.bvService.boundaryInfo.boundary.properties.global_id
        );
      this.userHasPermissionsUpdateCatchment =
        this.userContextService.userHasPermissions(
          VectorLayerForPermissions.riCatchment,
          'update',
          this.bvService.boundaryInfo.boundary.properties.global_id
        );
    }
    //this.logger.debug(`EEE single hf service setComponentPermissions boundary? ${this.bvService.boundaryInfo?.boundary} ${this.bvService.boundaryInfo?.boundary?.properties.global_id} create ${this.userHasPermissionsCreateHf} u ${this.userHasPermissionsUpdateHf} u-catchment ${this.userHasPermissionsUpdateCatchment}`);
  }

  /*
    Note--
    ci items associate a health facility and a settlement part, and this is done per hf id (fixed post or outreach)
    However !  The ui displays excluded settlements for a hf and all its outreach children
    */
  public buildCatchedSettlementTree(hf: GeoJsonHealthFacility) {
    this.includedSettlementsMap = new Map();
    this.excludedSettlementsMap = new Map();
    let computedPopTot = 0;
    let cPopTot;
    let outreachesComputedPop = 0;

    const hfLoader = { logger: this.logger, boundaryData: this.bvService.data };
    getSettlements(
      hfLoader,
      hf,
      this.includedSettlementsMap,
      this.excludedSettlementsMap
    );

    computedPopTot += cPopTot;

    this.outreaches = [];
    for (let outreach of this.bvService.data.hfChildMap.get(
      hf.properties.global_id
    ) || []) {
      const catchPop = computeCatchmentPopulation(
        hfLoader,
        outreach.properties.global_id
      );
      outreachesComputedPop += catchPop.computedPop;

      const outreachSite: HealthFacilitySite = {
        json: outreach,
        name: outreach.properties.name,
      };
      getSettlements(
        hfLoader,
        outreach,
        this.includedSettlementsMap,
        this.excludedSettlementsMap
      );
      computedPopTot += cPopTot;
      this.outreaches.push(outreachSite);
    }

    this.outreachesPopulation = outreachesComputedPop;

    //This looks wrong, though it seems pdf, the only place this is used, recalculates this
    this.catchmentStats.population = computedPopTot;
  }

  public getOutreachesCountByHfId(hfId: string) {
    return (this.bvService.data.hfChildMap.get(hfId) || []).length;
  }

  public getIncludedSettlementsCountByHfId(hfId: string) {
    let spGlobalIds = new Set<string>();
    const catchmentsForHF = this.bvService.data.getCatchmentForHf(
      hfId,
      true,
      true
    );

    for (const ci of catchmentsForHF) {
      //Not needed to count the settlement names as 1 settlement part == 1 settlement name
      //for (const sn of this.bvService.data.getPrimaryNamesForSettlementPart(ci.properties.settlement_part)) {
      //Also these should be unique (1 settlement_part max per hf) but it doesn't hurt to use the set
      spGlobalIds.add(ci.properties.settlement_part);
    }
    return spGlobalIds.size;
  }

  public buildSuggestedSettlements(hf: GeoJsonHealthFacility) {
    this.suggestedSettlements = [];

    for (const settlementName of this.bvService.data.snList) {
      //We only want names that are associated with a settlement part
      if (
        !settlementName.properties.is_primary ||
        !settlementName.properties.settlement_part ||
        !this.bvService.data.spMap.has(
          settlementName.properties.settlement_part
        )
      ) {
        continue;
      }
      const inBoundary =
        settlementName.properties.boundary_polygon ===
        this.bvService.data.boundaryId;

      if (
        !inBoundary &&
        AppConfigService.MAX_SUGGESTED_SETTLEMENT_NAME_DISTANCE <= 0
      ) {
        continue;
      }

      const settlementPart = this.bvService.data.spMap.get(
        settlementName.properties.settlement_part!
      )!;

      const distanceMeters = catchmentDistanceMeters(settlementPart, hf);

      //Don't want to encourage out of boundary outreach sites
      if (
        !inBoundary &&
        distanceMeters >=
          AppConfigService.MAX_SUGGESTED_SETTLEMENT_NAME_DISTANCE
      ) {
        continue;
      }

      const populationTotal = getSpComputedPop(settlementPart);
      const catchments = this.bvService.data.getCatchmentForSp(
        settlementPart.properties.global_id,
        true,
        true
      );
      let outreachPopulation = 0;

      let fixedPostPopulation = 0;

      for (const catchment of catchments) {
        //We filtered invalid so we can assume we have a hf
        const healthFacilitySite = this.bvService.data.hfMap.get(
          catchment.properties.health_facility_point
        )!;

        //There will be no excluded entries

        if (
          healthFacilitySite.properties.type === OUTREACH_HEALTH_FACILITY_TYPE
        ) {
          outreachPopulation += getCiComputedPop(
            settlementName,
            settlementPart,
            catchment
          );
        } else if (
          healthFacilitySite.properties.type === FIXED_HEALTH_FACILITY_TYPE
        ) {
          fixedPostPopulation += getCiComputedPop(
            settlementName,
            settlementPart,
            catchment
          );
        } else {
          this.logger.warn(
            'Strategy not taken into account, settlementPart: ',
            settlementPart,
            ', catchment: ',
            catchment
          );
        }
      }

      let outreachProportion = safeDivide(outreachPopulation, populationTotal);
      let fixedPostProportion = safeDivide(
        fixedPostPopulation,
        populationTotal
      );

      let unclaimedPopulation =
        populationTotal - fixedPostPopulation - outreachPopulation;
      //At least half a person, to account for rounding error
      if (unclaimedPopulation > 0.5) {
        this.suggestedSettlements.push({
          settlementName,
          settlementPart,
          catchments,
          inBoundary,
          //catchedPopulation: populationTotal,
          fixedPostPopulation,
          fixedPostProportion,
          outreachPopulation,
          outreachProportion,
          unclaimedPopulation,
          unclaimedProportion: 1 - fixedPostProportion - outreachProportion,
        });
      }
    }
  }

  private highlightHealthFacility() {
    //Don't annoy the user by jumping around every time we get observable updates
    if (this.alreadyHighlighted) {
      return;
    }
    if (isEmpty(this.hf.value)) {
      this.logger.info('Cannot highlight HF without geometry');
      return;
    }

    this.handleShowClaimed(true);
    this.alreadyHighlighted = true;
  }

  private handleShowClaimed(pan = false) {
    if (pan) {
      const fcList: Array<GeoJsonSettlementName | GeoJsonHealthFacility> =
        Array.from(this.includedSettlementsMap.values()).map(
          (s) => s.settlementName
        );
      fcList.push(...this.outreaches.map((outreach) => outreach.json));
      fcList.push(this.hf.value!);
      const bounding_box = getExtentedBoundingBoxForFeatures(1000, ...fcList);

      //workaround since possible the data change is triggering a rezoom of the map
      this.mapEvents.panToExtent({
        movementType: 'Pan',
        extent: bounding_box,
        zoomMode: ZoomMode.ZOOM_IN_MAX,
      });
    }
  }
  /**
   * Function where default values should be set instead of undefined
   * Currently only catchment status is set
   * // TODO make accessible only for those who has access to edit
   * TODO - do I need to edit in a different way
   * @private
   */
  private setDefaultCatchmentStatus(hf: GeoJsonHealthFacility): void {
    if (!hf.properties.mp_status) {
      hf.properties.mp_status = CATCHMENT_STATUS_IN_PROGRESS;
    }
  }
}

export function computeCatchmentDistances(
  hf: GeoJsonHealthFacility,
  names: Array<GeoJsonSettlementName>,
  catchmentStats: CatchmentStats
) {
  let totalDistance = 0;

  for (const name of names) {
    const distanceMeters = safeDistance(name, hf);

    totalDistance += distanceMeters;
  }

  catchmentStats.travelTimeMixed =
    totalDistance / AppConfigService.DRIVING_SPEED_MS;
  catchmentStats.travelTimeWalking =
    totalDistance / AppConfigService.WALKING_SPEED_MS;

  catchmentStats.totalCountSettlements = names.length;
}
