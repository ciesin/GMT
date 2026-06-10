import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import _ from 'lodash';
import cloneDeep from 'lodash.clonedeep';
import { NGXLogger } from 'ngx-logger';
import { take } from 'rxjs';
import {
  HealthFacilityOwnership,
  NOT_OPERATING_HOURS,
  OPERATING_HOURS,
  OWNERSHIP_PRIVATE,
  OWNERSHIP_PUBLIC,
} from 'src/app/constants/hf.constants';
import { LocationEditWizardComponent } from 'src/app/routine-immu/location-edit-wizard/location-edit-wizard.component';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { getExtentedBoundingBoxForFeatures } from 'src/app/utils/coords';
import {
  Frequency,
  GeoJsonCatchmentItem,
  GeoJsonHealthFacility,
  HealthFacilityLevelOfCare,
  HealthFacilityServices,
  Position,
} from 'src/app/utils/server-interfaces/GeoJson';
import { isEmpty } from 'src/app/utils/server-interfaces/utils/geom.util';
import {
  getNumberOrDefault,
  INVALID_COORD,
  isNullOrWhitespace,
} from 'src/app/utils/string-formatting';
import { v4 as uuidv4 } from 'uuid';

import { MatDialog } from '@angular/material/dialog';
import { LocationControlOutput } from '@components/wizard/wizard-location-control/wizard-location-control.component';
import {
  MapEventsService,
  ZoomMode,
} from '@services/map/base/map-events.service';
import { Coordinate } from 'ol/coordinate';
import { getCenter } from 'ol/extent';
import { DEFAULT_WIZARD_DIALOG_OPTIONS } from 'src/app/components/wizard/health-facility-wizard/health-facility-wizard.component';
import { callBlockingUiUntilDone } from 'src/app/components/wizard/wizard-location-control/helper-methods';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import {
  getCiComputedPop,
  getCiEstimatedGisPop,
  getCiEstimatedPopIfExists,
} from 'src/app/utils/server-interfaces/utils/indicator.util';
import { HF_LAYER } from 'src/app/utils/server-interfaces/VectorLayerName';
import { BoundaryDataClass } from '../geo/BoundaryDataClass';
import { CatchedSettlement } from './single-hf.service';

/**
 * Reusable service for editing st without initializing it from the url
 */
@Injectable({
  providedIn: 'root',
})
export class SingleHfProcessingService implements OnDestroy {
  private renameClearTimeout: ReturnType<typeof setTimeout> | null = null;
  private commentsClearTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private logger: NGXLogger,
    private bvService: BoundaryVectorLayersService,
    public crudLayerService: CrudLayerService,
    private dialog: MatDialog,
    private mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,
    private messageService: MessageService,
    public isLoadingService: IsLoadingService,
    private router: Router
  ) {}

  ngOnDestroy() {
    // Clean stuff
  }

  public async commentsChange(hf: GeoJsonHealthFacility, newComments: string) {
    // event is triggered first time when data is retrieved. That is why we need this check
    if (hf?.properties?.comments === newComments) {
      return;
    }
    //Cancel the delayed search if there is one
    if (this.commentsClearTimeout) {
      clearTimeout(this.commentsClearTimeout);
    }
    //Wait a second before executing
    this.commentsClearTimeout = setTimeout(async () => {
      hf.properties.comments = newComments;
      await this.crudLayerService.updateItem(
        'health_facility__point',
        hf,
        true
      );
    }, 1000);
  }

  public async nameChange(hf: GeoJsonHealthFacility, newName: string) {
    // event is triggered first time when data is retrieved. That is why we need this check
    if (isNullOrWhitespace(newName) || hf?.properties?.name === newName) {
      return;
    }
    //Cancel the delayed save if there is one
    if (this.renameClearTimeout) {
      clearTimeout(this.renameClearTimeout);
    }
    //Wait a second before executing
    this.renameClearTimeout = setTimeout(async () => {
      await this.updateName(hf, newName);
    }, 1000);
  }

  //Notify true on the problems page so that the boundary observable triggers (bvService.ensureBoundaryLoaded)
  public async ownershipChange(
    hf: GeoJsonHealthFacility,
    newOwnership: HealthFacilityOwnership,
    notify: boolean = false
  ) {
    const currentValue = this.ownershipMap(hf.properties.private);
    if (currentValue == newOwnership) {
      return;
    }
    hf.properties.private = newOwnership === OWNERSHIP_PRIVATE;
    await this.crudLayerService.updateItem(
      'health_facility__point',
      hf,
      notify
    );
  }

  public async typeChange(
    hf: GeoJsonHealthFacility,
    newType: HealthFacilityLevelOfCare
  ) {
    if (hf.properties.level_of_care === newType) {
      return;
    }
    hf.properties.level_of_care = newType;
    await this.crudLayerService.updateItem('health_facility__point', hf, false);
  }

  public async dayOptionChange(hf: GeoJsonHealthFacility, daysOpen: boolean[]) {
    const totalDaysOpen = applyDayOptions(hf, daysOpen);
    //await this.crudLayerService.updateItem("health_facility__point", hf);
    //default to lowest value (we don't want 0 but close to it)
    let newFrequency: Frequency = getWeeklyFrequencyValue(totalDaysOpen);

    //continues the inline edit
    await this.frequencyChange(hf, newFrequency);
  }
  public async frequencyChange(
    hf: GeoJsonHealthFacility,
    newFrequency: Frequency
  ) {
    if (newFrequency == hf.properties.frequency) {
      return;
    }

    this.bvService.forceAutoSyncOff();

    //Don't block the UI to set frequency
    hf.properties.frequency = newFrequency;

    //We don't want all the observables to trigger
    const actionId = uuidv4();

    //Do an inline edit, without updating the observables via notify=true
    //This depends on the catchment calculations fetching the hf in the boundary data
    //hfMap getting the inline edited instance
    await this.crudLayerService.updateItem(
      'health_facility__point',
      hf,
      false,
      false,
      actionId
    );

    //Calculations can depend on frequency
    //User will do this, opt in, since freq only changes weights
    await this.bvService.computeAllCatchmentAssignmentsForHF(
      hf,
      actionId,
      true
    );

    //Since we are not using callBlockingUiUntilDone, do this by hand
    this.microplanMapEvents.triggerCatchmentRendering();
  }

  public async serviceChange(
    hf: GeoJsonHealthFacility,
    newServices: HealthFacilityServices[]
  ) {
    if (_.isEqual(_.sortBy(hf.properties.services), _.sortBy(newServices))) {
      return;
    }

    const hadRiBefore = hf.properties.services.includes('Routine Immunization');
    const hasRiNow = newServices.includes('Routine Immunization');

    const hasOutreaches =
      hf.properties.type == 'fixed_post' &&
      (this.bvService.data.hfChildMap.get(hf.properties.global_id) || [])
        .length > 0;

    //Disallow removing ri if we have outreaches
    if (hadRiBefore && !hasRiNow && hasOutreaches) {
      this.messageService.add({
        summary: 'Unable to remove Routine Immunization service',
        detail:
          'This health facility currently has outreaches attached to it.  To remove Routine Immunization Service these outreaches must be deleted first.',
        severity: 'warning',
      });
      return;
    }

    if (hadRiBefore == hasRiNow) {
      //do an inline edit without notify / progress bars for faster update
      hf.properties.services = newServices;

      const actionId = uuidv4();
      await this.crudLayerService.updateItem(
        'health_facility__point',
        hf,
        false,
        false,
        actionId
      );
    } else {
      await callBlockingUiUntilDone(
        this,
        async () => {
          const hfEdit = cloneDeep(hf);

          hfEdit.properties.services = newServices;

          const actionId = uuidv4();
          await this.crudLayerService.updateItem(
            'health_facility__point',
            hfEdit,
            true,
            true,
            actionId
          );

          await this.bvService.computeAllCatchmentAssignmentsForHF(
            hfEdit,
            actionId,
            true
          );

          return true;
        },
        true
      );
    }

    if (newServices.length === 0) {
      this.messageService.add({
        summary: 'Health facility without services',
        detail:
          'Note that you have removed all services from the Health Facility',
        severity: 'warning',
      });
    }
  }

  public ownershipMap(privateHf: boolean | null) {
    if (privateHf === true) {
      return OWNERSHIP_PRIVATE;
    } else if (privateHf === false) {
      return OWNERSHIP_PUBLIC;
    } else {
      return null;
    }
  }

  public handleShowHfSiteOnMap(hf: GeoJsonHealthFacility) {
    if (isEmpty(hf)) {
      return;
    }
    this.mapEvents.center({
      movementType: 'Center',
      center: getCenter(getExtentedBoundingBoxForFeatures(1, hf)) as Position,
    });
    this.mapEvents.triggerDetailsPopupChange(HF_LAYER, hf.properties.global_id);
  }

  public enableLocationWizard(hf: GeoJsonHealthFacility) {
    let data: LocationControlOutput = {
      lon: hf.geometry.coordinates[0],
      lat: hf.geometry.coordinates[1],
      set_with_gps: hf.properties.set_with_gps || false,
    };

    let dialogRef = this.dialog.open(LocationEditWizardComponent, {
      ...DEFAULT_WIZARD_DIALOG_OPTIONS,
      data,
    });

    dialogRef.componentInstance.location
      //take(1) will close the observable, no need to unsubscribe after
      .pipe(take(1))
      .subscribe(async (location: LocationControlOutput) => {
        await this.handlePositionChange(hf, location);
      });
  }

  public async redirectToDetails(hf: GeoJsonHealthFacility) {
    await this.router.navigate(
      [
        RoutesChunks.ROUTINE_IMMUNIZATION,
        hf.properties.boundary_polygon,
        RoutesChunks.HEALTH_FACILITIES,
        hf.properties.global_id,
        RoutesChunks.EDIT,
      ],
      {
        queryParamsHandling: 'preserve',
      }
    );
  }

  public onOpenPanelAction(panelOpenState: boolean, hf: GeoJsonHealthFacility) {
    if (panelOpenState) {
      this.microplanMapEvents.triggerHfHighlightEvent(hf.properties.global_id);
      this.mapEvents.emitClicked({
        coordinates: [] as Coordinate,
        selectedLayer: HF_LAYER,
        selectedGlobalId: hf.properties.global_id,
      });
      this.mapEvents.panToExtent({
        movementType: 'Pan',
        extent: getExtentedBoundingBoxForFeatures(2000, hf),
        zoomMode: ZoomMode.DONT_CHANGE,
      });
    } else {
      this.microplanMapEvents.triggerHfHighlightEvent(null);
    }
  }
  private async handlePositionChange(
    hf: GeoJsonHealthFacility,
    location: LocationControlOutput
  ) {
    const lon = getNumberOrDefault(location.lon, INVALID_COORD);
    const lat = getNumberOrDefault(location.lat, INVALID_COORD);

    if (lon == INVALID_COORD || lat == INVALID_COORD) {
      return;
    }

    await callBlockingUiUntilDone(
      this,
      async () => {
        //To recompute properly
        const oldHf = cloneDeep(hf);

        hf.geometry.coordinates = [lon, lat];
        hf.properties.set_with_gps = location.set_with_gps;

        const actionId = uuidv4();
        await this.bvService.computeAllCatchmentAssignmentsForHF(
          hf,
          actionId,
          true,
          oldHf
        );

        await this.crudLayerService.updateItem(
          'health_facility__point',
          hf,
          true,
          false,
          actionId
        );

        return true;
      },
      true
    );

    //Wait until callBlockingUiUntilDone done so up updates will be enabeld
    this.microplanMapEvents.triggerhfMoved(hf.properties.global_id);
  }

  private async updateName(hf: GeoJsonHealthFacility, newName: string) {
    //Usually it's not a good idea to inline edit the values, instead relying on
    //the single data flow, though because names are edited as one types, this can explain why this is here
    hf.properties.name = newName;
    await this.crudLayerService.updateItem('health_facility__point', hf, true);
  }
}

export interface HfLoaderBase {
  boundaryData: BoundaryDataClass;
  logger: NGXLogger;
}

export interface CatchmentPopulation {
  //aka GIS pop
  computedPop: number;

  //Estimated pop (or null if nothing has est. pop)
  estimatedPop: number | null;

  //Use estimated, defaulting to GIS
  estimatedGisPop: number;
}

export const DEFAULT_CATCHMENT_POPULATION: CatchmentPopulation = Object.freeze({
  computedPop: 0,
  estimatedPop: null,
  estimatedGisPop: 0,
});

/**
 * Computes only for this HF, not any possible outreach site children
 * @return estimated / computed pop
 */

function computeCatchmentPopulationForHF(
  base: HfLoaderBase,
  catchmentsForHF: Array<GeoJsonCatchmentItem>,
  onlyProblematic = false
): CatchmentPopulation {
  const ret: CatchmentPopulation = {
    computedPop: 0,
    estimatedGisPop: 0,
    estimatedPop: null,
  };

  //catchments already should have been filtered via getCatchmentForHf
  for (const ci of catchmentsForHF) {
    //Include entries should generate generated ones
    if (ci.properties.type != 'generated') {
      continue;
    }

    const settlementPartId = ci.properties.settlement_part;
    const settlementPart = base.boundaryData.spMap.get(settlementPartId);

    if (!settlementPart) {
      base.logger.warn(`Settlement part ${settlementPartId} not found `);
      continue;
    }

    const snList =
      base.boundaryData.getPrimaryNamesForSettlementPart(settlementPartId);

    if (snList.length == 0) {
      base.logger.warn(
        `Settlement part ${settlementPartId} has no primary names`
      );
      continue;
    }

    for (const settlementName of snList) {
      if (onlyProblematic) {
        const isProblematic =
          Array.isArray(settlementName.properties.problematic) &&
          settlementName.properties.problematic.length > 0;
        if (!isProblematic) {
          continue;
        }
      }

      ret.estimatedGisPop += getCiEstimatedGisPop(
        settlementName,
        settlementPart,
        ci
      );
      ret.computedPop += getCiComputedPop(settlementName, settlementPart, ci);
      ret.estimatedPop = nullAdd(
        ret.estimatedPop,
        getCiEstimatedPopIfExists(settlementName, ci)
      );
    }
  }
  return ret;
}

export function addCatchmentPop(
  cPop1: CatchmentPopulation,
  cPop2: CatchmentPopulation
): CatchmentPopulation {
  const computedPop = cPop1.computedPop + cPop2.computedPop;
  const estimatedGisPop = cPop1.estimatedGisPop + cPop2.estimatedGisPop;
  const estimatedPop = nullAdd(cPop1.estimatedPop, cPop2.estimatedPop);
  return {
    computedPop,
    estimatedPop,
    estimatedGisPop,
  };
}

export function inlineAddCatchmentPop(
  cPopSum: CatchmentPopulation,
  cPop2: CatchmentPopulation
): void {
  cPopSum.computedPop += cPop2.computedPop;
  cPopSum.estimatedGisPop += cPop2.estimatedGisPop;
  cPopSum.estimatedPop = nullAdd(cPopSum.estimatedPop, cPop2.estimatedPop);
}

/*
// null + null == null
// null + numB == numB
// numA + null == numA
// numA + numB == numA + numB
*/
export function nullAdd(
  value1: null | number,
  value2: null | number
): number | null {
  const isNum1 = _.isFinite(value1);
  const isNum2 = _.isFinite(value2);

  if (isNum1 && isNum2) {
    return value1! + value2!;
  }

  if (isNum1) {
    return value1;
  }

  if (isNum2) {
    return value2;
  }

  return null;
}

export function computeCatchmentPopulation(
  base: HfLoaderBase,
  hfId: string,
  onlyProblematic = false
): CatchmentPopulation {
  const catchmentsForHF = base.boundaryData.getCatchmentForHf(hfId, true, true);

  return computeCatchmentPopulationForHF(
    base,
    catchmentsForHF,
    onlyProblematic
  );
}

export interface CoverageHf {
  //catchmentPopulation should be catchmentPopulationOutreach + catchmentPopulationFixedPost

  //SUFFIX_GIS, SUFFIX_EST, SUFFIX_EST_GIS
  catchmentPopulation: CatchmentPopulation;
  catchmentPopulationOutreach: CatchmentPopulation;
  catchmentPopulationFixedPost: CatchmentPopulation;
  global_id: string;
  name: string;
  percFixedPost: number;
  percOutreach: number;
  percProblematic: number;
  //Note this won't necesarily be settlementCountFixedPost+settlementCountOutreach because 1 settlement could be covered by an outreach + it's parent fixed post
  settlementCountTotal: number;
  settlementCountFixedPost: number;
  settlementCountOutreach: number;
  settlementCountProblematic: number;
  //settlementCountSuggestedOutreach: number,
  //This indicates if the health facility catchment has been marked as Done or not
  isCatchmentDone: boolean;
  hf?: GeoJsonHealthFacility;
}

export function loadHealthFacility(
  base: HfLoaderBase,
  hfId: string
): CoverageHf | null {
  const outreachesPopulation: CatchmentPopulation = _.cloneDeep(
    DEFAULT_CATCHMENT_POPULATION
  );
  const outreachProblematicPopulation = _.cloneDeep(
    DEFAULT_CATCHMENT_POPULATION
  );

  const fixedPost = base.boundaryData.hfMap.get(hfId);

  if (!fixedPost) {
    base.logger.error(`Unable to load hf id ${hfId}`);
    return null;
  }

  for (const outreachJson of base.boundaryData.hfChildMap.get(hfId) || []) {
    inlineAddCatchmentPop(
      outreachesPopulation,
      computeCatchmentPopulation(base, outreachJson.properties.global_id)
    );
    inlineAddCatchmentPop(
      outreachProblematicPopulation,
      computeCatchmentPopulation(base, outreachJson.properties.global_id, true)
    );
  }

  const fixedPostComputedPop = computeCatchmentPopulation(base, hfId, false);
  const fixedPostComputedProblematicPop = computeCatchmentPopulation(
    base,
    hfId,
    true
  );

  const catchmentPopulation = addCatchmentPop(
    fixedPostComputedPop,
    outreachesPopulation
  );

  const includedSettlementsMap: Map<string, CatchedSettlement> = new Map();
  const excludedSettlementsMap: Map<string, CatchedSettlement> = new Map();
  getSettlements(
    base,
    fixedPost,
    includedSettlementsMap,
    excludedSettlementsMap
  );

  const settlementCountFixedPost: number = includedSettlementsMap.size;

  const outreachIncludedSettlementsMap: Map<string, CatchedSettlement> =
    new Map();
  const outreachExcludedSettlementsMap: Map<string, CatchedSettlement> =
    new Map();

  for (const outreach of base.boundaryData.hfChildMap.get(
    fixedPost.properties.global_id
  ) || []) {
    //calculate twice to have overall + outreach only
    getSettlements(
      base,
      outreach,
      includedSettlementsMap,
      excludedSettlementsMap
    );
    getSettlements(
      base,
      outreach,
      outreachIncludedSettlementsMap,
      outreachExcludedSettlementsMap
    );
  }

  const settlementCountOutreach: number = outreachIncludedSettlementsMap.size;

  const allSettlements = Array.from(includedSettlementsMap.values());
  let settlementCountProblematic: number = allSettlements.filter(
    (settlement) => {
      return (
        (settlement.settlementName.properties.problematic || []).length > 0
      );
    }
  ).length;

  return {
    hf: fixedPost,
    catchmentPopulation,
    catchmentPopulationFixedPost: fixedPostComputedPop,
    catchmentPopulationOutreach: outreachesPopulation,
    name: fixedPost.properties.name,
    global_id: fixedPost.properties.global_id,
    percFixedPost:
      (100.0 * fixedPostComputedPop.computedPop) /
      catchmentPopulation.computedPop,
    percOutreach:
      (100.0 * outreachesPopulation.computedPop) /
      catchmentPopulation.computedPop,
    percProblematic:
      (100.0 *
        (outreachProblematicPopulation.computedPop +
          fixedPostComputedProblematicPop.computedPop)) /
      catchmentPopulation.computedPop,
    settlementCountTotal: allSettlements.length,
    settlementCountFixedPost,
    settlementCountOutreach,
    settlementCountProblematic,
    isCatchmentDone: fixedPost.properties.mp_status == 'Complete',
  };
}

/**
 * Returns this.fixedPost.notFilteredSettlements, this.fixedPost.excludedSettlements, and the catchment population
 *
 * Key is the settlementName global_id
 * @private
 */
export function getSettlements(
  base: HfLoaderBase,
  hf: GeoJsonHealthFacility,
  includedSettlementsMap: Map<string, CatchedSettlement>,
  excludedSettlementsMap: Map<string, CatchedSettlement>,
  filterOutUninhabited: boolean = true
) {
  const catchmentsForHF = base.boundaryData.getCatchmentForHf(
    hf.properties.global_id,
    filterOutUninhabited,
    false
  );

  //Note because of potential deferred calculation of catchments, anything that has been excluded
  //we make sure it's added to the included map, we do this here because the inc/exc map is shared between fixed post & outreach
  //so it may be excluded for this fixed post hf but not one of its child outreach ones
  const excludedSettlementPartIds = new Set<string>();

  for (const spId of catchmentsForHF
    .filter((c) => c.properties.type == 'exclude')
    .map((c) => c.properties.settlement_part)) {
    excludedSettlementPartIds.add(spId);
  }

  for (const ci of catchmentsForHF) {
    //Include ci items will include generated items
    if (ci.properties.type == 'include') {
      continue;
    }

    const sp = base.boundaryData.spMap.get(ci.properties.settlement_part)!;

    if (!sp) {
      continue;
    }

    for (const sn of base.boundaryData.getPrimaryNamesForSettlementPart(
      ci.properties.settlement_part,
      filterOutUninhabited
    )) {
      const inBoundary =
        sn.properties.boundary_polygon == base.boundaryData.boundaryId;
      const map =
        ci.properties.type == 'exclude'
          ? excludedSettlementsMap
          : includedSettlementsMap;

      if (
        map === includedSettlementsMap &&
        excludedSettlementPartIds.has(sp.properties.global_id)
      ) {
        //This could happen if we are not auto generating catchments
        base.logger.debug(
          `Not including sp of name ${sn.properties.name} for ${hf.properties.name}, can be normal if auto catchment recalc mode is off.  Otherwise its an error!`
        );
        continue;
      }

      if (!map.has(sn.properties.global_id)) {
        const settlement: CatchedSettlement = {
          settlementName: sn,
          settlementPart: sp,
          catchmentJson: [ci],
          inBoundary,
        };
        map.set(sn.properties.global_id, settlement);
      } else {
        const settlement = map.get(sn.properties.global_id)!;
        settlement.catchmentJson.push(ci);
      }
    }
  }
}

//hf can be fixed post or outreach
//Converts opening hours to boolean array starting at monday with true if open, false if not
export function operatingHoursToDays(hf: GeoJsonHealthFacility): boolean[] {
  const ret: boolean[] = [];
  for (let index = 0; index < 7; index++) {
    //any stop time not 00:00:00 considered open that day
    ret.push(hf.properties.operating_hours_stop[index] !== NOT_OPERATING_HOURS);
  }
  return ret;
}

//Apply day options from formgroup to hf (fixed post or outreach)
//This returns a number between 0 and 7 for the number of days open in the week
export function applyDayOptions(
  hf: GeoJsonHealthFacility,
  daysOpen: boolean[]
): number {
  let totalDaysOpen = 0;
  hf.properties.operating_hours_start = [];
  hf.properties.operating_hours_stop = [];
  for (let index = 0; index < 7; index++) {
    //start is currently always the start of the day
    hf.properties.operating_hours_start.push(NOT_OPERATING_HOURS);

    let stop_time = NOT_OPERATING_HOURS;
    if (daysOpen[index]) {
      stop_time = OPERATING_HOURS;
      totalDaysOpen += 1;
    }
    hf.properties.operating_hours_stop.push(stop_time);
  }

  return totalDaysOpen;
}

export function getWeeklyFrequencyValue(daysOpen: number): Frequency {
  let newFrequency: Frequency = 'oncePerMonth';

  switch (daysOpen) {
    case 1:
      newFrequency = 'oncePerWeek';
      break;
    case 2:
      newFrequency = 'twicePerWeek';
      break;
    case 3:
      newFrequency = 'threePerWeek';
      break;
    case 4:
      newFrequency = 'fourPerWeek';
      break;
    case 5:
      newFrequency = 'fivePerWeek';
      break;
    case 6:
      newFrequency = 'sixPerWeek';
      break;
    case 7:
      newFrequency = 'daily';
      break;
  }

  return newFrequency;
}
