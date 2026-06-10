import { Component, Inject, Injector, OnInit, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatAccordion, MatExpansionPanel } from '@angular/material/expansion';
import { Router } from '@angular/router';
import { faUsers } from '@fortawesome/free-solid-svg-icons';
import { MapEventsService } from '@services/map/base/map-events.service';
import {
  getSortedDisplayName,
  SortStateService,
} from '@services/shared/notifications/sortState';
import { UserActionLogService } from '@services/user-action-log.service';
import {
  CoverageSett,
  SingleStProcessingService,
} from '@services/vector_layer/single-st-processing.service';
import _ from 'lodash';
import cloneDeep from 'lodash/cloneDeep';
import { NGXLogger } from 'ngx-logger';
import { filter, ReplaySubject, Subject, take, takeUntil } from 'rxjs';
import {
  ACCORDION_TOKEN,
  ID_TOKEN,
} from 'src/app/components/microplan-view/microplan-list/microplan-list.component';
import { DEFAULT_WIZARD_DIALOG_OPTIONS } from 'src/app/components/wizard/health-facility-wizard/health-facility-wizard.component';
import { callBlockingUiUntilDone } from 'src/app/components/wizard/wizard-location-control/helper-methods';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { ConfirmationService } from 'src/app/services/shared/notifications/confirmation.service';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { RIRouteService } from 'src/app/services/shared/route/ri-route.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { SingleHfService } from 'src/app/services/vector_layer/single-hf.service';
import {
  GeoJsonCatchmentItem,
  GeoJsonHealthFacility,
  GeoJsonSettlementName,
} from 'src/app/utils/server-interfaces/GeoJson';
import {
  formatDistance,
  formatPercentage,
  formatPopulation,
} from 'src/app/utils/string-formatting';
import { v4 as uuidv4 } from 'uuid';
import { ExcludeDialog, ExcludeDialogResult } from './exclude-dialog.component';

@Component({
  selector: 'hf-settlement-content',
  templateUrl: './hf-settlement-content.component.html',
  styleUrls: [
    '../../../components/catchment-card/card.less',
    './hf-settlement-content.component.less',
  ],
  standalone: false,
})
export class HfSettlementContentComponent implements OnInit {
  public snId: string; // injected as input this.injector.get(ID_TOKEN);
  public hfId: string;
  public currentBoundaryId: string | null = null;
  public stBoundaryName: string | null = null;
  public settlement!: GeoJsonSettlementName;
  public problematic = null;
  public settlementIcon = faUsers;
  public hfCoverageFixedPost: number = 0;
  public hfCoverageOutreach: number = 0;
  public fullCoverageSett: CoverageSett;

  public editing: boolean = false;
  public panelOpenState: boolean = false;
  public userHasPermissionsCreateHf: boolean = false;
  public controlsEnabled: boolean = false;

  public displayName: string;

  private unsubscribe = new Subject();

  constructor(
    private bvService: BoundaryVectorLayersService,
    private confirmationService: ConfirmationService,
    private messageService: MessageService,
    public crudLayerService: CrudLayerService,
    private injector: Injector,
    public isLoadingService: IsLoadingService,
    private logger: NGXLogger,
    private mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,
    private riRouterService: RIRouteService,
    private router: Router,
    private singleHfService: SingleHfService,
    private userContextService: UserContextService,
    private dialog: MatDialog,
    private userActionLogService: UserActionLogService,
    private singleStProcessingService: SingleStProcessingService,
    private sortStateService: SortStateService,
    @Inject(ACCORDION_TOKEN) public accordion$: ReplaySubject<MatAccordion>
  ) {}

  //This + the accordion token is what makes only one child to be expanded at any particular time
  @ViewChild(MatExpansionPanel)
  set matExpansionPanel(panel: MatExpansionPanel) {
    // hook the panel expansion to the accordion when ready
    if (!panel) {
      return;
    }
    this.accordion$
      .pipe(filter(Boolean), take(1))
      .subscribe((accordion) => (panel.accordion = accordion));
  }

  ngOnInit() {
    this.snId = this.injector.get(ID_TOKEN);
    if (this.snId) {
      this.settlement = this.bvService.data.snMap.get(this.snId)!;
      //do after settlement is initialized
      this.listenToSort();
      this.currentBoundaryId = this.riRouterService.getBoundaryIdValue();
    }
    this.singleHfService.hf
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async (hf: GeoJsonHealthFacility | null) => {
        if (!hf) {
          return;
        }
        this.hfId = hf.properties.global_id;
        this.userHasPermissionsCreateHf =
          this.singleHfService.userHasPermissionsCreateHf;
        this.controlsEnabled = this.singleHfService.userHasPermissionsUpdateHf;

        this.stBoundaryName =
          this.bvService.boundaryInfo.surroundingBoundaryList.find(
            (b) =>
              b.properties.global_id ==
              this.settlement.properties.boundary_polygon
          )?.properties.name!;
        this.loadSettlement();
      });

    this.subscribeToEditMode();
  }

  private subscribeToEditMode() {
    this.userContextService
      .getIsEditingObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((isEditing) => {
        this.editing = isEditing;
        this.controlsEnabled =
          this.singleHfService.userHasPermissionsUpdateHf && isEditing;
      });
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  handleShowSettlementSiteOnMap(event: MouseEvent) {
    event.stopPropagation();
    this.singleStProcessingService.handleShowSettlementSiteOnMap(
      this.settlement
    );
  }

  public async excludeSettlement() {
    this.userActionLogService.addUserActionDescription(
      `excludeSettlement clicked on ${this.settlement.properties.name} with id ${this.snId}`
    );

    if (this.isLoadingService.isLoading()) {
      this.logger.warn(`Loading is enabled, so not excluding again`);
      return;
    }

    callBlockingUiUntilDone(this, async () => {
      const actionId = uuidv4();

      const includedSettlement =
        this.singleHfService.includedSettlementsMap.get(this.snId);
      if (!includedSettlement) {
        this.logger.error(`Cannot find excluded settlement [${this.snId}]`);
        return false;
      }

      //https://github.com/novelt/GMT/issues/2819
      //Any settlement that has been explicitly included should not allow exclusion
      const sp = includedSettlement.settlementPart;
      const explicitIncludes = this.bvService.data
        .getCatchmentForSp(sp.properties.global_id, true, false)
        .filter((ci) => ci.properties.type == 'include');
      if (explicitIncludes.length > 0) {
        //Find the health facility names
        const hfIds = new Set<string>(
          explicitIncludes.map((ei) => ei.properties.health_facility_point)
        );
        const hfIdsList = Array.from(hfIds);
        const hfNames = hfIdsList.map((hfId) => {
          const hf = this.bvService.data.hfMap.get(hfId);
          if (!hf) {
            this.logger.warn(`Hf not found for ${hfId}`);
            return 'Unknown Name';
          }
          return hf.properties.name;
        });
        const nameJoined = hfNames.join(', ');

        this.messageService.add({
          summary: `Cannot exclude settlement "${includedSettlement.settlementName.properties.name}": This settlement is part of an explicit catchment of ${nameJoined}.  Excluding would have no affect.`,
          severity: 'warning',
        });
        return false;
      }

      this.logger.debug(
        `excludeSettlement includedSettlement`,
        includedSettlement
      );
      //Do we have fp and outreach exclusions?
      const hasFp = includedSettlement.catchmentJson.some((ci) => {
        const hf = this.bvService.data.hfMap.get(
          ci.properties.health_facility_point
        )!;
        return hf.properties.type == 'fixed_post';
      });
      const hasOutreach = includedSettlement.catchmentJson.some((ci) => {
        const hf = this.bvService.data.hfMap.get(
          ci.properties.health_facility_point
        )!;
        return hf.properties.type == 'outreach';
      });
      //this.logger.debug(`eeee Excluding fp ${hasFp} outreach ${hasOutreach} catchments for set + hf family ${includedSettlement.catchmentJson.length}`);

      //If both a fixed post and an outreach we need to ask the user which one
      if (hasFp && hasOutreach) {
        const dialogRef = this.dialog.open(ExcludeDialog, {
          ...DEFAULT_WIZARD_DIALOG_OPTIONS,
        });

        //Note that using takeUntil causes this not to respond.  So this component may get destroyed while this is still being processed
        dialogRef
          .afterClosed()
          .pipe(take(1))
          .subscribe(async (result: ExcludeDialogResult) => {
            //this.logger.debug(`eee result`, result);
            await this.handleExcludeDialog(result);
          });
        return false;
      }
      //In this case we can just do it right away with no dialog
      for (const c of includedSettlement.catchmentJson) {
        await this.excludeSettlementConfirmed(c, actionId);
      }
      return true;
    });
  }

  public async handleExcludeDialog(choice: ExcludeDialogResult) {
    //1 fixed post only
    //2 outreaches only
    //3 both
    callBlockingUiUntilDone(this, async () => {
      const actionId = uuidv4();

      const includedSettlement =
        this.singleHfService.includedSettlementsMap.get(this.snId);
      if (!includedSettlement) {
        this.logger.error(`Cannot find excluded settlement [${this.snId}]`);
        return false;
      }

      this.logger.debug(
        `calling handleExcludeDialog ${includedSettlement.catchmentJson.length}`
      );
      for (const ci of includedSettlement.catchmentJson) {
        const hf = this.bvService.data.hfMap.get(
          ci.properties.health_facility_point
        )!;
        if (hf.properties.type == 'fixed_post' && choice == 'outreach_only') {
          continue;
        }
        if (hf.properties.type == 'outreach' && choice == 'fp_only') {
          continue;
        }
        this.logger.debug(`calling excludeSettlementConfirmed`, ci, hf);
        await this.excludeSettlementConfirmed(ci, actionId);
      }
      return true;
    });
  }

  public async redirectToDetails() {
    await this.router.navigate(
      [
        RoutesChunks.ROUTINE_IMMUNIZATION,
        //Note the settlement boundary could be different
        this.settlement.properties.boundary_polygon,
        RoutesChunks.SETTLEMENTS,
        this.settlement.properties.global_id,
        RoutesChunks.EDIT,
      ],
      {
        queryParamsHandling: 'preserve',
      }
    );
  }

  public onOpenPanelAction() {
    this.singleStProcessingService.onOpenPanelAction(
      this.panelOpenState,
      this.settlement
    );
  }

  private loadSettlement() {
    //const rand = (max: number) => Math.floor(Math.random() * max);
    //Find the associated settlement part
    const settlementPart = this.bvService.data.spMap.get(
      this.settlement.properties.settlement_part!
    )!;
    if (!settlementPart) {
      return;
    }
    const catchmentObj = this.singleStProcessingService.calculateCatchment(
      settlementPart,
      this.settlement,
      this.hfId
    )!;
    this.hfCoverageFixedPost = catchmentObj.hfCoverageFixedPost;
    this.hfCoverageOutreach = catchmentObj.hfCoverageOutreach;
    this.fullCoverageSett = catchmentObj.catchment;
  }

  private async excludeSettlementConfirmed(
    settlementCatchmentJson: GeoJsonCatchmentItem,
    actionId: string
  ) {
    if (!settlementCatchmentJson) {
      return;
    }
    if (settlementCatchmentJson.properties.type == 'exclude') {
      this.logger.warn(
        'excludeSettlement, settlement already excluded',
        settlementCatchmentJson
      );
      return;
    }

    const includeExcludeHf = this.bvService.data.hfMap.get(
      settlementCatchmentJson.properties.health_facility_point
    )!;

    const sp = this.bvService.data.spMap.get(
      settlementCatchmentJson.properties.settlement_part
    )!;
    const snDebug = this.bvService.data.spToSnMap.get(sp.properties.global_id)!;
    this.logger.debug(
      `excludeSettlementConfirmed create exclude entry with HF ${includeExcludeHf.properties.name} and settlement name ${snDebug[0]?.properties.name}`,
      sp
    );

    if (settlementCatchmentJson.properties.type == 'generated') {
      const excludeEntry = cloneDeep(settlementCatchmentJson);
      excludeEntry.properties.type = 'exclude';
      excludeEntry.properties.population_perc = 0;
      excludeEntry.properties.global_id = uuidv4();
      //Because it's an exclude = true, it's the HF polygon
      //Remember, an exclude=true entry is 'owned' by the HF and an exclude=False is owned by the settlement part
      excludeEntry.properties.boundary_polygon =
        includeExcludeHf.properties.boundary_polygon;

      this.crudLayerService.suppressUserInterfaceUpdates.next(true);
      await this.crudLayerService.createItem(
        'ri__catchment_item',
        excludeEntry,
        true,
        false,
        actionId
      );
    } else if (settlementCatchmentJson.properties.type == 'include') {
      //Explicit includes are the urban slum case, which cannot be edited
      this.messageService.add({
        summary: 'Cannot Exclude',
        detail: `This settlement has been explicitly included by Health Facility ${includeExcludeHf.properties.name}.  To exclude this, you must remove that outreach site`,
        severity: 'warning',
      });
      return;
      //here we just need to remove the inclusion
      //await this.crudLayerService.deleteItem("ri__catchment_item", settlementCatchmentJson.properties.global_id, true, false, actionId);
    }
    //Get the HF that is involved in the exclusion

    //Extending spList results in way too many sps
    await this.bvService.computeAllCatchmentAssignments(
      [sp],
      actionId,
      new Set()
    );

    //This is called by callBlockingUiUntilDone
    //To redraw the catchment polygons which may have changed
    //this.microplanMapEvents.triggerCatchmentRendering();
  }

  // handleShowSuggestedSettlementOnMap(suggestedSettlement: SuggestedSettlement) {
  //   this.logger.info("!!!handleShowSuggestedSettlementOnMap");
  //   if (isEmpty(suggestedSettlement.settlementName)) {
  //     return;
  //   }
  //   this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
  //   this.bvService.zoomHfSettlementName(this.hf, suggestedSettlement.settlementName);
  // }
  //
  // handleShowIncludedSettlementOnMap(includedSettlement: CatchedSettlement) {
  //   this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
  //   if (isEmpty(includedSettlement.json)) {
  //     return;
  //   }
  //   this.bvService.zoomHfSettlementName(includedSettlement.parent.json, includedSettlement.json);
  // }
  //
  // async handleAddIncludeSettlement(suggestedSettlement: SuggestedSettlement) {
  //
  //   this.isLoadingService.setLoading(true);
  //
  //   const actionId = uuidv4();
  //
  //   const includeEntry: GeoJsonCatchmentItem = {
  //     type: 'Feature',
  //     geometry: {
  //       type: "Point",
  //       coordinates: [0, 0]
  //     },
  //     properties: {
  //       global_id: uuidv4(),
  //       //Because it's an exclude = true, it's the HF polygon
  //       //Remember, a non generated entry is 'owned' by the HF and an exclude=False is owned by the settlement part
  //       boundary_polygon: this.hf.properties.boundary_polygon,
  //       health_facility_point: this.hf.properties.global_id,
  //       population_perc: 100.0,
  //       settlement_part: suggestedSettlement.settlementPart.properties.global_id,
  //       version_id: 0,
  //       type: 'include'
  //     }
  //   }
  //
  //   this.crudLayerService.suppressUserInterfaceUpdates.next(true);
  //   await this.crudLayerService.createItem("ri__catchment_item", includeEntry, true, false, actionId);
  //
  //   //Get the HF that is involved in the exclusion
  //   await this.bvService.computeAllCatchmentAssignmentsForHF(this.hf, actionId, true);
  //
  //   this.isLoadingService.setLoading(false);
  //   this.crudLayerService.suppressUserInterfaceUpdates.next(false);
  //   this.mapEvents.triggerCatchmentRendering();
  // }
  //
  //

  // handleShowClaimed(pan = false) {
  //   if (pan) {
  //     const fcList: Array<GeoJsonSettlementName | GeoJsonHealthFacility> = Object.values(this.includedSettlementsMap).map(s => s.json);
  //     fcList.push(...this.singleHfService.outreaches.map(outreach => outreach.json));
  //     fcList.push(this.hf);
  //     const bounding_box = getExtentedBoundingBoxForFeatures(1000,
  //       ...fcList);
  //
  //     //workaround since possible the data change is triggering a rezoom of the map
  //     this.mapEvents.panToExtent({
  //       movementType: "Pan",
  //       extent: bounding_box,
  //       zoomMode: ZoomMode.ZOOM_IN_MAX
  //     });
  //   }
  // }

  /**
   * Seed the travel time rasters
   * @private
   */
  // private async initTravelTimeRaster() {
  //
  //   if (!this.calculateTravelTime) {
  //     return;
  //   }
  //
  //   const boundaryId = this.hf.properties.boundary_polygon;
  //   const from3857 = toMercator((this.hf.geometry as Point).coordinates);
  //   const fromPointId = this.hf.properties.global_id;
  //   const to3857 = from3857;
  //
  //   await WORKER_CLIENT.travelTimeBetweenPoints({
  //     boundaryId,
  //     from3857,
  //     fromPointId,
  //     to3857,
  //     is_walking: true,
  //     logger: this.logger
  //   });
  //
  //   await WORKER_CLIENT.travelTimeBetweenPoints({
  //     boundaryId,
  //     from3857,
  //     fromPointId,
  //     to3857,
  //     is_walking: false,
  //     logger: this.logger
  //   });
  // }

  // public formatDuration(timeInSeconds: number) {
  //   return formatDurationHm(timeInSeconds);
  // }

  public formatPopulation(pop: number | null) {
    return formatPopulation(pop);
  }

  public formatDistance(distance: number) {
    return formatDistance(distance, true);
  }

  public formatPercentage(perc: number) {
    return formatPercentage(perc, true);
  }

  private listenToSort() {
    this.displayName = this.settlement?.properties.name;

    this.sortStateService.stListInHfDetailsSort
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((sortState) => {
        this.displayName = getSortedDisplayName(sortState, this.settlement);
      });
  }

  public hasProblems(): boolean {
    if (_.isNil(this.fullCoverageSett)) {
      return false;
    }
    if (!_.isArray(this.fullCoverageSett.problematic)) {
      return false;
    }
    return this.fullCoverageSett.problematic.length > 0;
  }

  public getProblemStr(): string {
    const defaultStr = 'None';
    if (!this.hasProblems()) {
      return defaultStr;
    }
    return this.fullCoverageSett.problematic.toString();
  }
}
