import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { MapEventsService } from '@services/map/base/map-events.service';
import { SingleStProcessingService } from '@services/vector_layer/single-st-processing.service';
import { Subject, takeUntil } from 'rxjs';
import { HfGeometryEditComponent } from 'src/app/routine-immu/microplan-gis/geometry-issues/hf-geometry-edit/hf-geometry-edit.component';
import { StGeometryEditComponent } from 'src/app/routine-immu/microplan-gis/geometry-issues/st-geometry-edit/st-geometry-edit.component';
import { ProblemsService } from 'src/app/services/attention/problems.service';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { SortingFilteringService } from 'src/app/services/shared/lists/sorting-filtering.service';
import { SettlementSortingFilteringService } from 'src/app/services/shared/lists/st-sorting-filtering.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { PermissionsLayerService } from 'src/app/services/vector_layer/permissions-layer.service';
import {
  ST_GEOMETRY_LAYER,
  VectorLayerForPermissions,
} from 'src/app/utils/server-interfaces/VectorLayerName';
import {
  HealthFacilityItem,
  SettlementIssueItem,
} from '../base-data-edit/base-data-edit.component';

export const geometryDataTab = 'geometryDataTab';

@Component({
  selector: 'geometry-issues',
  templateUrl: './geometry-issues.component.html',
  styleUrls: [
    '../../../components/catchment-card/card.less',
    './geometry-issues.component.less',
  ],
  standalone: false
})
export class GeometryIssuesComponent implements OnInit, OnDestroy {
  @Input() activeTab: string | null = null;
  @Output() tabIsOpen = new EventEmitter<boolean>();
  public geometryDataTab = geometryDataTab;
  public mainPanelOpenState: boolean = true;
  public panelOpenState: boolean = false;

  public userCanEditSt: boolean = false;
  public userCanEditHf: boolean = false;
  public editing: boolean = false;
  public settlementEditComponent = StGeometryEditComponent;
  public hfEditComponent = HfGeometryEditComponent;

  public stSortFilterService: SettlementSortingFilteringService;
  public hfSortFilterService: SortingFilteringService;
  public stIssues: Map<string, SettlementIssueItem>;
  public hfIssues: Map<string, HealthFacilityItem>;

  private userHasPermissionsUpdateSt: boolean = false;
  private userHasPermissionsUpdateHf: boolean = false;

  public listLength: number = 0;

  private unsubscribe = new Subject();

  constructor(
    private bvService: BoundaryVectorLayersService,
    private crudLayerService: CrudLayerService,
    private isLoadingService: IsLoadingService,
    private mapEvents: MapEventsService,
    private permissionsLayerService: PermissionsLayerService,
    private problemsService: ProblemsService,
    private userContextService: UserContextService,
    private singleStProcessingService: SingleStProcessingService
  ) {
    this.isLoadingService.setLoading(true);
  }

  ngOnInit() {
    this.isLoadingService.setLoading(true);
    this.subscribeToUndoRedo();
    this.permissionsLayerService
      .getPermissionsObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((_) => {
        this.setComponentPermissions();
      });
    this.subscribeToEditMode();
    this.bvService
      .loadedObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((_) => {
        this.initializeProblemLists();
      });
    this.isLoadingService.setLoading(false);
  }

  ngOnDestroy(): void {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  public panelStateChange() {
    this.tabIsOpen.emit(this.mainPanelOpenState);
    this.mapEvents.triggerLayerVisibilityChange(
      ST_GEOMETRY_LAYER,
      this.mainPanelOpenState
    );
  }

  public shouldUseVirtualScrollingSt(vh: number): boolean {
    // this method is used to determine if the HF list should be displayed as virtual scroll or not
    //  the reason behind this, is to allow the list to display dynamically without space in case of few items
    //  see https://github.com/novelt/GMT/issues/2083
    const minVSHeight = (vh / 100) * window.visualViewport!.height; // max-height is set to
    const listHeight = 43 * this.stSortFilterService.idDisplayList.length + 145; // including expanded item

    return listHeight > minVSHeight;
  }

  private setComponentPermissions(): void {
    if (!this.bvService.boundaryInfo?.boundary) {
      return;
    }
    this.userHasPermissionsUpdateSt =
      this.userContextService.userHasPermissions(
        VectorLayerForPermissions.settlementName,
        'update',
        this.bvService.boundaryInfo.boundary.properties.global_id
      );
    this.userHasPermissionsUpdateHf =
      this.userContextService.userHasPermissions(
        VectorLayerForPermissions.healthFacility,
        'update',
        this.bvService.boundaryInfo.boundary.properties.global_id
      );
    this.updateCanUserDoAction();
  }

  private subscribeToUndoRedo() {
    this.crudLayerService
      .getUndoEventObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async (_) => {
        await this.initializeProblemLists();
      });
    this.crudLayerService
      .getRedoEventObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async (_) => {
        await this.initializeProblemLists();
      });
  }

  private subscribeToEditMode() {
    this.userContextService
      .getIsEditingObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((isEditing) => {
        this.editing = isEditing;
        this.updateCanUserDoAction();
      });
  }

  private updateCanUserDoAction(): void {
    this.userCanEditSt = this.userHasPermissionsUpdateSt && this.editing;
    this.userCanEditHf = this.userHasPermissionsUpdateHf && this.editing;
  }

  private initializeProblemLists() {
    // commented out after the meeting https://github.com/novelt/GMT/issues/1656#issuecomment-1437116259
    // this.buildHealthFacilityListWithProblems();
    this.buildSettlementsListWithProblems();
  }
  // commented out after the meeting https://github.com/novelt/GMT/issues/1656#issuecomment-1437116259
  // private buildHealthFacilityListWithProblems() {
  //   const notFilteredHfList: HealthFacilityItem[] = this.problemsService.buildHealthFacilityListWithProblems();
  //   this.hfSortFilterService = new SortingFilteringService(
  //     Array.from(notFilteredHfList.map(hfItem => hfItem.json)),
  //     Array.from(notFilteredHfList.map(hfItem => hfItem.json.properties.global_id)),
  //     []
  //   );
  //   this.hfIssues = new Map();
  //   notFilteredHfList.map(hf => this.hfIssues.set(hf.json.properties.global_id, hf));
  //   this.listLength += this.hfIssues.size;
  // }

  private buildSettlementsListWithProblems() {
    // reset values
    this.listLength = 0;
    this.stSortFilterService = new SettlementSortingFilteringService(
      this.singleStProcessingService,
      []
    );
    this.problemsService.buildSettlementsGeometryProblems((stIssues) => {
      this.stIssues = stIssues;
      this.stSortFilterService = new SettlementSortingFilteringService(
        this.singleStProcessingService,
        Array.from(this.stIssues.values())
        // [{
        //   problems:  null,
        //   problemsUI: [
        //     {
        //       message: 'test',
        //       type: SettlementNameProblemTypes.EMPTY_OR_NULL_GEOMETRY,
        //       resolutions: [],
        //     }
        //   ] ,
        //   settlementName:null,// GeoJsonSettlementName,
        //   settlementPart: null
        // }]
      );
      this.listLength += this.stIssues.size;
    });
  }
}
