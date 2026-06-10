import { Component, Inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CrudLayerService } from '@services/vector_layer/crud-layer.service';
import { NGXLogger } from 'ngx-logger';
import { ReplaySubject, Subject, filter, map, switchMap, take, takeUntil } from 'rxjs';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import {
    CoverageHf,
    SingleHfProcessingService,
    loadHealthFacility
} from 'src/app/services/vector_layer/single-hf-processing.service';

import { MatAccordion, MatExpansionPanel } from '@angular/material/expansion';
import { MapEventsService } from "@services/map/base/map-events.service";
import { PropertyValue } from 'src/app/utils/server-interfaces/GeoJson';
import { formatPercentage, formatPopulation } from 'src/app/utils/string-formatting';
import { ACCORDION_TOKEN, ID_TOKEN } from '../microplan-view/microplan-list/microplan-list.component';
import { getSortedDisplayName, SortStateService } from "@services/shared/notifications/sortState";
import _ from "lodash";


@Component({
    selector: 'gmt-hf-catchment-card, [gmt-hf-catchment-card]',
    templateUrl: './hf-catchment-card.component.html',
    styleUrls: ['./card.less', './hf-catchment-card.component.less'],
    standalone: false
})
export class HFCatchmentCardComponent implements OnInit, OnDestroy {
    private unsubscribe = new Subject();

    coverageHf: CoverageHf;

    public displayName: string;

    @ViewChild(MatExpansionPanel)
    set matExpansionPanel(panel: MatExpansionPanel) {
        // hook the panel expansion to the accordion when ready
        if (!panel) { return; }
        this.accordion$.pipe(
            filter(Boolean),
            take(1)
        ).subscribe(accordion => panel.accordion = accordion);
    }

    public panelOpenState: boolean = false;
    constructor(
        @Inject(ID_TOKEN) public id: string,
        @Inject(ACCORDION_TOKEN) public accordion$: ReplaySubject<MatAccordion>,
        public bvService: BoundaryVectorLayersService,
        public logger: NGXLogger,
        private activatedRoute: ActivatedRoute,
        private mapEvents: MapEventsService,
        private microplanMapEvents: MicroplanMapEventsService,
        private crudLayerService: CrudLayerService,
        private singleHfProcessingService: SingleHfProcessingService,
        private sortStateService: SortStateService
    ) { }

    async ngOnInit() {
        this.activatedRoute.parent!.params.pipe(
            map(params => params[RoutesChunks.PARAM_BOUNDARY.replace(':', '')]),
            switchMap(boundaryId => {
                // console.log("Microplan HF List Boundary id", boundaryId);
                return this.bvService.ensureBoundaryLoaded(boundaryId);
            }),
            switchMap(_ok => {
                return this.crudLayerService.suppressUserInterfaceUpdates.asObservable();
            }),
            filter(suppressUi => !suppressUi),
            takeUntil(this.unsubscribe),
        ).subscribe(async () => {
            //Note health facility data can change as we add outreach sites, for example
            this.coverageHf = loadHealthFacility({ logger: this.logger, boundaryData: this.bvService.data }, this.id)!;
            //do after settlement is initialized
            this.listenToSort();
        });


    }

    ngOnDestroy() {
        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }

    public formatPopulation(pop: PropertyValue) {
        return formatPopulation(pop);
    }

    public formatPercentage(pop: PropertyValue) {
        return formatPercentage(pop, true);
    }

    handleShowHfSiteOnMap(event: MouseEvent) {
        event.stopPropagation();
        const hfId = this.id;
        const healthFacility = this.bvService.data.hfMap.get(hfId)!;
        this.singleHfProcessingService.handleShowHfSiteOnMap(healthFacility);
    }

    public onOpenPanelAction() {
        this.singleHfProcessingService.onOpenPanelAction(this.panelOpenState, this.coverageHf.hf!);
    }

    private listenToSort() {

        this.displayName = this.coverageHf?.name;

        this.sortStateService.hfListSort.pipe(
            takeUntil(this.unsubscribe)
        ).subscribe(sortState => {
            this.displayName = getSortedDisplayName(
                sortState,
                this.coverageHf?.hf!);
        });
    }
}


