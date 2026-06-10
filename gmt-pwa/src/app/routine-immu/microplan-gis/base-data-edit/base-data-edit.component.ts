import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { NGXLogger } from 'ngx-logger';
import { BoundaryVectorLayersService } from "src/app/services/boundary-vector-layers.service";
import { CrudLayerService } from "src/app/services/vector_layer/crud-layer.service";
import { IsLoadingService } from "src/app/services/is-loading.service";
import { VectorLayerForPermissions } from "src/app/utils/server-interfaces/VectorLayerName";
import {
    GeoJsonHealthFacility,
    GeoJsonSettlementName,
    GeoJsonSettlementPart,
} from "src/app/utils/server-interfaces/GeoJson";
import { map, Subject, switchMap, takeUntil } from 'rxjs';
import { PermissionsLayerService } from "src/app/services/vector_layer/permissions-layer.service";
import { UserContextService } from 'src/app/services/user-context.service';
import { SettlementProblems } from "src/app/services/geo/WorkerInterface";
import { ProblemUI } from "src/app/routine-immu/microplan-gis/microplan-gis.component";
import {
    SettlementIssueEditComponent
} from "src/app/routine-immu/microplan-gis/base-data-edit/settlement-issue-edit/settlement-issue-edit.component";
import { Sort, SortDirection } from '@angular/material/sort';
import { SettlementSortingFilteringService } from "src/app/services/shared/lists/st-sorting-filtering.service";
import { SortingFilteringService } from 'src/app/services/shared/lists/sorting-filtering.service';
import {
    HfIssueEditComponent
} from "src/app/routine-immu/microplan-gis/base-data-edit/hf-issue-edit/hf-issue-edit.component";
import { ProblemsService } from "src/app/services/attention/problems.service";
import { SingleStProcessingService } from '@services/vector_layer/single-st-processing.service';
import { ActivatedRoute } from '@angular/router';
import { RoutesChunks } from 'src/app/constants/routing.enum';


export interface SettlementIssueItem {
    problems: SettlementProblems | null,
    problemsUI: ProblemUI[],
    settlementName: GeoJsonSettlementName,
    settlementPart: GeoJsonSettlementPart | null
}

// Renaming, extends Sortable
export interface HealthFacilityItem {
    coordinates: { lon?: number, lat?: number }
    json: GeoJsonHealthFacility
    problemsUI: ProblemUI[]
}

export const hfsTab = 'hfsTab';
export const settlementsTab = 'settlementsTab';

@Component({
    selector: 'base-data-edit',
    templateUrl: './base-data-edit.component.html',
    styleUrls: ['./base-data-edit.component.less'],
    standalone: false
})
export class BaseDataEditComponent implements OnInit, OnDestroy {
    @Input() activeTab: string | null = null;
    @Output() hfsTabIsOpen = new EventEmitter<boolean>();
    @Output() settlementsTabIsOpen = new EventEmitter<boolean>();
    @Output() issueIsFixed = new EventEmitter<boolean>();
    public hfsTab = hfsTab;
    public settlementsTab = settlementsTab;
    public hfsPanelOpenState: boolean = true;
    public settlementsPanelOpenState: boolean = true;
    public userCanEditSt: boolean = false;
    public userCanEditHf: boolean = false;
    public editing: boolean = false;
    public settlementEditComponent = SettlementIssueEditComponent;
    public hfEditComponent = HfIssueEditComponent;
    public stSortHeaders = [{
        label: 'Settlement name',
        active: 'name',
        direction: 'asc' as SortDirection,
    }];
    public hfSortHeaders = [{
        label: 'Facility Name',
        active: 'name',
        direction: 'asc' as SortDirection,
    }];
    public stSortFilterService: SettlementSortingFilteringService;
    public hfSortFilterService: SortingFilteringService;
    public hfsListLength: number = 0;
    public settlementsListLength: number = 0;
    public hfIssues: Map<string, HealthFacilityItem>;

    private userHasPermissionsUpdateSt: boolean = false;
    private userHasPermissionsUpdateHf: boolean = false;
    private unsubscribe = new Subject();

    constructor(
        private bvService: BoundaryVectorLayersService,
        private activatedRoute: ActivatedRoute,
        private crudLayerService: CrudLayerService,
        private isLoadingService: IsLoadingService,
        private logger: NGXLogger,
        private permissionsLayerService: PermissionsLayerService,
        private userContextService: UserContextService,
        private singleStProcessingService: SingleStProcessingService,
        public problemsService: ProblemsService,
    ) {
        this.isLoadingService.setLoading(true);
    }

    ngOnInit() {
        this.activatedRoute.parent!.params.pipe(
            map(params => params[RoutesChunks.PARAM_BOUNDARY.replace(':', '')]),
            switchMap(boundaryId => {
                return this.bvService.ensureBoundaryLoaded(boundaryId);
            }),
            takeUntil(this.unsubscribe),
        ).subscribe(_ => {
            this.initializeProblemLists();
        });

        this.subscribeToUndoRedo();
        this.permissionsLayerService.getPermissionsObservable().pipe(
            takeUntil(this.unsubscribe)
        ).subscribe(_ => {
            this.setComponentPermissions();
        });
        this.subscribeToEditMode();
        this.subscribeToVectorDataChange();
        // this.initializeProblemLists();
        this.isLoadingService.setLoading(false);
    }

    ngOnDestroy(): void {

        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }

    public hfsPanelStateChange() {
        this.hfsTabIsOpen.emit(this.hfsPanelOpenState);
    }

    public settlementsPanelStateChange() {
        this.settlementsTabIsOpen.emit(this.settlementsPanelOpenState);
    }

    public handleStSort(sort: Sort) {
        this.stSortFilterService.sortOrder = sort;
        this.stFilterAndSort();
    }

    public handleHfSort(sort: Sort) {
        this.hfSortFilterService.sortOrder = sort;
        this.hfFilterAndSort();
    }

    public shouldUseVirtualScrollingHF(vh: number): boolean {
        // this method is used to determine if the HF list should be displayed as virtual scroll or not
        //  the reason behind this, is to allow the list to display dynamically without space in case of few items
        //  see https://github.com/novelt/GMT/issues/2083
        const minVSHeight = (vh / 100) * window.visualViewport!.height; // max-height is set to
        const listHeight = 43 * this.hfSortFilterService.idDisplayList.length + 170; // including expanded item

        return listHeight > minVSHeight;
    }

    public shouldUseVirtualScrollingSt(vh: number): boolean {
        // this method is used to determine if the St list should be displayed as virtual scroll or not
        //  the reason behind this, is to allow the list to display dynamically without space in case of few items
        //  see https://github.com/novelt/GMT/issues/2083
        const minVSHeight = (vh / 100) * window.visualViewport!.height;
        const listHeight = (this.stSortFilterService) ? 43 * this.stSortFilterService.idDisplayList.length + 195 : 0; // including expanded item

        return listHeight > minVSHeight;
    }

    private async stFilterAndSort() {
        await this.stSortFilterService.filterAndSort();
    }

    private async hfFilterAndSort() {
        await this.hfSortFilterService.filterAndSort();
    }

    private setComponentPermissions(): void {
        if (!this.bvService.boundaryInfo?.boundary) {
            return;
        }
        this.userHasPermissionsUpdateSt = this.userContextService.userHasPermissions(VectorLayerForPermissions.settlementName,
            "update",
            this.bvService.boundaryInfo.boundary.properties.global_id
        );
        this.userHasPermissionsUpdateHf = this.userContextService.userHasPermissions(VectorLayerForPermissions.healthFacility,
            "update",
            this.bvService.boundaryInfo.boundary.properties.global_id);
        this.updateCanUserDoAction();
    }

    private subscribeToUndoRedo() {
        this.crudLayerService.getUndoEventObservable()
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(_ => {
                this.initializeProblemLists();
            });
        this.crudLayerService.getRedoEventObservable()
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(_ => {
                this.initializeProblemLists();
            });
    }

    private subscribeToEditMode() {
        this.userContextService.getIsEditingObservable().pipe(takeUntil(this.unsubscribe)).subscribe(isEditing => {
            this.editing = isEditing;
            this.updateCanUserDoAction();
        });
    }

    //TODO IEVA
    private subscribeToVectorDataChange() {
        // this.vectorLayerService.getVectorLayerObservable(ST_NAME_LAYER).pipe(takeUntil(this.unsubscribe))
        //   .subscribe(layer => {
        //     // this.buildSettlementsBaseProblems(); BAD idea
        //   });
    }

    private updateCanUserDoAction(): void {
        this.userCanEditSt = this.userHasPermissionsUpdateSt && this.editing;
        this.userCanEditHf = this.userHasPermissionsUpdateHf && this.editing;
    }

    private initializeProblemLists() {
        this.buildHealthFacilityListWithProblems();
        this.buildSettlementsBaseProblems();


        //   if (this.itemToRefresh) {
        //     if (this.itemToRefresh.type === "settlement__name")
        //       this.refreshSettlementProblems(this.itemToRefresh);
        //     if (this.itemToRefresh.type === "health_facility__point")
        //       this.refreshHealthFacilityProblems(this.itemToRefresh);
        //     this.itemToRefresh = null;
        //   }
    }

    private buildSettlementsBaseProblems() {
        this.settlementsListLength = 0;
        this.problemsService.buildSettlementsBaseProblems((stIssues) => {
            this.stSortFilterService = new SettlementSortingFilteringService(
                this.singleStProcessingService,
                Array.from(stIssues.values()),
                { sortOrder: this.stSortHeaders.find(s => !!s.direction) }
            );
            this.settlementsListLength += stIssues.size;
        });
    }

    private buildHealthFacilityListWithProblems() {
        this.hfsListLength = 0;
        const notFilteredHfList = this.problemsService.buildHfBaseProblems(false);
        this.hfSortFilterService = new SortingFilteringService(
            Array.from(notFilteredHfList.map(hfItem => hfItem.json)),
            [],
            {
                sortOrder: this.hfSortHeaders.find(s => !!s.direction)
            }
        );
        this.hfIssues = new Map();
        notFilteredHfList.map(hf => this.hfIssues.set(hf.json.properties.global_id, hf));
        this.hfsListLength += this.hfIssues.size;
    }

    // refreshSettlementProblems(settlementIssueItem) {
    //   WORKER_CLIENT.getSettlementProblems({
    //     data: this.bvService.data.toPlainObj(),
    //     cacheKey: 0,
    //     settlementNames: [settlementIssueItem.settlementName],
    //     problemType: WorkerFunction.GET_SETTLEMENT_PROBLEM_NAME_RELATED
    //   }).subscribe((settlementNameProblems) => {
    //     //settlementName
    //     // this.setProblemsToSettlement(settlementNameProblems);
    //   });
    // }
}
