import { Component, OnDestroy, OnInit } from '@angular/core';
import { filter, map, switchMap, takeUntil } from "rxjs/operators";
import { Subject } from "rxjs";
import { VectorLayerService } from "src/app/services/vector_layer/vector-layers.service";
import { ActivatedRoute, Router } from "@angular/router";
import { RoutesChunks } from 'src/app/constants/routing.enum';
import {
    MicroplanMapEventsService
} from "src/app/services/map/MicroplanMapEventsService";
import { UserContextService } from "src/app/services/user-context.service";
import { BoundaryVectorLayersService } from "src/app/services/boundary-vector-layers.service";
import { IsLoadingService } from "src/app/services/is-loading.service";
import { SettlementNameProblemTypes } from "src/app/services/geo/WorkerInterface";
import { CrudLayerService } from "src/app/services/vector_layer/crud-layer.service";
import { PermissionsLayerService } from "src/app/services/vector_layer/permissions-layer.service";
import { UserLocationService } from "src/app/services/map/user-location.service";
import { NGXLogger } from 'ngx-logger';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { BOUNDARY_EDITED_LAYER, ST_GEOMETRY_LAYER } from "src/app/utils/server-interfaces/VectorLayerName";
import { hfsTab, settlementsTab } from './base-data-edit/base-data-edit.component';
import { geometryDataTab } from "src/app/routine-immu/microplan-gis/geometry-issues/geometry-issues.component";
import { populationDiscrepanciesTab } from './population-data-edit/population-data-edit.component';
import { boundaryEditsTab } from './boundary-issues/boundary-issues.component';
import { MapEventsService, OverlayLayer } from '@services/map/base/map-events.service';

export interface ResolutionOption {
    disableRefreshProblems: () => void
}

export interface Resolution {
    icon?: string,
    tooltip?: string,
    label: string,
    command: (options: ResolutionOption) => any
}

export enum HFProblemTypes {
    // Commented out after the meeting https://github.com/novelt/GMT/issues/1656#issuecomment-1437116259
    // //Settlement name point has no geeometry
    // EMPTY_OR_NULL_GEOMETRY,
    //
    // //Settlement name Does not geospatially intersect its boundary
    // HF_OUTSIDE_BOUNDARY,
    //
    // //Settlement id not found in surrounding boundaries, or simply invalid
    // INVALID_HF_ID,

    //Name is empty or whitespace
    EMPTY_NAME,
    EMPTY_SERVICES,
    EMPTY_TYPE,
    EMPTY_OWNERSHIP,

}

export interface Sortable {
    nameToEdit: string,
    problemsUI: ProblemUI[],
}

export interface ProblemUI {
    message: string,
    type: HFProblemTypes | SettlementNameProblemTypes,
    resolutions: Array<Resolution>,
}


@Component({
    selector: 'gmt-microplan-gis',
    templateUrl: './microplan-gis.component.html',
    styleUrls: ['./microplan-gis.component.less'],
    host: {
        'class': 'settListHost'
    },
    standalone: false
})
export class MicroplanGisComponent implements OnInit, OnDestroy {
    public hfsTab = hfsTab;
    public settlementsTab = settlementsTab;
    public geometryDataTab = geometryDataTab;
    public populationDiscrepanciesTab = populationDiscrepanciesTab;
    public boundaryEditsTab = boundaryEditsTab;

    public activeTab: string | null = null;
    private unsubscribe = new Subject();

    public editing = false;

    public loaded = false;
    COLUMN_NAME = "name";


    constructor(
        public crudLayerService: CrudLayerService,
        private activatedRoute: ActivatedRoute,
        public mapEvents: MapEventsService,
        public microplanMapEvents: MicroplanMapEventsService,

        public bvService: BoundaryVectorLayersService,
        public isLoadingService: IsLoadingService,
        public messageService: MessageService,
        public locationService: UserLocationService,
        private logger: NGXLogger,
    ) {
    }

    ngOnDestroy() {
        this.microplanMapEvents.setSelectedSettlementParts([]);
        this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
        this.mapEvents.triggerLayerVisibilityChange(BOUNDARY_EDITED_LAYER, false);
        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }

    async ngOnInit() {
        this.loaded = false;

        // // Get the boundary code from the router
        this.activatedRoute.parent!.params.pipe(
            map(params => params[RoutesChunks.PARAM_BOUNDARY.replace(':', '')]),
            switchMap(boundaryId => {

                this.logger.info("Boundary id", boundaryId);
                //this.isLoadingService.setLoading(true);
                return this.bvService.ensureBoundaryLoaded(boundaryId);
            }),
            switchMap(_ok => {
                return this.crudLayerService.suppressUserInterfaceUpdates.asObservable();
            }),
            filter(suppressUi => !suppressUi),
            switchMap(_ok => {
                // this.initializeProblemLists();

                this.loaded = true;
                //The permissions can be loaded now since we have the boundary
                // this.setComponentPermissions();

                return this.mapEvents.getIsMapInitialized();
            }),
            filter(mapInit => {
                return mapInit;
            }),
            takeUntil(this.unsubscribe),
        ).subscribe(_ => {
            // this.initMapExtent();
        }, (e) => {
            this.logger.error("Error in subscribe", e);
        }, () => {
            this.logger.info(`Completed main subscribe`);
        });

    }

    public tabStateChanged(active: boolean, currentlyChangedTab: string) {
        if (active) {
            this.activeTab = currentlyChangedTab;
            if (currentlyChangedTab != boundaryEditsTab) {
                this.mapEvents.triggerLayerVisibilityChange(BOUNDARY_EDITED_LAYER, false);
                this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
            }
            if (currentlyChangedTab != geometryDataTab) {
                this.mapEvents.triggerLayerVisibilityChange(ST_GEOMETRY_LAYER, false);
            }
        }
    }
}
