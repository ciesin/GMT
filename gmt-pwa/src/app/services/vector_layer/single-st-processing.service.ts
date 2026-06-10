import { Injectable, OnDestroy } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { LocationControlOutput } from '@components/wizard/wizard-location-control/wizard-location-control.component';
import {
  manuallyPopulateSettlementPartFieldsIfNeeded,
  resetRasterSettlementPartFields,
} from '@services/geo/Rasterize';
import {
  MapEventsService,
  ZoomMode,
} from '@services/map/base/map-events.service';
import { UserActionLogService } from '@services/user-action-log.service';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { Coordinate } from 'ol/coordinate';
import { getCenter } from 'ol/extent';
import { take } from 'rxjs';
import { DEFAULT_WIZARD_DIALOG_OPTIONS } from 'src/app/components/wizard/health-facility-wizard/health-facility-wizard.component';
import { callBlockingUiUntilDone } from 'src/app/components/wizard/wizard-location-control/helper-methods';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { ExcludeDialogResult } from 'src/app/routine-immu/hf-details/hf-settlement/exclude-dialog.component';
import { LocationEditWizardComponent } from 'src/app/routine-immu/location-edit-wizard/location-edit-wizard.component';
import { UninhabitedPopupDialogData } from 'src/app/routine-immu/st-details/st-details-content/uninhabited-popup/uninhabited-popup.component';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { getExtentedBoundingBoxForFeatures } from 'src/app/utils/coords';
import {
  FIXED_HEALTH_FACILITY_TYPE,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
  OUTREACH_HEALTH_FACILITY_TYPE,
  Position,
  UninhabitedOption,
  UNKNOW_UNINHABITED_OPTION,
} from 'src/app/utils/server-interfaces/GeoJson';
import {
  geometryIntersects,
  isEmpty,
} from 'src/app/utils/server-interfaces/utils/geom.util';
import { getNumberOrDefault } from 'src/app/utils/server-interfaces/utils/string.util';
import {
  ST_GEOMETRY_LAYER,
  ST_NAME_LAYER,
} from 'src/app/utils/server-interfaces/VectorLayerName';
import {
  INVALID_COORD,
  isNullOrWhitespace,
} from 'src/app/utils/string-formatting';
import { v4 as uuidv4 } from 'uuid';
import {
  getSpComputedPop,
  NON_ZERO_POP,
} from '../../utils/server-interfaces/utils/indicator.util';

export interface CoverageSett {
  global_id: string;
  pop: number;
  fixedPost: number;
  outreach: number;
  unclaimed: number;
  percFixedPost: number;
  percOutreach: number;
  percUnclaimed: number;
  problematic: string[];
}

/**
 * Reusable service for editing st without initializing it from the url
 */
@Injectable({
  providedIn: 'root',
})
export class SingleStProcessingService implements OnDestroy {
  private estimatedPopClearTimeout: ReturnType<typeof setTimeout> | null = null;
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
    private router: Router,
    private userActionLogService: UserActionLogService
  ) {}

  ngOnDestroy() {
    // Clean stuff
  }

  public async nameChange(
    settlementName: GeoJsonSettlementName,
    newName: string
  ): Promise<void> {
    // event is triggered first time when data is retrieved. That is why we need this check
    if (
      isNullOrWhitespace(newName) ||
      settlementName?.properties?.name == newName
    ) {
      return;
    }
    //Cancel the delayed search if there is one
    if (this.renameClearTimeout) {
      clearTimeout(this.renameClearTimeout);
    }
    //Wait a second before executing
    this.renameClearTimeout = setTimeout(async () => {
      return await this.updateName(settlementName, newName);
    }, 1000);
  }

  public async commentsChange(
    settlementName: GeoJsonSettlementName,
    newComments: string
  ): Promise<void> {
    // event is triggered first time when data is retrieved. That is why we need this check
    // Prevents a update loop too
    if (settlementName?.properties?.comments == newComments) {
      return;
    }
    //Cancel the delayed search if there is one
    if (this.commentsClearTimeout) {
      clearTimeout(this.commentsClearTimeout);
    }
    //Wait a second before executing
    this.commentsClearTimeout = setTimeout(async () => {
      settlementName.properties.comments = newComments;
      await this.crudLayerService.updateItem(
        'settlement__name',
        settlementName,
        true
      );
    }, 1000);
  }

  public handleShowSettlementSiteOnMap(settlementName: GeoJsonSettlementName) {
    if (isEmpty(settlementName)) {
      return;
    }
    this.microplanMapEvents.triggerSettlementHighlightEvent(
      settlementName.properties.global_id
    );
    // this.mapEvents.panToExtent({
    //   movementType: "Pan",
    //   extent: getExtentedBoundingBoxForFeatures(1000, settlementName),
    //   zoomMode: ZoomMode.ZOOM_IN_MAX
    // });
    this.mapEvents.triggerDetailsPopupChange(
      ST_NAME_LAYER,
      settlementName.properties.global_id
    );
    this.mapEvents.center({
      movementType: 'Center',
      center: getCenter(
        getExtentedBoundingBoxForFeatures(1, settlementName)
      ) as Position,
    });
  }

  public async redirectToDetails(settlementName: GeoJsonSettlementName) {
    await this.router.navigate(
      [
        RoutesChunks.ROUTINE_IMMUNIZATION,
        settlementName.properties.boundary_polygon,
        RoutesChunks.SETTLEMENTS,
        settlementName.properties.global_id,
        RoutesChunks.EDIT,
      ],
      {
        queryParamsHandling: 'preserve',
      }
    );
  }
  public onOpenPanelAction(
    panelOpenState: boolean,
    settlementName: GeoJsonSettlementName
  ) {
    if (panelOpenState) {
      this.microplanMapEvents.triggerSettlementHighlightEvent(
        settlementName.properties.global_id
      );
      this.mapEvents.emitClicked({
        coordinates: [] as Coordinate,
        selectedLayer: ST_NAME_LAYER,
        selectedGlobalId: settlementName.properties.global_id,
      });
      this.mapEvents.panToExtent({
        movementType: 'Pan',
        extent: getExtentedBoundingBoxForFeatures(2000, settlementName),
        zoomMode: ZoomMode.DONT_CHANGE,
      });
    } else {
      this.microplanMapEvents.triggerSettlementHighlightEvent(null);
    }
  }
  private async updateName(
    settlementName: GeoJsonSettlementName,
    newName: string
  ) {
    settlementName.properties.name = newName;

    this.userActionLogService.addUserActionDescription(
      `Renamed [${settlementName.properties.global_id}] from [${settlementName.properties.name}] to [{${newName}}]`
    );

    await this.crudLayerService.updateItem(
      'settlement__name',
      settlementName,
      true
    );
    return true;
    // this.removeItem.emit()
  }

  /**
   * Trigger estimated pop change and related actions
   * Pass stName as a parameter in case user changes the page quickly before
   * estimatedPopClearTimeout ends
   * p.s. passing st name and part manually to not be dependent on the initialization
   * in case the data was changed
   * @param stName
   * @param settlementPart
   * @param newPop
   */
  public async handleEstimatedPopChange(
    stName: GeoJsonSettlementName,
    settlementPart: GeoJsonSettlementPart,
    newPop: number
  ) {
    const parsedNewPop = getNumberOrDefault(newPop, -1);
    if (stName?.properties?.estimated_pop == parsedNewPop) {
      return;
    }
    //Cancel the delayed search if there is one
    if (this.estimatedPopClearTimeout) {
      clearTimeout(this.estimatedPopClearTimeout);
    }
    return new Promise((resolve) => {
      this.estimatedPopClearTimeout = setTimeout(async () => {
        //Edit the json directly for speed and to not trigger any observables
        if (parsedNewPop < 0) {
          this.logger.warn(
            `Ignoring population entry ${newPop} => ${parsedNewPop}`
          );
          resolve(false);
          return;
        }
        this.logger.info(
          `handleChangeEstimatedPopulation ${newPop} => ${parsedNewPop}`
        );
        const actionId = uuidv4();
        await this.estimatedPopChange(stName, parsedNewPop, actionId);

        //Note we handle in the ui layer if pop is 0, but we can handle automatically
        //if pop > 0

        const impliedUninhabitedStatus = parsedNewPop <= 0;
        if (stName.properties.uninhabited && !impliedUninhabitedStatus) {
          await this.uninhabitedChange(
            stName,
            settlementPart,
            {
              uninhabited: false,
              uninhabited_other_detail: null,
              uninhabited_reason: null,
            },
            actionId
          );
        }
        //await this.changeEstimatedPopulation(newValue ? 0 : 1, actionId);
        resolve(true);
      }, 1000);
    });
  }

  /**
   * Actual geojson field change
   * @param stName
   * @param value
   * @param actionId
   */
  public async estimatedPopChange(
    stName: GeoJsonSettlementName,
    value: number | null = null,
    actionId: string | null = null
  ) {
    if (!stName) {
      this.logger.warn('estimatedPopChange stName missing');
      return;
    }

    let estimatedPop = value;
    if (estimatedPop != stName.properties.estimated_pop) {
      stName.properties.estimated_pop = estimatedPop;
      await this.crudLayerService.updateItem(
        'settlement__name',
        stName,
        true,
        true,
        actionId
      );
    }
  }

  public async uninhabitedChange(
    stName: GeoJsonSettlementName,
    settlementPart: GeoJsonSettlementPart,
    uninhabitedProps: UninhabitedPopupDialogData,
    actionId: string | null = null
  ) {
    if (
      //If nothing changed, do nothing
      //Needed to prevent loops from save => ui update => save => ...
      uninhabitedProps.uninhabited == stName.properties.uninhabited &&
      uninhabitedProps.uninhabited_other_detail ==
        stName.properties.uninhabited_other_detail &&
      uninhabitedProps.uninhabited_reason ==
        stName.properties.uninhabited_reason
    ) {
      return;
    }

    const inhabitedToUnihabited =
      stName.properties.uninhabited !== true && uninhabitedProps.uninhabited;

    if (
      uninhabitedProps.uninhabited &&
      this.settlementHasMultiplePrimaryNames(settlementPart)
    ) {
      //As this returns it is not actually creating a crud item; but a settlement should no longer have
      //multiple primary names so this code likely never gets run
      stName.properties.uninhabited = false;
      this.messageService.add({
        summary:
          "It is not allowed to mark settlement as uninhabited when settlement has multiple primary names. Please use 'demote' to leave only 1 primary settlement name.",
        severity: 'error',
        key: 'small',
        life: 10000,
      });
      return;
    }
    await callBlockingUiUntilDone(
      this,
      async () => {
        stName.properties.uninhabited = uninhabitedProps.uninhabited;

        if (uninhabitedProps.uninhabited) {
          stName.properties.uninhabited_reason =
            uninhabitedProps.uninhabited_reason;
          stName.properties.uninhabited_other_detail =
            uninhabitedProps.uninhabited_other_detail;

          // For now, the progress page is not updated
          //deduct from boundary numbers
          // boundaryIndicators.properties.boundary_pop -= coverageSett.pop;
          // boundaryIndicators.properties.catchment_pop_fp -= coverageSett.fixedPost;
          // boundaryIndicators.properties.catchment_pop_outreach -= coverageSett.outreach;
          // if (coverageSett.problematic.length > 0) {
          //   //either 100% of the settlement part pop is problematic or 0%
          //   boundaryIndicators.properties.catchment_pop_problematic -= coverageSett.pop;
          // }
        } else {
          stName.properties.uninhabited_reason = null;
          stName.properties.uninhabited_other_detail = null;

          // For now, the progress page is not updated
          //Add again to boundary numbers
          // boundaryIndicators.properties.boundary_pop += coverageSett.pop;
          // boundaryIndicators.properties.catchment_pop_fp += coverageSett.fixedPost;
          // boundaryIndicators.properties.catchment_pop_outreach += coverageSett.outreach;
          // if (coverageSett.problematic.length > 0) {
          //   //either 100% of the settlement part pop is problematic or 0%
          //   boundaryIndicators.properties.catchment_pop_problematic += coverageSett.pop;
          // }

          //A special case, if the settlement is inhabited (not uninhabited) we don't want
          //the est. pop to be 0 because 0 is treated as if the user explicitly set it
          if (
            !_.isFinite(stName.properties.estimated_pop) ||
            stName.properties.estimated_pop! <= 0
          ) {
            this.logger.info(
              `Setting estimated pop to null for ${stName.properties.name} during setting uninhabited=false`
            );
            stName.properties.estimated_pop = null;
          }
        }
        if (actionId === null) {
          actionId = uuidv4();
        }

        await this.crudLayerService.updateItem(
          'settlement__name',
          stName,
          true,
          true,
          actionId
        );

        if (
          !uninhabitedProps &&
          (!_.isFinite(settlementPart.properties.computed_pop) ||
            settlementPart.properties.computed_pop! <= 0)
        ) {
          //Recompute settlement part pop if its 0 since the server will set computed pop to 0 if uninhabited is flagged
          this.logger.info(
            'Recompute 0 settlement part computed_pop because uninhabited==false and computed_pop not >0'
          );
          resetRasterSettlementPartFields(settlementPart);
          manuallyPopulateSettlementPartFieldsIfNeeded(settlementPart);
          await this.bvService.updateSettlementPartPop(settlementPart);
          await this.crudLayerService.updateItem(
            'settlement__part',
            settlementPart,
            true,
            false,
            actionId
          );
        }

        if (inhabitedToUnihabited) {
          await this.bvService.computeCatchmentsForRemovedSp(
            settlementPart,
            actionId
          );
        } else {
          await this.bvService.computeAllCatchmentAssignments(
            [settlementPart],
            actionId,
            new Set()
          );
        }

        //only do this if the pop changed
        // For now, the progress page is not updated
        // if (boundaryIndicators.properties.boundary_pop != boundaryIndicatorsOrig.properties.boundary_pop) {
        //   await this.boundaryLayerService.updateBoundaryById(stName.properties.boundary_polygon, boundaryIndicators);
        // }

        //We want to retrigger the catchment calculation in the breadcrumb component
        //so that getLowestAdminCatchmentInfo is called
        //Note however that in the boundary selection aka progress page
        //in gmt-boundary-indicators component, this will only show synced changes
        /*this.crudLayerService.suppressUserInterfaceUpdates.next(false);

      //This is because the raster squares will change if they belong to an uninhabited settlement or not
      await this.redrawCatchment(
        stName,
        settlementPart,
        uninhabitedProps.uninhabited,
        actionId
      );*/

        return true;
      },
      true
    );
  }

  //This is used for the settlement details
  //when a HF is involved calculateCatchment is used
  //These 2 methods could probably be combined
  public calculateSettCatchmentInfo(
    settlementPart: GeoJsonSettlementPart,
    settlementName: GeoJsonSettlementName,
    adjustForUninhabited: boolean
  ) {
    const catchments = this.bvService.data.getCatchmentForSp(
      settlementPart.properties.global_id,
      true,
      true
    );

    let outreachTotal = 0;
    let fixedPostTotal = 0;
    //Make pop never 0 since we are dividing by it later, see percFixedPost
    const pop = getSpComputedPop(settlementPart, NON_ZERO_POP);

    for (const riCatchmentItem of catchments) {
      const healthFacilityJson = this.bvService.data.hfMap.get(
        riCatchmentItem.properties.health_facility_point
      )!;

      let claimedPopulation =
        (riCatchmentItem.properties.population_perc * pop) / 100;

      if (healthFacilityJson.properties.type === FIXED_HEALTH_FACILITY_TYPE) {
        fixedPostTotal += claimedPopulation;
      }
      if (
        healthFacilityJson.properties.type === OUTREACH_HEALTH_FACILITY_TYPE
      ) {
        outreachTotal += claimedPopulation;
      }
    }

    const coverageSett: CoverageSett = {
      pop,
      global_id: settlementName.properties.global_id,
      percFixedPost: pop > 0 ? (100.0 * fixedPostTotal) / pop : 0,
      percOutreach: pop > 0 ? (100.0 * outreachTotal) / pop : 0,
      percUnclaimed:
        pop > 0 ? (100.0 * (pop - fixedPostTotal - outreachTotal)) / pop : 0,
      problematic: settlementName.properties.problematic,
      fixedPost: fixedPostTotal,
      outreach: outreachTotal,
      unclaimed: pop - fixedPostTotal - outreachTotal,
    };

    //This is taken care of when computing stats on the server, but to see the changes
    //of computed_pop == 0 when uninhabited, we have this block
    if (settlementName.properties.uninhabited && adjustForUninhabited) {
      coverageSett.percFixedPost = 0;
      coverageSett.percOutreach = 0;
      coverageSett.percUnclaimed = 0;
      coverageSett.unclaimed = 0;
      coverageSett.fixedPost = 0;
      coverageSett.outreach = 0;
      coverageSett.pop = 0;
    }

    //Note we deliberately do NOT change the computed pop, because if they toggle uninhabited back to false
    //we want that to still be there without needing to rollback a geojson action
    //If they sync, this will all be updated
    return coverageSett;
  }

  public async uninhabitedReasonChange(
    stName: GeoJsonSettlementName,
    newReason: UninhabitedOption
  ) {
    if (newReason == stName.properties.uninhabited_reason) {
      return;
    }
    stName.properties.uninhabited_reason =
      newReason === UNKNOW_UNINHABITED_OPTION ? null : newReason;
    // this.showUninhabitedFreeTextInput = newReason === OTHER_UNINHABITED_OPTIONS;
    await this.crudLayerService.updateItem('settlement__name', stName);
  }

  public async redrawCatchment(
    stName: GeoJsonSettlementName,
    settlementPart: GeoJsonSettlementPart,
    uninhabited: boolean,
    actionId: string,
    //If defined, will be used to pass to compute all catchments
    spListToUpdate: Array<GeoJsonSettlementPart> = []
  ) {
    if (settlementPart) {
      if (uninhabited) {
        await this.estimatedPopChange(stName, 0, actionId);
      }
      await this.bvService.computeAllCatchmentAssignments(
        spListToUpdate.length > 0 ? spListToUpdate : [settlementPart],
        actionId,
        new Set()
      );
      this.microplanMapEvents.triggerCatchmentRendering();
    } else {
      this.logger.error(
        `Cannot find settlement part in handleSetUninhabitedStatus for ${stName.properties.global_id}`
      );
    }
  }

  public enableLocationWizard(
    stName: GeoJsonSettlementName,
    settlementPart: GeoJsonSettlementPart
  ) {
    this.mapEvents.triggerLayerVisibilityChange(ST_GEOMETRY_LAYER, true);
    let data: LocationControlOutput = {
      lon: stName.geometry.coordinates[0],
      lat: stName.geometry.coordinates[1],
      set_with_gps: stName.properties.set_with_gps || false,
    };

    let dialogRef = this.dialog.open(LocationEditWizardComponent, {
      ...DEFAULT_WIZARD_DIALOG_OPTIONS,
      data,
    });

    //After take(1) this will stop listening to the observable

    dialogRef.componentInstance.location
      .pipe(take(1))
      .subscribe(async (location: LocationControlOutput) => {
        await this.handlePositionChange(stName, settlementPart, location);
      });
    //After take(1) this will stop listening to the observable
    dialogRef
      .afterClosed()
      .pipe(take(1))
      .subscribe(async (result: ExcludeDialogResult) => {
        this.mapEvents.triggerLayerVisibilityChange(ST_GEOMETRY_LAYER, false);
      });
  }

  public async markForReview(stName: GeoJsonSettlementName) {
    if (stName.properties.marked_for_review) {
      return;
    }
    stName.properties.marked_for_review = true;
    await this.crudLayerService.updateItem(
      'settlement__name',
      stName,
      true,
      true
    );
  }

  public calculateCatchment(
    settlementPart: GeoJsonSettlementPart,
    stName: GeoJsonSettlementName,
    hfId: string | null = null
  ) {
    // handle the case when creating outreach and splitting the same settlement that is open in the left panel
    if (!settlementPart) {
      return;
    }
    const catchments = this.bvService.data.getCatchmentForSp(
      settlementPart.properties.global_id,
      true,
      true
    );

    let outreachTotal = 0;
    let fixedPostTotal = 0;
    const pop = settlementPart.properties.computed_pop!;
    let hfCoverageFixedPost = 0;
    let hfCoverageOutreach = 0;
    for (const riCatchmentItem of catchments) {
      const healthFacilityJson = this.bvService.data.hfMap.get(
        riCatchmentItem.properties.health_facility_point
      )!;
      let claimedPopulation =
        (riCatchmentItem.properties.population_perc * pop) / 100;

      if (healthFacilityJson.properties.type === FIXED_HEALTH_FACILITY_TYPE) {
        fixedPostTotal += claimedPopulation;
        if (hfId && riCatchmentItem.properties.health_facility_point == hfId) {
          hfCoverageFixedPost += riCatchmentItem.properties.population_perc;
        }
      }
      if (
        healthFacilityJson.properties.type === OUTREACH_HEALTH_FACILITY_TYPE
      ) {
        outreachTotal += claimedPopulation;
        if (hfId && healthFacilityJson.properties.parent == hfId) {
          hfCoverageOutreach += riCatchmentItem.properties.population_perc;
        }
      }
    }

    const fullCoverageSett = {
      pop,
      global_id: stName.properties.global_id,
      percFixedPost: pop > 0 ? (100.0 * fixedPostTotal) / pop : 0,
      percOutreach: pop > 0 ? (100.0 * outreachTotal) / pop : 0,
      percUnclaimed:
        pop > 0 ? (100.0 * (pop - fixedPostTotal - outreachTotal)) / pop : 0,
      problematic: stName.properties.problematic,
      fixedPost: fixedPostTotal,
      outreach: outreachTotal,
      unclaimed: pop - fixedPostTotal - outreachTotal,
    };
    return {
      catchment: fullCoverageSett,
      hfCoverageFixedPost: hfCoverageFixedPost,
      hfCoverageOutreach: hfCoverageOutreach,
    };
  }
  private async handlePositionChange(
    stName: GeoJsonSettlementName,
    settlementPart: GeoJsonSettlementPart,
    location: LocationControlOutput
  ) {
    const lon = getNumberOrDefault(location.lon, INVALID_COORD);
    const lat = getNumberOrDefault(location.lat, INVALID_COORD);

    if (lon == INVALID_COORD || lat == INVALID_COORD) {
      this.logger.error('Invalid coords ', lon, lat);
      return;
    }
    if (settlementPart) {
      const intersects = geometryIntersects(settlementPart, {
        type: 'Point',
        coordinates: [lon, lat],
      });
      if (!intersects) {
        this.logger.info('Set. name does not intersect part');
        this.messageService.add({
          summary:
            'Impossible to move the name point outside the boundary of the settlement.',
          severity: 'error',
          life: 10000,
        });
        return;
      }
    } else {
      this.logger.error('No settlement part in handle position change');
    }
    this.isLoadingService.setLoading(true);
    stName.geometry.coordinates = [lon, lat];
    stName.properties.set_with_gps = location.set_with_gps;
    const actionId = uuidv4();
    this.crudLayerService.suppressUserInterfaceUpdates.next(true);
    await this.crudLayerService.updateItem(
      'settlement__name',
      stName,
      true,
      true,
      actionId
    );
    this.crudLayerService.suppressUserInterfaceUpdates.next(false);
    this.isLoadingService.setLoading(false);
  }

  private settlementHasMultiplePrimaryNames(
    settlementPart: GeoJsonSettlementPart
  ): boolean {
    if (settlementPart) {
      const allSubNames =
        this.bvService.data.spToSnMap.get(
          settlementPart.properties.global_id
        ) || [];
      const primaryNames = allSubNames.filter((sn) => sn.properties.is_primary);
      return primaryNames.length > 1;
    }
    return false;
  }
}
