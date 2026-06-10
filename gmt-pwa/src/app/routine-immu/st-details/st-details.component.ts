import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntil } from 'rxjs/operators';
import { Subject } from "rxjs";
import { BoundaryVectorLayersService } from "src/app/services/boundary-vector-layers.service";
import { CrudLayerService } from "src/app/services/vector_layer/crud-layer.service";
import { GeoJsonSettlementName, PropertyValue } from 'src/app/utils/server-interfaces/GeoJson';
import { HistoryService } from "src/app/services/history.service";
import { MicroplanMapEventsService } from "src/app/services/map/MicroplanMapEventsService";
import { SingleStService } from 'src/app/services/vector_layer/single-st.service';
import { UserContextService } from "src/app/services/user-context.service";
import { RoutesChunks } from "src/app/constants/routing.enum";
import { RIRouteService } from "src/app/services/shared/route/ri-route.service";
import { isEmpty } from "src/app/utils/server-interfaces/utils/geom.util";
import { getExtentedBoundingBoxForFeatures } from "src/app/utils/coords";
import { MapEventsService, OverlayLayer, ZoomMode } from '@services/map/base/map-events.service';
import { CoverageSett, SingleStProcessingService } from '@services/vector_layer/single-st-processing.service';
import { formatPercentage, formatPopulation } from 'src/app/utils/string-formatting';
import { NGXLogger } from 'ngx-logger';

@Component({
    selector: 'st-details',
    templateUrl: './st-details.component.html',
    styleUrls: [
        '../details.less',
        './st-details.component.less'
    ],
    standalone: false
})
export class StDetailsComponent implements OnInit {
    public editing = false;
    public hfListLength: number = 0;
    public stName!: GeoJsonSettlementName;
    public loaded = false;
    public settlementIsNotFound: boolean = false;
    public coverageSett: CoverageSett;
    private unsubscribe = new Subject();

    constructor(
        public bvService: BoundaryVectorLayersService,
        public crudLayerService: CrudLayerService,
        public userContextService: UserContextService,
        private activatedRoute: ActivatedRoute,
        private historyService: HistoryService,
        private mapEvents: MapEventsService,
        private microplanMapEvents: MicroplanMapEventsService,
        private router: Router,
        private singleStService: SingleStService,
        private singleProcessingStService: SingleStProcessingService,
        private riRouteService: RIRouteService,
        private logger: NGXLogger,
    ) {
    }

    async ngOnInit() {
        this.singleStService.stName.pipe(takeUntil(this.unsubscribe)).subscribe((stName: GeoJsonSettlementName | null) => {
            if (!stName) {
                return
            }
            this.stName = stName;
            this.hfListLength = this.singleStService.fixedPostEntries.size;
            this.loaded = true;
            //this.logger.info(`EEE Calculating catching ${this.stName.properties.global_id} ${this.singleStService.settlementName.properties.global_id} sp ${this.singleStService.settlementPart.properties.global_id} ${this.singleStService.settlementName.properties.settlement_part} ${stName.properties.settlement_part}`);
            const catchmentCalculation = this.singleProcessingStService.calculateCatchment(
                this.singleStService.settlementPart!, this.singleStService.settlementName);
            // handle the case the outreach is created in the parent settlement and the settlement is split while rendering this window
            if (!catchmentCalculation) {
                return;
            }
            this.coverageSett = catchmentCalculation.catchment;
            //this.logger.info(`EEE`, this.coverageSett);
            this.initializeComponentOnceLoaded();
        });

        this.userContextService.getIsEditingObservable().pipe(
            takeUntil(this.unsubscribe)
        ).subscribe(pIsEditing => {
            this.editing = pIsEditing;
        });

        this.crudLayerService.getRedoEventObservable().pipe(
            takeUntil(this.unsubscribe)
        ).subscribe(_ => {
            if (this.settlementIsNotFound) {
                this.initializeComponentOnceLoaded();
            }
        });
    }

    ngOnDestroy() {
        this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }

    async handleClose() {
        await this.router.navigate([
            RoutesChunks.ROUTINE_IMMUNIZATION,
            this.riRouteService.getBoundaryIdValue(),
            RoutesChunks.SETTLEMENTS
        ], {
            queryParamsHandling: "preserve"
        });
    }

    async handleBack() {
        if (this.historyService.hasUrlStacked()) {
            await this.router.navigate([this.historyService.pop()?.split("?")[0]], {
                queryParamsHandling: "merge"
            });
        } else {
            this.handleClose();
        }
    }

    handleShowSettlementSiteOnMap(event: MouseEvent) {
        event.stopPropagation();
        if (isEmpty(this.stName)) {
            return;
        }
        this.microplanMapEvents.triggerSettlementHighlightEvent(this.stName.properties.global_id);
        this.mapEvents.panToExtent({
            movementType: "Pan",
            extent: getExtentedBoundingBoxForFeatures(1000, this.stName),
            zoomMode: ZoomMode.ZOOM_IN_MAX
        });
    }

    private initializeComponentOnceLoaded() {

    }

    public formatPopulation(pop: PropertyValue) {
        return formatPopulation(pop);
    }

    public formatPercentage(pop: PropertyValue) {
        return formatPercentage(pop, true);
    }

}


