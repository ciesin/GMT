import { CdkAccordionItem } from '@angular/cdk/accordion';
import { Component, Inject, OnDestroy, OnInit, Type } from '@angular/core';
import { Sort } from '@angular/material/sort';
import { ActivatedRoute } from '@angular/router';
import { MapEventsService } from '@services/map/base/map-events.service';
import { NGXLogger } from 'ngx-logger';
import { filter, map, Subject, switchMap, takeUntil, tap } from 'rxjs';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { SortingFilteringService } from "src/app/services/shared/lists/sorting-filtering.service";
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { loadHealthFacility } from 'src/app/services/vector_layer/single-hf-processing.service';

import { ALL_HEALTH_FACILITY_CATCHMENT_STATUS, ALL_HEALTH_FACILITY_LEVEL_OF_CARE } from 'src/app/utils/server-interfaces/GeoJson';
import { HFCatchmentCardComponent } from '../../catchment-card/hf-catchment-card.component';
import { GmtNewMode } from '../../gmt-new/gmt-new.component';
import { ChosenFilters, EMPTY_CHOICE, MicroplanFilterItem } from '../microplan-filter/microplan-filter.component';
import { SortHeader } from '../microplan-list/microplan-list.component';
import { EMPTY_SORT_STATE, SortStateService } from "@services/shared/notifications/sortState";


export const HF_FILTERS: Array<MicroplanFilterItem> = [
    {
        label: "Facility Type",
        key: "level_of_care",
        choices: [
            EMPTY_CHOICE,
            ...ALL_HEALTH_FACILITY_LEVEL_OF_CARE.map(hfType => {
                return {
                    label: hfType,
                    value: hfType
                }
            })
        ]
    },
    {
        label: "Microplan Status",
        key: "mp_status",
        choices: [
            EMPTY_CHOICE,
            ...ALL_HEALTH_FACILITY_CATCHMENT_STATUS.map(hfCatchmentStatus => {
                return {
                    label: hfCatchmentStatus,
                    value: hfCatchmentStatus
                }
            })
        ]
    },
    {
        label: "Services Provided",
        key: "services",
        choices: [
            EMPTY_CHOICE,
            {
                label: "Has Routine Immunization",
                value: true
            },
            {
                label: "No Routine Immunization",
                value: false
            },

        ]
    }
]

export const HF_SORT_HEADERS: Array<SortHeader> = [{
    label: 'Facility Name',
    active: 'name',
    direction: '',
}, {
    label: 'Population',
    active: 'population',
    direction: 'asc',
}]


@Component({
    selector: 'gmt-health-facilities-view',
    templateUrl: './health-facilities-view.component.html',
    styleUrls: ['./health-facilities-view.component.less'],
    standalone: false
})
export class HealthFacilitiesViewComponent implements OnInit, OnDestroy {
    hfFilters = HF_FILTERS;
    sortHeaders = HF_SORT_HEADERS;
    public sortFilterService: SortingFilteringService;
    searchAutocompletePropositions: { name: string, value: string }[] = [];
    itemComponent: Type<any> = HFCatchmentCardComponent;
    public newButtonExtanded = false;
    private firstFiltersChosen: boolean = false;
    private unsubscribe = new Subject();
    private newButtonTimeout: NodeJS.Timeout;

    constructor(
        private crudLayerService: CrudLayerService,
        private activatedRoute: ActivatedRoute,
        private mapEvents: MapEventsService,
        private microplanMapEvents: MicroplanMapEventsService,
        public bvService: BoundaryVectorLayersService,
        public logger: NGXLogger,
        private sortStateService: SortStateService
    ) { }

    ngOnDestroy() {
        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }

    async ngOnInit() {
        this.activatedRoute.parent!.params.pipe(
            map(params => params[RoutesChunks.PARAM_BOUNDARY.replace(':', '')]),
            switchMap(boundaryId => {
                console.log("Microplan HF List Boundary id", boundaryId);
                return this.bvService.ensureBoundaryLoaded(boundaryId);
            }),
            switchMap(_ok => {
                return this.crudLayerService.suppressUserInterfaceUpdates.asObservable();
            }),
            filter(suppressUi => !suppressUi),
            switchMap(_ok => {
                return this.mapEvents.getIsMapInitialized();
            }),
            filter(mapInit => {
                return mapInit;
            }),
            // switchMap(_ok => {
            //   this.setComponentPermissions();
            //   return this.userContextService.getIsEditingObservable();
            // }),
            takeUntil(this.unsubscribe),
        ).subscribe(async editing => {
            //further limit by this boundary only
            const inBoundaryHfList = this.bvService.data.getHfFixedPost();
            this.sortStateService.hfListSort.next(EMPTY_SORT_STATE);
            if (!this.sortFilterService) {
                this.sortFilterService = new SortingFilteringService(
                    inBoundaryHfList,
                    inBoundaryHfList.map(hf => loadHealthFacility({ logger: this.logger, boundaryData: this.bvService.data }, hf.properties.global_id)!),
                    {
                        sortOrder: this.sortHeaders.find(s => !!(s.direction))
                    }
                );
            } else {
                this.sortFilterService.updateList(
                    inBoundaryHfList,
                    inBoundaryHfList.map(hf => loadHealthFacility({ logger: this.logger, boundaryData: this.bvService.data }, hf.properties.global_id)!),
                );
            }

            this.logger.info("hf view subscribe");

        });
    }

    handleChosenFilters(chosenFilters: ChosenFilters) {
        const firstFiltersChosen = this.sortFilterService.chosenFilters == null;

        // skip redrawing on load
        this.sortFilterService.setFilters(chosenFilters);
        this.sortStateService.hfListSort.next(chosenFilters);
        this.filterAndSort().then();
        if (this.firstFiltersChosen == false) {
            this.firstFiltersChosen = firstFiltersChosen;
        }
    }

    handleSearchText(search: string) {
        this.sortFilterService.handleSearchText(search);
    }

    handleSort(sort: Sort) {
        this.sortFilterService.setSortOrder(sort);
        this.filterAndSort().then();
    }

    handleScroll(evt) {
        // extant new button
        if (this.newButtonTimeout) {
            clearTimeout(this.newButtonTimeout);
        }
        this.newButtonExtanded = true;
        this.newButtonTimeout = setTimeout(() => this.newButtonExtanded = false, 500);
    }

    private async filterAndSort() {
        await this.sortFilterService.filterAndSort();
        // C. focus
        // it is easier to separate filtering and clearing filter stage
        if (!!this.sortFilterService.getSearchedText() && this.sortFilterService.chosenFilters!.choices.size == 0) {
            this.microplanMapEvents.triggerRemoveHfFocus();
        } else {
            if (this.firstFiltersChosen) {
                this.microplanMapEvents.triggerFocusHf(this.sortFilterService.idDisplayList);
            }
        }
    }
}


