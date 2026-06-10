import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostBinding,
  Inject,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { FormBuilder, FormControl } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatStepper } from '@angular/material/stepper';
import {
  addWizardCssClassToCdkOverlayWrapper,
  switchWizardCssClass,
} from '@components/wizard/health-facility-wizard/health-facility-wizard.component';
import { WizardPolygonEditComponent } from '@components/wizard/wizard-polygon-edit/wizard-polygon-edit.component';
import {
  MapEventsService,
  OverlayLayer,
} from '@services/map/base/map-events.service';
import { NGXLogger } from 'ngx-logger';
import { Subject } from 'rxjs';
import {
  disableMapFullScreen,
  enableMapFullScreen,
  WizardComponent,
} from 'src/app/components/wizard/wizard-location-control/helper-methods';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import {
  BoundaryEditService,
  BoundaryUpdateData,
} from 'src/app/services/vector_layer/edit/boundary-edit.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  GeoJsonBoundaryEdited,
  Polygon as GeoJsonPolygon,
} from 'src/app/utils/server-interfaces/GeoJson';
import { geometryIntersects } from 'src/app/utils/server-interfaces/utils/geom.util';
import { BOUNDARY_EDITED_LAYER } from 'src/app/utils/server-interfaces/VectorLayerName';

@Component({
    selector: 'boundary-edit',
    templateUrl: './boundary-edit.component.html',
    styleUrls: [
        '../../../components/wizard/wizard.less',
        './boundary-edit.component.less'
    ],
    standalone: false
})
export class BoundaryEditComponent
  implements OnInit, AfterViewInit, WizardComponent
{
  // WizardComponent
  @Output() savedEdit = new EventEmitter<boolean>();
  public loading = false;
  public isDrawingCompleted = false;
  public FORM_KEY_POLYGON_MERGE_MODE_UNION = 'POLYGON_MERGE_MODE_UNION';
  public FORM_KEY_COMMENT = 'COMMENT';
  public descriptionFormGroup = this.formBuilder.group({
    [this.FORM_KEY_POLYGON_MERGE_MODE_UNION]: new FormControl<boolean>(true),
    [this.FORM_KEY_COMMENT]: new FormControl<string | null>(null),
  });
  public editMode: boolean = false;
  public currentEditedBoundary: GeoJsonBoundaryEdited;

  leftPanelOpenedBeforeSetPoint = false; // WizardComponent
  @HostBinding('style.--matStepperHeaderDisplay') matStepperHeaderDisplay =
    'flex'; // WizardComponent

  @ViewChild('stepper') private myStepper: MatStepper;

  @ViewChild('polygonEdit') wizardPolygonEdit: WizardPolygonEditComponent;

  private unsubscribe = new Subject();

  constructor(
    public bvService: BoundaryVectorLayersService,
    public crudLayerService: CrudLayerService, // WizardComponent
    private dialogRef: MatDialogRef<BoundaryEditComponent>,
    private formBuilder: FormBuilder,
    public logger: NGXLogger,
    public mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,
    private messageService: MessageService,
    public userContextService: UserContextService, // WizardComponent
    public isLoadingService: IsLoadingService, // WizardComponent
    public elementRef: ElementRef, // WizardComponent
    private boundaryEditService: BoundaryEditService,
    @Inject(MAT_DIALOG_DATA) public data: GeoJsonBoundaryEdited
  ) {}

  ngOnInit() {
    this.initializeUIValues();
  }

  ngAfterViewInit() {
    //to work around ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => {
      enableMapFullScreen(this);
      //Consider the entire wizard map interaction
      switchWizardCssClass(true);

      addWizardCssClassToCdkOverlayWrapper(true);

      this.initializeDrawingStep(false);
    }, 1);
  }

  initializeDrawingStep(drawNewShape: boolean) {
    //We also will be drawing the edited shape, so remove any drawn features that may have added the boundary-issues.component
    this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);

    if (!drawNewShape && this.data && this.data.geometry) {
      const polygonToEdit: GeoJsonPolygon = {
        coordinates: this.data.properties.drawn_geometry!.coordinates[0],
        type: 'Polygon',
      };
      this.wizardPolygonEdit.initializeEditExistingPolygon(polygonToEdit);
    } else {
      this.wizardPolygonEdit.initializeDrawing(false);
    }

    //In all cases, make sure the edit layer is visible
    this.mapEvents.triggerLayerVisibilityChange(BOUNDARY_EDITED_LAYER, true);
  }

  initializeCommentStep(drawnPolygon: GeoJsonPolygon) {
    this.logger.info('Drawn polygon done, initializing comment step');
    this.boundaryEditService.drawnPolygon = drawnPolygon;
    this.validateDrawnShape();

    this.logger.info(
      `Drawn polygon done, validated? ${this.isDrawingCompleted}`
    );
    if (this.isDrawingCompleted) {
      //Need the completed part to get parsed first
      setTimeout(() => {
        this.myStepper.next();
      }, 10);
    }
    // do not disable drawing as it deletes currently drawn polygon
    // if (this.isDrawingCompleted) {
    //   this.mapEvents.drawPolygonConfig.next({
    //     active: false
    //   });
    // }
  }

  handleCancelDialog() {
    this.wizardPolygonEdit.finishedDrawing();

    //the boundary edit can be opened either from the map button or from the boundary correction in the left hand panel
    //While it was designed to draw the edit boundary when the boundary correction is open, it would be pretty hacky for this component
    //to be coupled to who opened it.

    //In any case, when this dialog opens, the layer will be made visible, so at least when a polygon is being edited they will see this layer
    this.mapEvents.triggerLayerVisibilityChange(BOUNDARY_EDITED_LAYER, false);

    disableMapFullScreen(this);
    this.dialogRef.close();
  }

  showHelp() {
    window.open(
      `${AppConfigService.conf.doc.root}/content/tutorials/30Tutorial3.html#boundary-correction`,
      '_blank'
    );
  }

  async saveEdits() {
    this.loading = true;
    try {
      let union = this.descriptionFormGroup.get(
        this.FORM_KEY_POLYGON_MERGE_MODE_UNION
      )!.value;
      const comment = this.descriptionFormGroup.get(
        this.FORM_KEY_COMMENT
      )!.value;
      let data: BoundaryUpdateData = { comment, union };
      if (this.data?.properties?.global_id) {
        data.global_id = this.data.properties.global_id;
      }
      await this.boundaryEditService.saveEditSuggestion(data);
      this.savedEdit.emit(true);
      this.handleCancelDialog();
    } catch (e) {
      this.logger.error(e);
      this.loading = false;
    }
  }

  private initializeUIValues() {
    this.descriptionFormGroup.get(this.FORM_KEY_COMMENT)!.setValue('');

    if (this.data?.properties?.comment) {
      this.descriptionFormGroup
        .get(this.FORM_KEY_COMMENT)!
        .setValue(this.data.properties.comment);
    } else {
      this.currentEditedBoundary =
        this.boundaryEditService.getCurrentEditedBoundary()!;
      this.descriptionFormGroup
        .get(this.FORM_KEY_COMMENT)!
        .setValue(this.currentEditedBoundary.properties.comment);
    }
    if (this.data?.properties?.union) {
      this.descriptionFormGroup
        .get(this.FORM_KEY_POLYGON_MERGE_MODE_UNION)!
        .setValue(this.data.properties.union);
    }
  }

  private validateDrawnShape() {
    this.isDrawingCompleted = false;

    if (!this.boundaryEditService.drawnPolygon) {
      this.logger.error(
        'this.boundaryEditService.drawnPolygon should never be null'
      );
      return;
    }

    const currentBoundary = this.bvService.boundaryInfo.boundary;
    let currentEditedBoundary = this.bvService.data.bEditedList.find(
      (b) => b.properties.global_id == currentBoundary.properties.global_id
    );
    const intersects = geometryIntersects(
      currentEditedBoundary!.geometry,
      this.boundaryEditService.drawnPolygon
    );
    if (!intersects) {
      this.messageService.add({
        summary: 'Shape validation error',
        detail:
          'Your shape does not intersect with the boundary you are trying to edit.',
        severity: 'warning',
      });
      this.isDrawingCompleted = false;
    } else {
      this.isDrawingCompleted = true;
    }
  }
}
