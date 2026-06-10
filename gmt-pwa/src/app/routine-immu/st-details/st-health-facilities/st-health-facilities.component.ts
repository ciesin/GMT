import { Component, OnInit, Type } from '@angular/core';
import { filter, Subject, switchMap, take, takeUntil } from 'rxjs';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { SingleStService } from 'src/app/services/vector_layer/single-st.service';
import {
  GeoJsonCatchmentItem,
  GeoJsonSettlementName,
} from 'src/app/utils/server-interfaces/GeoJson';

import { MatDialog } from '@angular/material/dialog';
import { Sort } from '@angular/material/sort';
import { DEFAULT_WIZARD_DIALOG_OPTIONS } from '@components/wizard/health-facility-wizard/health-facility-wizard.component';
import { callBlockingUiUntilDone } from '@components/wizard/wizard-location-control/helper-methods';
import { IsLoadingService } from '@services/is-loading.service';
import {
  EMPTY_SORT_STATE,
  SortStateService,
} from '@services/shared/notifications/sortState';
import { UserContextService } from '@services/user-context.service';
import { CrudLayerService } from '@services/vector_layer/crud-layer.service';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import {
  HF_FILTERS,
  HF_SORT_HEADERS,
} from 'src/app/components/microplan-view/health-facilities-view/health-facilities-view.component';
import { ChosenFilters } from 'src/app/components/microplan-view/microplan-filter/microplan-filter.component';
import { HfDetailsContentComponent } from 'src/app/routine-immu/st-details/st-health-facilities/hf-details/hf-details-content.component';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { SortingFilteringService } from 'src/app/services/shared/lists/sorting-filtering.service';
import { loadHealthFacility } from 'src/app/services/vector_layer/single-hf-processing.service';
import { v4 as uuidv4 } from 'uuid';
import {
  AssignmentOption,
  ExplicitAssignData,
  ExplicitAssignInput,
  ExplicitAssignPopupComponent,
} from './explicit-assign-popup/explicit-assign-popup.component';

@Component({
  selector: 'st-health-facilities',
  templateUrl: './st-health-facilities.component.html',
  styleUrls: ['./st-health-facilities.component.less'],
  standalone: false
})
export class StHealthFacilitiesComponent implements OnInit {
  public hfFilters = HF_FILTERS;
  private _sortHeaders = HF_SORT_HEADERS;
  public get sortHeaders() {
    return this._sortHeaders;
  }
  public set sortHeaders(value) {
    this._sortHeaders = value;
  }
  public sortFilterService: SortingFilteringService;
  public itemComponent: Type<any> = HfDetailsContentComponent;
  private firstFiltersChosen: boolean = false;
  private unsubscribe = new Subject();
  public snId = '';

  public userHasEditRights: boolean = false;
  private editing: boolean = false;

  public explicitAssignmentOptions: Array<AssignmentOption> = [];

  constructor(
    public microplanMapEvents: MicroplanMapEventsService,
    private singleStService: SingleStService,
    public bvService: BoundaryVectorLayersService,
    public logger: NGXLogger,
    private sortStateService: SortStateService,
    private dialog: MatDialog,
    public crudLayerService: CrudLayerService,
    public isLoadingService: IsLoadingService,
    private userContextService: UserContextService
  ) {}

  ngOnInit() {
    this.singleStService.stName
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((stName: GeoJsonSettlementName | null) => {
        if (!stName) {
          return;
        }

        this.loadSettlement(stName);
      });

    this.listenToBoundaryData();
    this.subscribeToEditMode();
  }

  private subscribeToEditMode() {
    this.userContextService
      .getIsEditingObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((isEditing) => {
        this.editing = isEditing;
        this.updateComponentPermissions();
      });
  }

  private updateComponentPermissions() {
    this.logger.debug(
      `settlement perms ${this.editing} ${this.singleStService.userHasPermissionsUpdateSettlement} ${this.bvService.isOffline}`
    );
    this.userHasEditRights =
      this.editing && this.singleStService.userHasPermissionsUpdateSettlement;
  }

  private loadSettlement(stName: GeoJsonSettlementName) {
    this.snId = stName.properties.global_id;

    this.logger.debug(
      `st health facilities recieved new name ${stName.properties.name}`,
      Array.from(this.singleStService.fixedPostEntries.values())
    );

    this.sortFilterService = new SortingFilteringService(
      Array.from(this.singleStService.fixedPostEntries.values()).map(
        (c) => c.fixedPostJson
      ),
      Array.from(this.singleStService.fixedPostEntries.keys()).map((hfId) => {
        return loadHealthFacility(
          { logger: this.logger, boundaryData: this.bvService.data },
          hfId
        )!;
      })
    );

    this.sortStateService.hfListInStDetailsSort.next(EMPTY_SORT_STATE);
  }

  private listenToBoundaryData() {
    let localSn: GeoJsonSettlementName | null = null;

    this.singleStService.stName
      .pipe(
        filter((st) => !_.isNil(st)),
        switchMap((sn) => {
          localSn = sn!;
          return this.bvService.ensureBoundaryLoaded(
            sn!.properties.boundary_polygon
          );
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe(() => {
        this.loadExplicitOptions(localSn!);
      });
  }

  private loadExplicitOptions(sn: GeoJsonSettlementName) {
    //We need all the wards outreach + fixed post that are not also explicitly assigned (either include/exclude)
    const existingIncludesExcludes = (
      this.bvService.data.spToCiMap.get(sn.properties.settlement_part!) || []
    )
      .filter((ci) => {
        return (
          ci.properties.settlement_part == sn.properties.settlement_part &&
          ci.properties.type != 'generated'
        );
      })
      .map((ci) => ci.properties.health_facility_point);

    this.logger.debug(
      `Existing include/exclude count [${existingIncludesExcludes.length}]`
    );

    const boundaryHfs = this.bvService.data.hfList.filter((hf) => {
      if (hf.properties.boundary_polygon != sn.properties.boundary_polygon) {
        return false;
      }

      if (existingIncludesExcludes.includes(hf.properties.global_id)) {
        return false;
      }
      return true;
    });
    this.explicitAssignmentOptions = boundaryHfs.map((hf) => {
      const is_outreach = hf.properties.type == 'outreach';
      let displayName = hf.properties.name;

      let outreachName: string | null = null;
      let fixedPostName: string = hf.properties.name;
      if (is_outreach) {
        const parent = this.bvService.data.hfMap.get(hf.properties.parent!);
        if (!_.isNil(parent) && _.isString(parent?.properties?.name)) {
          displayName =
            hf.properties.name + ` (attached to ${parent.properties.name})`;
          fixedPostName = parent.properties.name;
        } else {
          //should never happen....
          fixedPostName = '';
        }
        outreachName = displayName;
      }
      return {
        hfId: hf.properties.global_id,
        is_outreach,
        displayName,
        outreachName,
        fixedPostName,
      };
    });

    this.explicitAssignmentOptions.sort((a, b) => {
      const fpCompare = a.fixedPostName.localeCompare(b.fixedPostName);

      if (fpCompare != 0) {
        return fpCompare;
      }

      const outreachCompare = (a.outreachName || '').localeCompare(
        b.outreachName || ''
      );

      return outreachCompare;
    });
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  handleAddExplicitAssignment() {
    const sn = this.bvService.data.snMap.get(this.snId);

    if (_.isNil(sn)) {
      this.logger.error(`No sn for sn id [${this.snId}]`);
      return;
    }

    const dialogInput: ExplicitAssignInput = {
      options: this.explicitAssignmentOptions,
    };

    let dialogRef = this.dialog.open(ExplicitAssignPopupComponent, {
      ...DEFAULT_WIZARD_DIALOG_OPTIONS,
      data: dialogInput,
      hasBackdrop: true,
    });
    dialogRef
      .afterClosed()
      .pipe(take(1))
      .subscribe(async (explicitAssignData: ExplicitAssignData) => {
        //If they cancel, staffData will be nil
        if (
          !_.isNil(explicitAssignData) &&
          !_.isNil(explicitAssignData.option)
        ) {
          this.logger.info(
            `Create explicit assignment to [${explicitAssignData.option.displayName}]`
          );
          await this.createExplicitInclude(explicitAssignData.option);
          //create the explicit assignment
          //await this.createOrEditStaffMember(explicitAssignData);
        }
        dialogRef.close();
      });
  }

  private async createExplicitInclude(option: AssignmentOption) {
    const sn = this.bvService.data.snMap.get(this.snId);

    if (_.isNil(sn)) {
      this.logger.error(`Sn is nil!`);
      return;
    }

    const sp = this.bvService.data.spMap.get(sn.properties.settlement_part!);

    if (_.isNil(sp)) {
      this.logger.error(`sp is nil!`);
      return;
    }

    const catchmentItem: GeoJsonCatchmentItem = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [0, 0],
      },
      properties: {
        global_id: uuidv4(),
        boundary_polygon: sn.properties.boundary_polygon,
        health_facility_point: option.hfId,
        population_perc: 100.0,
        settlement_part: sp.properties.global_id,
        version_id: 0,
        type: 'include',
      },
    };

    await callBlockingUiUntilDone(this, async () => {
      const actionId = uuidv4();
      await this.crudLayerService.createItem(
        'ri__catchment_item',
        catchmentItem,
        true,
        false,
        actionId
      );

      await this.bvService.computeAllCatchmentAssignments(
        [sp],
        actionId,
        new Set()
      );

      return true;
    });
  }

  handleChosenFilters(chosenFilters: ChosenFilters) {
    const firstFiltersChosen = this.sortFilterService.chosenFilters == null;
    this.sortFilterService.setFilters(chosenFilters);
    this.sortStateService.hfListInStDetailsSort.next(chosenFilters);
    this.filterAndSort().then();
    if (this.firstFiltersChosen == false) {
      this.firstFiltersChosen = firstFiltersChosen;
    }
  }

  handleSearchText(search: string) {
    //this is as the user types
    this.sortFilterService.handleSearchText(search);
  }

  handleSort(sort: Sort) {
    this.sortFilterService.setSortOrder(sort);
    this.filterAndSort().then();
  }

  private async filterAndSort() {
    await this.sortFilterService.filterAndSort();
    // C. focus
    // it is easier to separate filtering and clearing filter stage
    if (
      !!this.sortFilterService.getSearchedText() &&
      this.sortFilterService.chosenFilters!.choices.size == 0
    ) {
      this.microplanMapEvents.triggerRemoveHfFocus();
    } else {
      if (!this.firstFiltersChosen) {
        this.microplanMapEvents.triggerFocusHf(
          this.sortFilterService.idDisplayList
        );
      }
    }
  }
}
