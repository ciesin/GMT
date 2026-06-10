import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { NGXLogger } from 'ngx-logger';
import { BoundaryVectorLayersService } from "src/app/services/boundary-vector-layers.service";
import { CrudLayerService } from "src/app/services/vector_layer/crud-layer.service";
import { v4 as uuidv4 } from "uuid";
import { BoundaryEditComponent } from "src/app/_shared/components/boundary-edit/boundary-edit.component";
import {
    DEFAULT_WIZARD_DIALOG_OPTIONS
} from "src/app/components/wizard/health-facility-wizard/health-facility-wizard.component";
import { MatDialog } from '@angular/material/dialog';
import { BOUNDARY_EDITED_LAYER, VectorLayerForPermissions } from "src/app/utils/server-interfaces/VectorLayerName";
import { GeoJsonBoundaryEdited } from "src/app/utils/server-interfaces/GeoJson";
import { BoundaryEditService } from "src/app/services/vector_layer/edit/boundary-edit.service";
import cloneDeep from 'lodash.clonedeep';
import {
    boundaryEditDifferenceSuggestionStyle,
    boundaryEditUnionSuggestionStyle
} from "src/app/_shared/map/styles/map-boundary-styles";
import { filter, Subject, switchMap, takeUntil } from 'rxjs';
import { PermissionsLayerService } from "src/app/services/vector_layer/permissions-layer.service";
import { UserContextService } from 'src/app/services/user-context.service';
import { ProblemsService } from "src/app/services/attention/problems.service";
import { LayerIds, MapEventsService, OverlayLayer, ZoomMode } from '@services/map/base/map-events.service';
import { getExtentedBoundingBoxForFeatures } from 'src/app/utils/coords';
import { ExcludeDialogResult } from "src/app/routine-immu/hf-details/hf-settlement/exclude-dialog.component";
import { Position } from '@turf/turf';


export const boundaryEditsTab = 'boundaryEditsTab';
@Component({
    selector: 'boundary-issues',
    templateUrl: './boundary-issues.component.html',
    styleUrls: [
        '../../../components/catchment-card/card.less',
        './boundary-issues.component.less'
    ],
    standalone: false
})
export class BoundaryIssuesComponent implements OnInit, OnDestroy {
    @Input() activeTab: string | null = null;
    @Output() tabIsOpen = new EventEmitter<boolean>();
    public boundaryEditsTab = boundaryEditsTab;
    public mainPanelOpenState: boolean = false;
    public panelOpenState: boolean = false;
    public openedIssueId: string | null = null;
    public userCanCreate: boolean = false;
    public userCanEdit: boolean = false;
    public editing: boolean = false;
    public boundaryIssues: GeoJsonBoundaryEdited[] = [];
    private userHasPermissionsUpdateBoundary: boolean = false;
    private userHasPermissionsCreateBoundary: boolean = false;
    private unsubscribe = new Subject();

    constructor(
        private boundaryEditService: BoundaryEditService,
        private problemsService: ProblemsService,
        private bvService: BoundaryVectorLayersService,
        private crudLayerService: CrudLayerService,
        private dialog: MatDialog,
        private logger: NGXLogger,
        private mapEvents: MapEventsService,
        private permissionsLayerService: PermissionsLayerService,
        private userContextService: UserContextService,
    ) {
    }

    ngOnInit() {
        this.bvService.loadedObs().pipe(takeUntil(this.unsubscribe)).subscribe(_ => {
            this.boundaryIssues = this.problemsService.getAllBoundaryModifications(false)!;
        });
        this.showEditBoundaryLayer();
        this.subscribeToUndoRedo();
        this.permissionsLayerService.getPermissionsObservable().pipe(
            takeUntil(this.unsubscribe)
        ).subscribe(_ => {
            this.setComponentPermissions();
        });
        this.subscribeToEditMode();

        //We also need to listen for any crud changes to boundary modifications
        this.subscribeToVectorSource();
    }

    ngOnDestroy(): void {
        this.unsubscribe.next(undefined);
        this.unsubscribe.complete();
    }

    public async markAsResolved(issueData: GeoJsonBoundaryEdited) {
        await this.boundaryEditService.saveEdits(issueData);
        this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
        this.boundaryIssues = this.problemsService.getAllBoundaryModifications(false)!;
    }

    async saveCommentEdit(issue: GeoJsonBoundaryEdited, index: number) {
        try {
            let comment = (<HTMLInputElement>document.getElementById(`comment${index}`));
            if (!comment) {
                return;
            }
            issue.properties.comment = comment.value;
            await this.crudLayerService.updateItem(BOUNDARY_EDITED_LAYER, issue, true, true, uuidv4());
        } catch (e) {
            this.logger.error(e);
        }
    }

    openBoundaryIssueUpdateModal(issue: GeoJsonBoundaryEdited) {
        if (this.dialog.openDialogs.length > 0) {
            return;
        }

        this.mapEvents.triggerLayerVisibilityChange(BOUNDARY_EDITED_LAYER, true);
        this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
        let dialogRef = this.dialog.open(BoundaryEditComponent, {
            ...DEFAULT_WIZARD_DIALOG_OPTIONS,
            data: issue,
        });
        dialogRef.componentInstance.savedEdit.pipe(
            takeUntil(this.unsubscribe)
        ).subscribe(_ => {
            this.boundaryIssues = this.problemsService.getAllBoundaryModifications(false)!;
        });
        dialogRef.afterClosed().pipe(
            takeUntil(this.unsubscribe)
        ).subscribe(async (result: ExcludeDialogResult) => {
            this.showDefaultMapLayers();
        });
        this.hideUnnecessaryMapLayers();
    }

    openBoundaryEditModal() {

        if (this.dialog.openDialogs.length > 0) {
            return;
        }

        this.mapEvents.triggerLayerVisibilityChange(BOUNDARY_EDITED_LAYER, true);
        this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
        let dialogRef = this.dialog.open(BoundaryEditComponent, {
            ...DEFAULT_WIZARD_DIALOG_OPTIONS,
        });
        dialogRef.componentInstance.savedEdit.pipe(
            takeUntil(this.unsubscribe)
        ).subscribe(_ => {
            this.boundaryIssues = this.problemsService.getAllBoundaryModifications(false)!;
        });
        dialogRef.afterClosed().pipe(
            takeUntil(this.unsubscribe)
        ).subscribe(async (result: ExcludeDialogResult) => {
            this.showDefaultMapLayers();
        });
        this.hideUnnecessaryMapLayers();
    }

    showEditBoundaryLayer() {
        this.mapEvents.triggerLayerVisibilityChange(BOUNDARY_EDITED_LAYER, this.mainPanelOpenState);
        this.tabIsOpen.emit(this.mainPanelOpenState);
        if (!this.mainPanelOpenState) {
            this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
        }
    }

    enableBoundaryModification(issueData: GeoJsonBoundaryEdited) {

        if (this.dialog.openDialogs.length > 0) {
            return;
        }
        //Also make sure we are showing the boundary, closing the boundary edit wizard can make this not visible
        this.mapEvents.triggerLayerVisibilityChange(BOUNDARY_EDITED_LAYER, true);
        this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
        if (this.panelOpenState || this.openedIssueId != issueData.properties.global_id) {
            let boundaryEditSuggestion = cloneDeep(issueData);
            boundaryEditSuggestion.geometry = boundaryEditSuggestion.properties.drawn_geometry!;
            this.mapEvents.addFeature({
                geo_json: boundaryEditSuggestion,
                style: (boundaryEditSuggestion.properties.union) ? boundaryEditUnionSuggestionStyle : boundaryEditDifferenceSuggestionStyle,
                layer: OverlayLayer.NORMAL
            });

            const extent = getExtentedBoundingBoxForFeatures(
                200,
                boundaryEditSuggestion
            );

            //Pan map too
            this.mapEvents.panToExtent({
                movementType: "Pan",
                extent,
                zoomMode: ZoomMode.DONT_CHANGE
            });

            this.openedIssueId = issueData.properties.global_id;
        }
    }

    public getFirstPointCoordinateForName(issue: GeoJsonBoundaryEdited): string {
        let coordinate: Position = cloneDeep(issue.properties.drawn_geometry!.coordinates[0][0][0]);
        return `${Math.round(coordinate[0] * 10000) / 10000}, ${Math.round(coordinate[1] * 10000) / 10000}`;
    }

    private setComponentPermissions(): void {
        if (!this.bvService.boundaryInfo?.boundary) {
            return;
        }
        this.userHasPermissionsUpdateBoundary = this.userContextService.userHasPermissions(VectorLayerForPermissions.boundary_edited,
            "update",
            this.bvService.boundaryInfo.boundary.properties.global_id);
        this.userHasPermissionsCreateBoundary = this.userContextService.userHasPermissions(VectorLayerForPermissions.boundary_edited,
            "create",
            this.bvService.boundaryInfo.boundary.properties.global_id);
        this.updateCanUserDoAction();
    }

    private subscribeToUndoRedo() {
        this.crudLayerService.getUndoEventObservable()
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(_ => {
                this.boundaryIssues = this.problemsService.getAllBoundaryModifications(false)!;
            });
        this.crudLayerService.getRedoEventObservable()
            .pipe(takeUntil(this.unsubscribe))
            .subscribe(_ => {
                this.boundaryIssues = this.problemsService.getAllBoundaryModifications(false)!;
            });
    }

    private subscribeToEditMode() {
        this.userContextService.getIsEditingObservable().pipe(takeUntil(this.unsubscribe)).subscribe(isEditing => {
            this.editing = isEditing;
            this.updateCanUserDoAction();
        });
    }

    private subscribeToVectorSource() {

        //The boundary edits are in the boundary service, so we listen to it
        this.userContextService.getCurrentBoundaryObservable().pipe(
            filter(boundary => !!boundary),
            switchMap(boundary => {
                this.logger.info(`Microplan Add Wizard List Boundary id ${boundary!.boundaryId}`);
                return this.bvService.ensureBoundaryLoaded(boundary!.boundaryId);
            })).subscribe(_ => {

                //this.vectorLayersService.getVectorLayerObservable(BOUNDARY_EDITED_LAYER).pipe(takeUntil(this.unsubscribe)).subscribe(() => {

                this.logger.info("Recieved boundary edit data update");
                this.boundaryIssues = this.problemsService.getAllBoundaryModifications(false)!;
            });
    }

    private updateCanUserDoAction(): void {
        this.userCanCreate = this.userHasPermissionsCreateBoundary && this.editing;
        this.userCanEdit = this.userHasPermissionsUpdateBoundary && this.editing;
    }

    private hideUnnecessaryMapLayers() {
        this.mapEvents.triggerLayerVisibilityChange(LayerIds.POP_RASTER_GENERIC, false);
        this.mapEvents.triggerLayerVisibilityChange(LayerIds.POP_RASTER_PROBLEMATIC, false);
        this.mapEvents.triggerLayerVisibilityChange(LayerIds.CATCHMENT, false);
        this.mapEvents.triggerLayerVisibilityChange(LayerIds.HF_VORONOI, false);
        this.mapEvents.triggerLayerVisibilityChange(LayerIds.HF_BUFFERS, false);
    }

    private showDefaultMapLayers() {
        this.mapEvents.triggerLayerVisibilityChange(LayerIds.POP_RASTER_GENERIC, true);
        this.mapEvents.triggerLayerVisibilityChange(LayerIds.POP_RASTER_PROBLEMATIC, true);
        this.mapEvents.triggerLayerVisibilityChange(LayerIds.CATCHMENT, true);
    }
}
