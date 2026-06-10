import {
  Component,
  ElementRef,
  EventEmitter,
  Inject,
  OnInit,
  Output,
} from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import {
  addWizardCssClassToCdkOverlayWrapper,
  switchWizardCssClass,
} from '@components/wizard/health-facility-wizard/health-facility-wizard.component';
import { LocationControlOutput } from '@components/wizard/wizard-location-control/wizard-location-control.component';
import {
  MapEventsService,
  OverlayLayer,
} from '@services/map/base/map-events.service';
import { NGXLogger } from 'ngx-logger';
import {
  disableMapFullScreen,
  enableMapFullScreen,
  WizardComponent,
} from 'src/app/components/wizard/wizard-location-control/helper-methods';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';

/*
This component is when we just want to edit the location outside of a wizard,
like in HF or settlement details

Search code for LocationEditWizardComponent /
*/

@Component({
  selector: 'location-edit-wizard',
  templateUrl: './location-edit-wizard.component.html',
  styleUrls: ['./location-edit-wizard.component.less'],
  standalone: false
})
export class LocationEditWizardComponent implements WizardComponent, OnInit {
  @Output() location = new EventEmitter<LocationControlOutput>();
  public FORM_KEY_LATITUDE = 'latitude';
  public FORM_KEY_LONGITUDE = 'longitude';
  public FORM_KEY_SET_WITH_GPS = 'set_with_gps';
  public currentLocation: LocationControlOutput | null = null;
  // public locationFormGroup = this.formBuilder.group({
  //   [this.FORM_KEY_LATITUDE]: new FormControl<number>(null, Validators.required),
  //   [this.FORM_KEY_LONGITUDE]: new FormControl<number>(null, Validators.required),
  // });

  leftPanelOpenedBeforeSetPoint = false;

  //this isn't a map stepper, so this is just to implement WizardComponent
  matStepperHeaderDisplay = 'dummy';

  constructor(
    public mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,
    public dialogRef: MatDialogRef<LocationEditWizardComponent>,
    //Used to get current size of the popup
    public elementRef: ElementRef,
    public userContextService: UserContextService,
    public bvService: BoundaryVectorLayersService,
    public crudLayerService: CrudLayerService,
    public isLoadingService: IsLoadingService,
    public logger: NGXLogger,
    @Inject(MAT_DIALOG_DATA) public currentPosition: LocationControlOutput
  ) {
    this.currentLocation = currentPosition;
    // this.locationFormGroup.get(this.FORM_KEY_LATITUDE).setValue(currentPosition.lat);
    // this.locationFormGroup.get(this.FORM_KEY_LONGITUDE).setValue(currentPosition.lng);
    this.microplanMapEvents.mapPointLocationConfig.next({
      visible: true,
      requestMapLocation: false,
    });
    this.microplanMapEvents.mapPointLocationState.next({
      fromMap: false,
      latitude: currentPosition.lat,
      longitude: currentPosition.lon,
    });
  }

  public async ngOnInit() {
    await new Promise((p) => setTimeout(p, 1));
    enableMapFullScreen(this);
    addWizardCssClassToCdkOverlayWrapper(true);

    //Consider the entire wizard map interaction
    switchWizardCssClass(true);
  }

  public handleWizardCancel() {
    // if (this.isSetPoint || this.isDrawBoundaries) {
    //       disableMapFullScreen(this);
    //     }
    this.microplanMapEvents.mapPointLocationConfig.next({
      visible: false,
      requestMapLocation: false,
    });
    this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
    disableMapFullScreen(this);
    this.dialogRef.close();
  }

  async handleLocationChange(location: LocationControlOutput) {
    this.location.next(location);

    //Once user has chosen, we are done, close the dialog
    this.handleWizardCancel();
  }
}
