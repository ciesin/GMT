import { Component, Input, OnInit } from '@angular/core';
import {
  MapEventsService,
  ZoomMode,
} from '@services/map/base/map-events.service';
import { UserActionLogService } from '@services/user-action-log.service';
import { NGXLogger } from 'ngx-logger';
import { Subject, takeUntil } from 'rxjs';
import { callBlockingUiUntilDone } from 'src/app/components/wizard/wizard-location-control/helper-methods';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { SingleHfService } from 'src/app/services/vector_layer/single-hf.service';
import { getExtentedBoundingBoxForFeatures } from 'src/app/utils/coords';
import {
  GeoJsonHealthFacility,
  GeoJsonSettlementName,
} from 'src/app/utils/server-interfaces/GeoJson';
import { isEmpty } from 'src/app/utils/server-interfaces/utils/geom.util';
import { v4 as uuidv4 } from 'uuid';
@Component({
  selector: 'hf-excluded-settlement-content',
  templateUrl: './hf-excluded-settlement-content.component.html',
  styleUrls: [
    '../../../_shared/components/accordion/accordion.component.less',
    '../../../components/catchment-card/card.less',
    '../../../components/catchment-card/card.less',
    './hf-excluded-settlement-content.component.less',
  ],
  standalone: false,
})
export class HfExcludedSettlementContentComponent implements OnInit {
  @Input() public snId: string;
  public hfId: string;
  public settlement!: GeoJsonSettlementName;
  public editing: boolean = false;

  public userHasPermissionsCreateHf: boolean = false;
  public userHasPermissionsUpdateHf: boolean = false;
  private unsubscribe = new Subject();

  constructor(
    private bvService: BoundaryVectorLayersService,
    public crudLayerService: CrudLayerService,

    public isLoadingService: IsLoadingService,
    private logger: NGXLogger,
    private mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,
    private singleHfService: SingleHfService,
    private userContextService: UserContextService,
    private userActionLogService: UserActionLogService
  ) {}

  ngOnInit() {
    if (this.snId) {
      this.settlement = this.bvService.data.snMap.get(this.snId)!;
      //this.currentBoundaryId = this.riRouterService.getBoundaryIdValue();
    }
    this.singleHfService.hf
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((hf: GeoJsonHealthFacility | null) => {
        if (!hf) {
          return;
        }
        this.hfId = hf.properties.global_id;
        this.userHasPermissionsCreateHf =
          this.singleHfService.userHasPermissionsCreateHf;
        this.userHasPermissionsUpdateHf =
          this.singleHfService.userHasPermissionsUpdateHf;
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
      });
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  handleShowSettlementSiteOnMap(event: MouseEvent) {
    event.stopPropagation();
    if (isEmpty(this.settlement)) {
      return;
    }
    this.microplanMapEvents.triggerSettlementHighlightEvent(
      this.settlement.properties.global_id
    );
    this.mapEvents.panToExtent({
      movementType: 'Pan',
      extent: getExtentedBoundingBoxForFeatures(1000, this.settlement),
      zoomMode: ZoomMode.ZOOM_IN_MAX,
    });
  }

  public async restoreExcludedSettlement() {
    const sInfo = this.singleHfService.excludedSettlementsMap.get(this.snId);

    this.userActionLogService.addUserActionDescription(
      `restoreExcludedSettlement calling on ${this.settlement.properties.name} with id ${this.snId}`
    );

    if (!sInfo) {
      this.logger.error('Unexpected, could not find exclude entry');
    }

    const actionId = uuidv4();

    await callBlockingUiUntilDone(this, async () => {
      for (const c of sInfo!.catchmentJson) {
        if (c.properties.type != 'exclude') {
          continue;
        }

        //Note we don't do this check because the catchment item could be pointing to the outreach owned by hfId
        /*if (c.properties.health_facility_point != this.hfId) {
          this.logger.warn(
            `Unexpected hf id in catchment item: ${c.properties.health_facility_point} != ${this.hfId}`
          );
          continue;
        }*/

        if (
          c.properties.settlement_part !=
          sInfo!.settlementPart.properties.global_id
        ) {
          this.logger.warn(
            `Unexpected sp id in catchment item: ${c.properties.health_facility_point} != ${this.hfId}`
          );
          continue;
        }

        this.logger.debug(
          `restoreExcludedSettlement Removing catchment item ${c.properties.global_id} ${c.properties.type}`
        );
        await this.crudLayerService.deleteItem(
          'ri__catchment_item',
          c.properties.global_id,
          true,
          true,
          actionId
        );

        const hf = this.bvService.data.hfMap.get(
          c.properties.health_facility_point
        )!;
        const sp = this.bvService.data.spMap.get(c.properties.settlement_part);
        if (sp) {
          this.logger.debug(
            `restoreExcludedSettlement computing catchments for ${hf.properties.name}`
          );
          //Extending the check results in a high # of sps being recalc'ed
          await this.bvService.computeAllCatchmentAssignments(
            [sp],
            actionId,
            new Set()
          );
        } else {
          this.logger.warn(
            `restoreExcludedSettlement unable to find sp [${c.properties.settlement_part}]`
          );
        }
      }

      this.userActionLogService.addUserActionDescription(
        `restoreExcludedSettlement finished`
      );
      return true;
    });
  }

  private loadSettlement() {
    const settlementPart = this.bvService.data.spMap.get(
      this.settlement.properties.settlement_part!
    )!;
    if (!settlementPart) {
      return;
    }
  }
}
