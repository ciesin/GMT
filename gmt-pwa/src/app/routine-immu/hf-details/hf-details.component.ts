import { Component, Inject, LOCALE_ID, OnInit, Type } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntil } from 'rxjs/operators';
import { Subject } from "rxjs";
import { BoundaryVectorLayersService, } from "src/app/services/boundary-vector-layers.service";
import {
    HfSettlementContentComponent
} from "src/app/routine-immu/hf-details/hf-settlement/hf-settlement-content.component";
import { ChosenFilters } from "src/app/components/microplan-view/microplan-filter/microplan-filter.component";
import { GeoJsonHealthFacility, ROUTINE_IMMUNIZATION_SERVICE } from 'src/app/utils/server-interfaces/GeoJson';
import { MicroplanMapEventsService, } from "src/app/services/map/MicroplanMapEventsService";
import { NGXLogger } from 'ngx-logger';
import { RIRouteService } from "src/app/services/shared/route/ri-route.service";
import { RoutesChunks } from 'src/app/constants/routing.enum';
import {
    SETTLEMENTS_FILTERS,
    SETTLEMENTS_SORT_HEADERS
} from "src/app/components/microplan-view/settlements-view/settlements-view.component";
import { HealthFacilitySite, SingleHfService } from "src/app/services/vector_layer/single-hf.service";
import { formatPopulation, highlightText, } from "src/app/utils/string-formatting";
import { SettlementSortingFilteringService } from "src/app/services/shared/lists/st-sorting-filtering.service";
import { Sort } from '@angular/material/sort';
import { HfExcludedSettlementContentComponent } from './hf-excluded-settlement/hf-excluded-settlement-content.component';
import { MapEventsService, OverlayLayer } from '@services/map/base/map-events.service';
import { CoverageHf, loadHealthFacility } from '@services/vector_layer/single-hf-processing.service';
import { SingleStProcessingService } from '@services/vector_layer/single-st-processing.service';
import { EMPTY_SORT_STATE, SortStateService } from "@services/shared/notifications/sortState";


@Component({
    selector: 'hf-details',
    templateUrl: './hf-details.component.html',
    styleUrls: [
        '../details.less',
        './hf-details.component.less'
    ],
    standalone: false
})
export class HfDetailsComponent implements OnInit {
    public coverageHf: CoverageHf;
    //Current health facility being edited
    public hf!: GeoJsonHealthFacility;
    public isOutreach: boolean = false;
    public includedSettlementsCount: string = "";
    public excludedSettlementsCount: string = "";
    public outreachIncludedCount: string = "";
    public staffMembersCount: string = "";
    public hfIsNotFound: boolean = false;
    public outreaches: Array<HealthFacilitySite> = [];
    public loaded = false;
    public sortFilterService: SettlementSortingFilteringService;
    public excludeSortFilterService: SettlementSortingFilteringService;
    public sortHeaders = SETTLEMENTS_SORT_HEADERS;
    public stFilters = SETTLEMENTS_FILTERS;
    public stIdDisplayList: Array<string> = [];
    public itemComponent: Type<any> = HfSettlementContentComponent;
    public excludedItemComponent = HfExcludedSettlementContentComponent;
    //private settlementList: Array<SettlementListItem> = [];
    private firstFiltersChosen: boolean = false;
    private unsubscribe = new Subject();

    @Inject(LOCALE_ID) private locale: string;

    constructor(
        public bvService: BoundaryVectorLayersService,
        private logger: NGXLogger,
        private mapEvents: MapEventsService,
        private microplanMapEvents: MicroplanMapEventsService,
        private riRouteService: RIRouteService,
        private router: Router,
        private singleHfService: SingleHfService,
        private singleStProccessingService: SingleStProcessingService,
        private sortStateService: SortStateService
    ) { }

    ngOnDestroy() {
        this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }

    async ngOnInit() {
        this.singleHfService.hf.pipe(takeUntil(this.unsubscribe)).subscribe((hf: GeoJsonHealthFacility | null) => {
            if (!hf) {
                return
            }
            this.outreaches = this.singleHfService.outreaches.sort((a, b) => a.name.localeCompare(b.name));
            this.hf = hf;
            hf.properties.services.sort((obj1: string, obj2: string) => {
                if ((obj1 === ROUTINE_IMMUNIZATION_SERVICE) != (obj2 === ROUTINE_IMMUNIZATION_SERVICE)) {
                    return obj1 === ROUTINE_IMMUNIZATION_SERVICE ? -1 : 1;
                }
                return obj1 > obj2 ? 1 : obj1 < obj2 ? -1 : 0;
            });
            this.sortFilterService = new SettlementSortingFilteringService(
                this.singleStProccessingService,
                Array.from(this.singleHfService.includedSettlementsMap.values()),
                { sortOrder: this.sortHeaders.flat().find(s => !!s.direction) }
            );
            this.excludeSortFilterService = new SettlementSortingFilteringService(
                this.singleStProccessingService,
                Array.from(this.singleHfService.excludedSettlementsMap.values()),
                { sortOrder: this.sortHeaders.flat().find(s => !!s.direction) }
            );
            this.logger.debug(`HF Details component refresh with ${hf.properties.name} ` +
                `# of included settlements ${this.sortFilterService.list.length} # of excluded ${this.excludeSortFilterService.list.length}`);
            //this.logger.debug("EEE ", Array.from(this.singleHfService.excludedSettlementsMap.values()));

            //This should never be true...
            this.isOutreach = this.singleHfService.outreachGuid != null;
            this.getIncludedSettlementsCount();
            this.getExcludedSettlementsCount();
            this.getOutreachIncludedCount();
            this.getStaffMembersCount();
            this.coverageHf = loadHealthFacility({ logger: this.logger, boundaryData: this.bvService.data }, hf.properties.global_id)!;
            this.sortStateService.stListInHfDetailsSort.next(EMPTY_SORT_STATE);
            this.loaded = true;
        });
        // this.userContextService.getIsEditingObservable().pipe(takeUntil(this.unsubscribe)).subscribe(x => this.editing = x);
        //Listen to the route, relative links will just trigger this observable instead of
        //reinitializing a new component
        //TODO IEVA, didn't implement waiting for filter(suppressUi => !suppressUi), and mapInit
    }

    async handleClose() {
        await this.router.navigate([
            RoutesChunks.ROUTINE_IMMUNIZATION,
            this.riRouteService.getBoundaryIdValue(),
            RoutesChunks.HEALTH_FACILITIES
        ], {
            queryParamsHandling: "preserve"
        });
    }

    handleShowHfSiteOnMap(event: MouseEvent) {
        event.stopPropagation();
        this.singleHfService.handleShowHfSiteOnMap();
    }

    highlightText(text: string, highlight: string) {
        return highlightText(text, highlight);
    }

    // openWizard(outreach: HealthFacilitySite) {
    //   this.dialog.open(HealthFacilityWizardComponent, {
    //     ...DEFAULT_WIZARD_DIALOG_OPTIONS,
    //     data: {
    //       editHealthFacilityId: outreach.json.properties.global_id,
    //       isOutreach: true,
    //       outreachParentHealthFacilityId: null,
    //     } as HealthFacilityWizardDialogData,
    //   });
    // }
    // TODO do we need this tab?
    // getAllExcludedTab(): number {
    //   if (this.hf.properties.type !== 'fixed_post') {
    //     return 0;
    //   }
    //
    //   return this.fixedPost.excludedSettlements.length + this.getOutreachExcludedCount();
    // }

    private getIncludedSettlementsCount() {
        let total = this.singleHfService.includedSettlementsMap.size;
        this.includedSettlementsCount = `${total}`;
    }

    private getExcludedSettlementsCount() {
        let total = this.singleHfService.excludedSettlementsMap.size;
        if (!total || total < 0) {
            this.excludedSettlementsCount = "";
            return;
        }
        this.excludedSettlementsCount = `${total}`;

    }

    private getStaffMembersCount() {
        this.staffMembersCount = `${this.hf.properties.staff_names.length}`;
    }

    private getOutreachIncludedCount() {
        // let total = 0;
        // let filtered = 0;
        //
        // this.singleHfService.outreaches.forEach(outreach => {
        //   total += outreach.notFilteredSettlements.length;
        //   filtered += outreach.filteredSettlements.length;
        // })
        //
        // if (total === filtered) {
        //   return filtered
        // }
        //
        // return filtered + "/" + total
        this.outreachIncludedCount = `${this.singleHfService.outreaches.length}`;
    }

    handleChosenFilters(chosenFilters: ChosenFilters) {
        const firstFiltersChosen = this.sortFilterService.chosenFilters == null;
        this.sortFilterService.chosenFilters = chosenFilters;
        this.sortStateService.stListInHfDetailsSort.next(chosenFilters);
        this.filterAndSort().then();
        if (this.firstFiltersChosen == false) {
            this.firstFiltersChosen = firstFiltersChosen;
        }
    }

    handleSearchText(search: string) {
        this.sortFilterService.handleSearchText(search);
    }

    handleSort(sort: Sort) {
        this.sortFilterService.sortOrder = sort;
        this.filterAndSort().then();
    }

    ownershipMap(privateHf: boolean): "Private" | "Public" | null {
        return this.singleHfService.ownershipMap(privateHf);
    }

    formatPopulation(pop: number): string {
        return formatPopulation(pop, this.locale);
    }

    private async filterAndSort() {
        await this.sortFilterService.filterAndSort();
        // C. focus
        // it is easier to separate filtering and clearing filter stage
        if (!!this.sortFilterService.getSearchedText() && this.sortFilterService.chosenFilters!.choices.size == 0) {
            this.microplanMapEvents.triggerRemoveSettlementFocus();
        } else {
            if (!this.firstFiltersChosen) {
                this.microplanMapEvents.triggerFocusSettlement(this.sortFilterService.idDisplayList);
            }
        }
    }
}


