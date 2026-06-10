import { Component } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { BoundaryVectorLayersService } from '@services/boundary-vector-layers.service';
import {
  LayerIds,
  MapEventsService,
  OverlayLayer,
} from '@services/map/base/map-events.service';
import { UserActionLogService } from '@services/user-action-log.service';
import { UserContextService } from '@services/user-context.service';
import { PermissionsLayerService } from '@services/vector_layer/permissions-layer.service';
import { NGXLogger } from 'ngx-logger';
import { filter, Subject, switchMap, take, takeUntil } from 'rxjs';
import { DEFAULT_WIZARD_DIALOG_OPTIONS } from 'src/app/components/wizard/health-facility-wizard/health-facility-wizard.component';
import {
  SplitMergeWizardComponent,
  SplitMergeWizardDialogData,
} from 'src/app/components/wizard/split-merge-wizard/split-merge-wizard.component';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  BOUNDARY_EDITED_LAYER,
  HF_LAYER,
  ST_GEOMETRY_LAYER,
  VectorLayerForPermissions,
} from 'src/app/utils/server-interfaces/VectorLayerName';
import { BoundaryEditComponent } from 'src/app/_shared/components/boundary-edit/boundary-edit.component';
import { MapControlBaseComponent } from '../map-control-base.component';

//When the settlement split/merge tool is active, which layers to hide
//Note these are turned back on after the tool is closed
const LAYERS_TO_TURN_OFF = [
  LayerIds.CATCHMENT,
  HF_LAYER,
  LayerIds.POP_RASTER_GENERIC,
  LayerIds.POP_RASTER_PROBLEMATIC,
];

@Component({
  selector: 'map-control-selector',
  templateUrl: './map-control-selector.component.html',
  styleUrls: ['./map-control-selector.component.less'],
  providers: [
    {
      provide: MapControlBaseComponent,
      useExisting: MapControlSelectorComponent,
    },
  ],
standalone: false
})
export class MapControlSelectorComponent extends MapControlBaseComponent {
  public userCanUpdateSt: boolean = false;
  private editing: boolean = false;
  private userHasPermissionUpdateSettlement = false;
  constructor(
    private bvService: BoundaryVectorLayersService,
    private dialog: MatDialog,
    private logger: NGXLogger,
    private mapEvents: MapEventsService,
    private microplanMapEvents: MicroplanMapEventsService,
    private userContextService: UserContextService,
    private permissionsLayerService: PermissionsLayerService,
    private userActionLogService: UserActionLogService
  ) {
    super();
  }

  private unsubscribe = new Subject();

  public isSplitMergeWizardOpened = false;
  public isBoundaryEditWizardOpened = false;

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  override ngOnInit() {
    super.ngOnInit();
    this.subscribeToPermissionChange();
    this.subscribeToEditMode();

    if (AppConfigService.ENABLE_SPLIT_DEBUG) {
      this.mapEvents
        .getIsMapInitialized()
        .pipe(
          filter((isInit) => isInit),
          take(1)
        )
        .subscribe(() => {
          this.openSplitMergeWizard();

          setTimeout(() => {
            this.microplanMapEvents.setSelectedSettlementParts([
              '8515af11-ffe0-4ef9-89f3-cc0a1209a331',
            ]);
          }, 500);
        });
    }
    this.subscribeToBoundaryEditLayerVisibility();
  }

  openSplitMergeWizard() {
    if (this.dialog.openDialogs.length > 0) {
      return;
    }
    this.mapEvents.triggerLayerVisibilityChange(ST_GEOMETRY_LAYER, true);
    //Ideally we would remember the users previous selection, so we don't restore it if they
    //explicitly turned it off
    for (const layerName of LAYERS_TO_TURN_OFF) {
      this.mapEvents.triggerLayerVisibilityChange(layerName, false);
    }

    //Remove catchment lines too
    this.mapEvents.removeAllFeatures(OverlayLayer.OUTREACH_LINES);

    const data: SplitMergeWizardDialogData = {};

    //Clear any existing selections
    this.microplanMapEvents.setSelectedSettlementParts([]);

    const dialogRef = this.dialog.open(SplitMergeWizardComponent, {
      ...DEFAULT_WIZARD_DIALOG_OPTIONS,
      data,
    });
    dialogRef
      .afterClosed()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(() => {
        this.isSplitMergeWizardOpened = false;
        //This will handle setting the visibility, see settlementPartsSelectionObs
        this.microplanMapEvents.enableSettlementPartsSelection(false);

        for (const layerName of LAYERS_TO_TURN_OFF) {
          this.mapEvents.triggerLayerVisibilityChange(layerName, true);
        }

        //to draw the hf->outreach lines again
        this.microplanMapEvents.triggerCatchmentRendering();
      });
    this.microplanMapEvents.enableSettlementPartsSelection(true);
    this.isSplitMergeWizardOpened = true;
  }

  private subscribeToPermissionChange() {
    this.bvService
      .loadedObs()
      .pipe(
        switchMap((_) => {
          return this.permissionsLayerService.getPermissionsObservable();
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe((_) => {
        this.setComponentPermissions();
      });
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

  private setComponentPermissions(): void {
    if (!this.bvService.boundaryInfo?.boundary) {
      return;
    }

    this.userHasPermissionUpdateSettlement =
      this.userContextService.userHasPermissions(
        VectorLayerForPermissions.settlement,
        'update',
        this.bvService.boundaryInfo.boundary.properties.global_id
      );
    this.updateComponentPermissions();
  }

  private updateComponentPermissions() {
    this.userCanUpdateSt =
      this.editing && this.userHasPermissionUpdateSettlement;
  }

  toggleMenu() {}
  handleModifySettlements() {
    this.userActionLogService.addUserActionDescription(
      'Modify settlements (merge/split) opened'
    );
    this.openSplitMergeWizard();
  }

  handleWardCorrection() {
    this.isBoundaryEditWizardOpened = true;
    this.mapEvents.triggerLayerVisibilityChange(BOUNDARY_EDITED_LAYER, true);
    let dialogRef = this.dialog.open(BoundaryEditComponent, {
      ...DEFAULT_WIZARD_DIALOG_OPTIONS,
    });
    dialogRef.componentInstance.savedEdit.subscribe((_) => {
      // boundary edits are updated in resolve issues
    });
    dialogRef
      .afterClosed()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(() => {
        this.isBoundaryEditWizardOpened = false;
      });
  }

  private subscribeToBoundaryEditLayerVisibility() {
    this.mapEvents
      .layerVisibilityObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((layerVisibility: { layerId: string; visible: boolean }) => {
        if (layerVisibility.layerId === BOUNDARY_EDITED_LAYER) {
          this.isBoundaryEditWizardOpened = layerVisibility.visible;
        }
      });
  }
}
