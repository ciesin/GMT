import { StepperSelectionEvent } from '@angular/cdk/stepper';
import {
  AfterViewInit,
  Component,
  ElementRef,
  HostBinding,
  Inject,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import {
  AbstractControl,
  AbstractControlOptions,
  FormBuilder,
  FormControl,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatStepper } from '@angular/material/stepper';
import {
  difference,
  distance,
  Feature as TurfFeature,
  intersect,
  MultiPolygon as TurfMultiPolygon,
  Polygon as TurfPolygon,
} from '@turf/turf';
import { NGXLogger } from 'ngx-logger';
import { containsXY } from 'ol/extent';
import { filter, Subject, switchMap, takeUntil } from 'rxjs';
import {
  frequencyOptions,
  hfMaturityOptions,
  hfPrimaryTypeOptions,
  hfTypesOptions,
  mpStatusOptions,
  ownershipOptions,
  OWNERSHIP_PRIVATE,
  OWNERSHIP_PUBLIC,
  transportOptions,
} from 'src/app/constants/hf.constants';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { RasterDataService } from 'src/app/services/raster-data.service';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import {
  applyDayOptions,
  CoverageHf,
  getWeeklyFrequencyValue,
  loadHealthFacility,
} from 'src/app/services/vector_layer/single-hf-processing.service';

import { LocationControlOutput } from '@components/wizard/wizard-location-control/wizard-location-control.component';
import {
  MapEventsService,
  OverlayLayer,
} from '@services/map/base/map-events.service';
import { UserActionLogService } from '@services/user-action-log.service';
import * as _ from 'lodash';
import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  CATCHMENT_STATUS_NOT_STARTED,
  DefaultGeoJSonHealthFacilityProperties,
  FIXED_HEALTH_FACILITY_TYPE,
  Frequency,
  GeoJsonCatchmentItem,
  GeoJsonHealthFacility,
  GeoJsonSettlementPart,
  HealthFacilityCatchmentStatus,
  HealthFacilityLevelOfCare,
  HealthFacilityMaturityLevel,
  HealthFacilityMeansOfTransport,
  HealthFacilityPrimaryType,
  HealthFacilityServices,
  MultiPolygon as MultiPolygonGeoJson,
  OUTREACH_HEALTH_FACILITY_TYPE,
  Polygon as PolygonGeoJson,
  PropertyValue,
  UNKNOWN,
} from 'src/app/utils/server-interfaces/GeoJson';
import { geometryIntersects } from 'src/app/utils/server-interfaces/utils/geom.util';
import { formatPopulation } from 'src/app/utils/string-formatting';
import { SelectOption } from 'src/app/utils/ui/ui-component-interfaces';
import {
  healthFacilities,
  outreach,
} from 'src/app/_shared/map/styles/map-hf-styles';
import { v4 as uuidv4 } from 'uuid';
import {
  handleSplitRequestImpl,
  MergeComponent,
} from '../split-merge-wizard/split-merge-wizard.component';
import {
  callBlockingUiUntilDone,
  disableMapFullScreen,
  enableMapFullScreen,
  isInsideBoundary,
  saveSettlementChanges,
  SettlementChanges,
  WizardComponent,
} from '../wizard-location-control/helper-methods';
import { WizardPolygonEditComponent } from '../wizard-polygon-edit/wizard-polygon-edit.component';

export interface HealthFacilityWizardDialogData {
  isOutreach: boolean;
  outreachParentHealthFacilityId: string | null;
}

//Styles in gmt-pwa/src/less/wizard-popup.less
export const CSS_CLASS_MAP_INTERACTION = 'map-interaction';
export const CSS_CLASS_USER_INPUT = 'user-input';

export const CSS_OVERLAY_WRAPPER_FOR_WIZARDS = 'gmt-wizard-overlay-wrapper';

export const DEFAULT_WIZARD_DIALOG_OPTIONS = {
  panelClass: 'wizard-mat-dialog-panel',
  width: '80em',
  enterAnimationDuration: 0,
  exitAnimationDuration: 0,
  //clicking elsewhere shouldn't close the dialog
  disableClose: true,
  autoFocus: false,

  //to be able to click map
  hasBackdrop: false,
};

//Utility functions to support switching css class
export function switchWizardCssClass(isMapInteraction: boolean) {
  //Find the popup element with the .wizard-mat-dialog-panel class
  const wizards = document.getElementsByClassName(
    DEFAULT_WIZARD_DIALOG_OPTIONS.panelClass
  );
  //hope we have just one
  if (wizards.length != 1) {
    console.error('Expected 1 wizard');
    return;
  }
  const wizardElem = wizards[0];

  if (!isMapInteraction) {
    //user input
    wizardElem.classList.remove(CSS_CLASS_MAP_INTERACTION);
    wizardElem.classList.add(CSS_CLASS_USER_INPUT);
  } else {
    //map interaction
    wizardElem.classList.add(CSS_CLASS_MAP_INTERACTION);
    wizardElem.classList.remove(CSS_CLASS_USER_INPUT);
  }

  console.log(
    `switchWizardCssClass called with isMapInteraction ${isMapInteraction} `
  );
  enableWizardsOverlay(!isMapInteraction);
}

//When the overlay is enabled, no user input will be possible
export function enableWizardsOverlay(isEnabled: boolean) {
  const overlayArray = document.getElementsByClassName(
    'map-interaction-overlay'
  );

  if (overlayArray.length != 1) {
    console.error('Expected 1 overlay item');
    return;
  }

  if (isEnabled) {
    //enable the overlay
    //@ts-ignore
    overlayArray[0].style.visibility = 'visible';
  } else {
    //@ts-ignore
    overlayArray[0].style.visibility = 'hidden';
  }
}

//We want to specifically style the wizards, but not all models, so this class adds a CSS class
//to cdk-overlay-wrapper, the parent of wizard-mat-dialog-panel
//This is the most top level element that is unique to a single material/CDK popup
//We want the wizards to have custom CSS but not other modals (such as the install popup)
export function addWizardCssClassToCdkOverlayWrapper(isWizard: boolean) {
  const wizards = document.getElementsByClassName(
    DEFAULT_WIZARD_DIALOG_OPTIONS.panelClass
  );
  //hope we have just one
  if (wizards.length != 1) {
    console.error('Too many wizard elements found');
    return;
  }
  const wizardElem = wizards[0];

  //Find grand parent
  //This should have the class cdk-overlayer-container
  const overlayPane = wizardElem.parentElement!;

  if (!isWizard) {
    overlayPane.classList.remove(CSS_OVERLAY_WRAPPER_FOR_WIZARDS);
  } else {
    overlayPane.classList.add(CSS_OVERLAY_WRAPPER_FOR_WIZARDS);
  }
}

type OWNERSHIP_STRING =
  | typeof OWNERSHIP_PRIVATE
  | typeof OWNERSHIP_PUBLIC
  | null;

interface CustomCatchmentOption extends SelectOption {
  isOutsideBoundary: boolean;
  boundaryName: string;
}

@Component({
  selector: 'gmt-health-facility-wizard',
  templateUrl: './health-facility-wizard.component.html',
  styleUrls: ['../wizard.less', './health-facility-wizard.component.less'],
  standalone: false
})
export class HealthFacilityWizardComponent
  implements OnInit, OnDestroy, AfterViewInit, WizardComponent, MergeComponent
{
  FORM_KEY_NAME = 'name';
  FORM_KEY_SERVICES = 'services';
  FORM_KEY_LEVEL_OF_CARE = 'type';
  FORM_KEY_FREQUENCY = 'frequency';
  FORM_KEY_TRANSPORT = 'transport';
  FORM_KEY_LATITUDE = 'latitude';
  FORM_KEY_LONGITUDE = 'longitude';
  FORM_KEY_SET_WITH_GPS = 'set_with_gps';
  FORM_KEY_PRIMARY_NAME = 'primaryName';

  FORM_KEY_EQUIPMENT = 'equipment';
  FORM_KEY_STAFF = 'staff';
  FORM_KEY_PRIMARY_TYPE = 'primary_type';
  FORM_KEY_MATURITY = 'maturity';
  FORM_KEY_SYNONYM = 'synonym';
  FORM_KEY_MP_STATUS = 'mp_status';
  FORM_KEY_OWNERSHIP = 'ownership';
  FORM_KEY_PARENT_HEALTH_FACILITY = 'parentHealthFacility';

  ////////////////////////
  //WizardComponent interface
  leftPanelOpenedBeforeSetPoint = false;

  @HostBinding('style.--matStepperHeaderDisplay') matStepperHeaderDisplay =
    'flex';
  ///////////////////

  showStepCatchment = false;
  showStepParentHealthFacility = false;
  showStepDrawSettlement = false;
  showControlSettlementPrimaryName = false;

  drawSettlementHealthFacilityName = '';
  drawSettlementSettlementName = '';

  private isLocationValid = false;
  public lonLat: [number, number] = [NaN, NaN];

  public selectedDays: boolean[] = [
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ];

  splitChanges: SettlementChanges | null = null;

  // Drop down options
  hfTypesOptions = hfTypesOptions.filter((x) => x.value !== UNKNOWN);
  hfPrimaryTypeOptions = hfPrimaryTypeOptions;
  ownershipOptions = ownershipOptions;
  hfMaturityOptions = hfMaturityOptions;
  mpStatusOptions = mpStatusOptions.filter((x) => x.value !== UNKNOWN);
  public mpStatusUnknown = UNKNOWN;
  public mpStatusNotStarted = CATCHMENT_STATUS_NOT_STARTED;
  frequencyOptions = frequencyOptions;

  transportOptions = transportOptions;

  // Drop down options for parent of outreach, initialized with current list of fixed post
  fixedPostHealthFacilities: Array<SelectOption> = [];
  parentHfChoices: Array<CoverageHf> = [];

  //Reactive, strongly typed Form groups
  basicInformationFormGroup = this._formBuilder.group({
    [this.FORM_KEY_NAME]: ['', Validators.required],
    [this.FORM_KEY_SERVICES]: new FormControl<Array<HealthFacilityServices>>(
      ['Routine Immunization'],
      Validators.required
    ),
    [this.FORM_KEY_LEVEL_OF_CARE]: new FormControl<HealthFacilityLevelOfCare>(
      'Primary',
      Validators.required
    ),
    [this.FORM_KEY_OWNERSHIP]: new FormControl<OWNERSHIP_STRING>(
      null,
      Validators.required
    ),
    [this.FORM_KEY_PRIMARY_TYPE]:
      new FormControl<HealthFacilityPrimaryType | null>(null),
  });
  locationFormGroupOptions: AbstractControlOptions = {
    validators: this.validateLocation.bind(this),
  };
  locationFormGroup = this._formBuilder.group(
    {
      [this.FORM_KEY_LATITUDE]: new FormControl<number | null>(
        null,
        Validators.required
      ),
      [this.FORM_KEY_LONGITUDE]: new FormControl<number | null>(
        null,
        Validators.required
      ),
      [this.FORM_KEY_SET_WITH_GPS]: new FormControl<boolean | null>(null),
    },
    this.locationFormGroupOptions
  );

  //For HF Fixed post only
  additionalInfoFormGroup = this._formBuilder.group({
    [this.FORM_KEY_EQUIPMENT]: [this._formBuilder.array([])],
    [this.FORM_KEY_STAFF]: new FormControl<number | null>(null),
    [this.FORM_KEY_MATURITY]:
      new FormControl<HealthFacilityMaturityLevel | null>(null),
    [this.FORM_KEY_SYNONYM]: new FormControl<Array<string>>([]),
    [this.FORM_KEY_MP_STATUS]: new FormControl<HealthFacilityCatchmentStatus>(
      CATCHMENT_STATUS_NOT_STARTED
    ),
    [this.FORM_KEY_FREQUENCY]: new FormControl<Frequency>(UNKNOWN),
    //Note days are stored outside of reactive, as a boolean array
  });

  outreachDetailsFormGroup = this._formBuilder.group({
    [this.FORM_KEY_NAME]: ['', Validators.required],
    //Use a non blank value because we don't want this to prevent validation when we don't show the primary name control
    [this.FORM_KEY_PRIMARY_NAME]: [' ', Validators.required],
    [this.FORM_KEY_FREQUENCY]: new FormControl<Frequency>(UNKNOWN),
    [this.FORM_KEY_TRANSPORT]: new FormControl<
      Array<HealthFacilityMeansOfTransport>
    >([]),
    //outreach uses dayOptions too
  });

  catchmentFormGroup = this._formBuilder.group({});

  outreachParentFormGroup = this._formBuilder.group({
    [this.FORM_KEY_PARENT_HEALTH_FACILITY]: ['', Validators.required],
  });

  //Keeping this outside the form group since we don't need to edit/validate
  //Plus dealing with arrays is ackward, see FORM_KEY_EQUIPMENT
  customCatchmentSelections: Array<CustomCatchmentOption> = [];
  // just to show or hide buttons depending if the user clicked on custom catchment button
  public customCatchmentSelection: boolean = false;
  public customCatchmentSelectionDone: boolean = true;

  @ViewChild('stepper') private myStepper: MatStepper;
  @ViewChild('polygonEditSlum')
  wizardPolygonEditSlum: WizardPolygonEditComponent;
  @ViewChild('polygonEditCatchment')
  wizardPolygonEditCatchment: WizardPolygonEditComponent;

  //@ViewChild(WizardLocationControlComponent) private locationControl: WizardLocationControlComponent;

  private unsubscribe = new Subject();

  constructor(
    public messageService: MessageService,
    public mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,
    public bvService: BoundaryVectorLayersService,
    //private locationService: UserLocationService,
    public userContextService: UserContextService,
    public crudLayerService: CrudLayerService,

    public dialogRef: MatDialogRef<HealthFacilityWizardComponent>,
    //Used to pass data from the component opening this dialog
    @Inject(MAT_DIALOG_DATA) public data: HealthFacilityWizardDialogData,
    private _formBuilder: FormBuilder,
    public logger: NGXLogger,

    //Used to get current size of the popup
    public elementRef: ElementRef,

    //for split merge
    public isLoadingService: IsLoadingService,
    public rasterService: RasterDataService,

    private userActionLogService: UserActionLogService
  ) {}

  ngOnInit(): void {
    this.logger.debug('Data for health wizard', this.data);

    //Keep dialog at the top
    //this.ensureDialogPositionOnWindowResize();

    //initialize flags
    this.showStepParentHealthFacility =
      this.data.isOutreach && !this.data.outreachParentHealthFacilityId;

    //Subscribe to the boundary data to get the parent fixed post choices
    this.loadFixedPostParentChoices();
  }

  private loadFixedPostParentChoices() {
    let dataLoaded = false;

    this.userContextService
      .getCurrentBoundaryObservable()
      .pipe(
        filter((boundary) => !!boundary),
        switchMap((boundary) => {
          return this.bvService.ensureBoundaryLoaded(boundary!.boundaryId);
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe(async () => {
        this.fixedPostHealthFacilities = this.bvService.data
          .getHfFixedPost()
          .filter((healthFacility) =>
            healthFacility.properties.services.includes('Routine Immunization')
          )
          .map((healthFacility) => {
            return {
              label: healthFacility.properties.name,
              value: healthFacility.properties.global_id,
            };
          });

        this.parentHfChoices = this.fixedPostHealthFacilities
          .map((hp) => {
            return loadHealthFacility(
              { logger: this.logger, boundaryData: this.bvService.data },
              hp.value
            )!;
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        //const self = this;
        //Load the data once
        if (!dataLoaded) {
          //We don't support edit so this isn't really doing anything
          this.initializeWizardUIValues();

          dataLoaded = true;
        }
      });
  }

  ngAfterViewInit(): void {
    //to work around ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => {
      enableMapFullScreen(this);

      //Initial step is user input
      switchWizardCssClass(false);

      addWizardCssClassToCdkOverlayWrapper(true);
    }, 1);

    //If the very first step is the location one, we want to go into full screen mode
    if (this.myStepper.selected!.stepControl == this.locationFormGroup) {
      //to work around ExpressionChangedAfterItHasBeenCheckedError
      setTimeout(() => {
        this.loadLocationStep();
      }, 1);
    }
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  public formatPopulation(pop: PropertyValue) {
    return formatPopulation(pop);
  }

  handleCancelDialog() {
    disableMapFullScreen(this);

    this.microplanMapEvents.mapPointLocationConfig.next({
      visible: false,
      requestMapLocation: false,
    });

    this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
    this.resetDrawingState();

    this.dialogRef.close();
  }

  //Because the drawing controls may not be rendered due to ngIf, we reset the state here
  private resetDrawingState() {
    this.mapEvents.removeAllFeatures(OverlayLayer.DRAWN_POLYGONS);

    //Because the view childs might not be enabled, we just do
    //what the polygon editors do on finish drawing; the other
    //wizards always have the polygon edit drawn
    this.microplanMapEvents.drawPolygonConfig.next({
      active: false,
    });
    this.microplanMapEvents.editPolygonConfig.next({
      active: false,
    });
  }

  showHelpDelineateParentSettlement() {
    window.open(
      `${AppConfigService.conf.doc.root}/content/tutorials/40Tutorial4.html#planning-custom-outreach-sessions`,
      '_blank'
    );
  }

  showHelp() {
    window.open(
      `${AppConfigService.conf.doc.root}/content/tutorials/40Tutorial4.html#planning-outreach-sessions-within-urban-areas`,
      '_blank'
    );
  }

  async handleCloseDialog() {
    // if (this.data.isOutreach !this.basicInformationFormGroup.valid) {
    //   this.messageService.add({
    //     summary: "Please fill in the basic information",
    //     severity: 'error'
    //   });
    //   return;
    // }

    if (this.data.isOutreach && !this.outreachParentFormGroup.valid) {
      this.messageService.add({
        summary:
          'Please choose a fixed post health facility to attach to this new outreach site',
        severity: 'error',
      });

      return;
    }

    if (this.data.isOutreach && !this.locationFormGroup.valid) {
      this.messageService.add({
        summary: 'Please choose a location for this outreach facility',
        severity: 'error',
      });
      return;
    }

    if (this.data.isOutreach && !this.outreachDetailsFormGroup.valid) {
      //show errors in red
      this.myStepper.next();
      return;
    }

    if (
      await callBlockingUiUntilDone(
        this,
        async () => await this.saveNewHealthFacility()
      )
    ) {
      this.handleCancelDialog();
    }
  }

  async addCustomCatchmentSelection() {
    // this.messageService.add({
    //   summary: "Click on the map to start drawing a polygon to select settlements",
    //   severity: "info",
    //   key: 'small',
    //   life: 3000
    // });
    this.customCatchmentSelection = true;
    this.customCatchmentSelectionDone = false;
    this.customCatchmentSelections = [];
    enableWizardsOverlay(false);
    //Wait for viewchild to trigger
    setTimeout(() => {
      this.wizardPolygonEditCatchment.initializeDrawing(false);
    }, 10);
  }

  removeCustomCatchmentSelection(index: number) {
    this.customCatchmentSelections.splice(index, 1);
  }

  handleLonLatChange(newLonLatOutput: LocationControlOutput) {
    const newLonLat: [number, number] = [
      newLonLatOutput.lon,
      newLonLatOutput.lat,
    ];
    this.logger.debug('handleLonLatChange in hf wizard', newLonLat);

    //https://github.com/novelt/GMT/issues/2653
    //We allow outreaches to be outside the border
    if (!this.data.isOutreach) {
      if (!this.checkIfPointIsInBoundary(newLonLat)) {
        return;
      }
    }
    //new array to trigger on push change detection
    this.lonLat = newLonLat;
    this.isLocationValid = true;
    this.locationFormGroup
      .get(this.FORM_KEY_LATITUDE)!
      .setValue(newLonLatOutput.lat);
    this.locationFormGroup
      .get(this.FORM_KEY_LONGITUDE)!
      .setValue(newLonLatOutput.lon);
    this.locationFormGroup
      .get(this.FORM_KEY_SET_WITH_GPS)!
      .setValue(newLonLatOutput.set_with_gps);

    //Show the proposed health facility on the map until we actually save it
    this.showHealthFacilityOnMap(newLonLat, true);

    //Turn off location poniter
    this.microplanMapEvents.mapPointLocationConfig.next({
      visible: false,
      requestMapLocation: false,
    });

    if (!this.checkAndHandleSlumCase(newLonLat)) {
      return;
    }

    //If it's not the slum case, then for outreach we still allow the option for a custom catchment
    this.showStepCatchment = this.data.isOutreach;
    this.myStepper.next();
  }

  private checkIfPointIsInBoundary(newLonLat: [number, number]): boolean {
    //Health facility must be in boundary
    if (!isInsideBoundary(this, newLonLat)) {
      this.messageService.add({
        summary: `The chosen point is not within the administrative boundary`,
        severity: 'error',
        key: 'small',
        life: 2000,
      });
      //Re-enable the map location, which was turned off by wizard-location-control when the lon/lat was sent
      this.microplanMapEvents.mapPointLocationConfig.next({
        visible: true,
        requestMapLocation: false,
      });
      return false;
    }
    return true;
  }

  private showHealthFacilityOnMap(
    newLonLat: [number, number],
    clearExisting: boolean
  ) {
    const newHealthFacility = this.buildHealthFacilityGeo();

    if (this.data.isOutreach) {
      newHealthFacility.properties.name = 'New Outreach Location';
    }

    newHealthFacility.geometry.coordinates = newLonLat;
    if (clearExisting) {
      this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
    }
    this.mapEvents.addFeature({
      geo_json: newHealthFacility,
      style: this.data.isOutreach ? outreach : healthFacilities,
      layer: OverlayLayer.NORMAL,
    });
  }

  //Returns false if there was the slum case to handle
  //True if its a normal outreach
  //where we added an outreach in a settlement that had
  //a fixed post hf inside the same settlement
  private checkAndHandleSlumCase(newLonLat: [number, number]): boolean {
    const slumSettlementParent = this.checkSettlementShapeCase(newLonLat);

    if (!slumSettlementParent) {
      return true;
    }
    this.lonLat = newLonLat;
    this.logger.debug('drawing slum settlement!');

    this.showStepDrawSettlement = true;

    //Let the above render the step, then move to it
    setTimeout(() => {
      this.myStepper.next();

      //view child is initialized
      this.wizardPolygonEditSlum.initializeDrawing(false);
    }, 1);

    return false;
  }

  /**
   * Checks validity of the draw polygon.
   *
   * @param drawnPolygon
   * @param selectedSettlementPart
   * @param newLonLat
   * @returns The shape containing the outreach, the shape containing the rest of the settlement
   */
  private checkDrawSlum(
    drawnPolygon: PolygonGeoJson,
    selectedSettlementPart: GeoJsonSettlementPart,
    newLonLat: [number, number]
  ): null | Array<MultiPolygonGeoJson> {
    const intersection: TurfFeature<TurfPolygon | TurfMultiPolygon> | null =
      intersect(drawnPolygon as TurfPolygon, selectedSettlementPart);
    let remainingSettlementGeometry: TurfFeature<
      TurfPolygon | TurfMultiPolygon
    > | null = null;

    // If an intersection exists, then check if there is a second remaining settlement part
    if (intersection) {
      remainingSettlementGeometry = difference(
        selectedSettlementPart,
        intersection
      );
    }

    // If we have a second remaining settlement, then we performed a split
    if (!remainingSettlementGeometry) {
      this.messageService.add({
        summary: 'Shape validation error',
        detail:
          'Your shape does not intersect with the settlement containing the outreach site.',
        severity: 'warning',
      });
      this.lonLat = newLonLat;
      return null;
    }

    //Does what the user drew intersect the outreach site?
    if (
      !geometryIntersects(intersection!, {
        type: 'Point',
        coordinates: newLonLat,
      })
    ) {
      this.messageService.add({
        summary: 'Shape validation error',
        detail:
          'Your shape does not intersect with the outreach site location.',
        severity: 'warning',
      });
      this.lonLat = newLonLat;
      //try again
      return null;
    }

    const polys4326: Array<MultiPolygonGeoJson> = [
      intersection,
      remainingSettlementGeometry,
    ].map((p) => {
      const coordinates =
        p!.geometry.type === 'MultiPolygon'
          ? p!.geometry.coordinates
          : [p!.geometry.coordinates];
      return {
        type: 'MultiPolygon',
        coordinates: coordinates,
      } as MultiPolygonGeoJson;
    });

    return polys4326;
  }

  private async handleDrawSlumSettlementPartEnd(
    selectedSettlementPart: GeoJsonSettlementPart,
    newLonLat: [number, number],
    drawnPolygon: PolygonGeoJson
  ): Promise<boolean> {
    this.userActionLogService.addUserActionDescription(
      `handleDrawSlumSettlementPartEnd begin ${newLonLat}`
    );
    this.logger.debug('handleDrawEnd settlement control');
    // Get the drawn polygon and the intersection with settlements

    const polys4326: Array<MultiPolygonGeoJson> = this.checkDrawSlum(
      drawnPolygon,
      selectedSettlementPart,
      newLonLat
    )!;

    if (!polys4326) {
      this.userActionLogService.addUserActionDescription(
        `handleDrawSlumSettlementPartEnd polys4326 false ${!polys4326}`
      );
      //we already in theory warned the user that something is wrong, so short circuit and return
      return false;
    }
    // this.disableDrawing();
    this.crudLayerService.suppressUserInterfaceUpdates.next(true);
    this.isLoadingService.setLoading(true);

    try {
      const changes = await handleSplitRequestImpl(this, {
        settlementPartId: selectedSettlementPart.properties.global_id,
        polys: polys4326,
      });

      //One of the new settlement parts should intersect the outreach
      if (
        !geometryIntersects(changes.partsToCreate[0], {
          type: 'Point',
          coordinates: newLonLat,
        })
      ) {
        //this was already checked, and the first part should be the one we drew
        this.logger.error(
          'Expected first settlement part to intersect outreach site'
        );
        this.userActionLogService.addUserActionDescription(
          `handleDrawSlumSettlementPartEnd 'Expected first settlement part to intersect outreach site'`
        );
        throw new Error('Internal Geometry error');
      }

      //Find the settlement name that points to the above part
      let settlementName = [
        ...changes.namesToCreate,
        ...changes.namesToUpdate,
      ].find(
        (sn) =>
          sn.properties.settlement_part ==
            changes.partsToCreate[0].properties.global_id &&
          sn.properties.is_primary
      );

      if (!settlementName) {
        //this was already checked, and the first part should be the one we drew
        this.logger.error(
          'Expected first settlement part to have a primary name'
        );

        this.userActionLogService.addUserActionDescription(
          'Expected first settlement part to have a primary name'
        );
        throw new Error('Internal Geometry error');
      }

      //create the ri inclusion item for the created outreach
      this.customCatchmentSelections.push({
        label: settlementName.properties.name,
        value: settlementName.properties.global_id,
        //This won't impact anything, since the custom catchment is outside boundary is only
        //displayed for the custom catchment, not the slum case
        isOutsideBoundary: false,
        boundaryName: '',
      });

      //This only saves the new settlement part / split; after the wizard completes we'll save the outreach with custom catchment

      //Don't save just yet
      this.splitChanges = changes;
      if (this.splitChanges.namesToCreate.length > 0) {
        this.showControlSettlementPrimaryName = true;
        this.outreachDetailsFormGroup
          .get(this.FORM_KEY_PRIMARY_NAME)!
          .setValue(this.splitChanges.namesToCreate[0].properties.name);
      }
      this.showStepDrawSettlement = false;
      // disableMapFullScreen(this);
      // this.myStepper.next();
    } finally {
      this.crudLayerService.suppressUserInterfaceUpdates.next(false);
      this.microplanMapEvents.setSelectedSettlementParts([]);
      this.microplanMapEvents.triggerCatchmentRendering();

      this.isLoadingService.setLoading(false);
    }

    return true;
  }

  /**
   * Checks if the user needs to split the settlement because they are trying to create
   * an outreach in a settlement part that is already covered by a fixed post health facility
   * @param coordinates
   * @returns
   */
  private checkSettlementShapeCase(
    coordinates: [number, number]
  ): GeoJsonSettlementPart | null {
    //only applies to outreach
    if (!this.data.isOutreach) {
      return null;
    }

    //Are we in the catchment of something?
    //We should be in a settlement that is in a fixed post health facility, note we add another restriction that
    //this must be the same parent they selected
    const parentHfId = this.outreachParentFormGroup.get(
      this.FORM_KEY_PARENT_HEALTH_FACILITY
    )!.value;

    const parentHf = this.bvService.data.hfMap.get(parentHfId);

    if (_.isNil(parentHf)) {
      this.logger.warn('Parent HF not found!');
      return null;
    }

    //Do distance check first
    const parentChildDistance = distance(parentHf, coordinates, {
      units: 'meters',
    });

    if (parentChildDistance > 2000) {
      this.logger.debug(
        `Distance between parent is ${parentChildDistance} meters, ignoring`
      );
      return null;
    }

    //Search all settlement parts that geospatially contain the proposed outreach coordinates
    const spSlumParent = this.bvService.data.spList.find((sp) => {
      //Ignore any sps that are of special type "auto_split_parent" which are used to keep the settlement part history
      if (sp.properties.split_type == 'auto_split_parent') {
        return false;
      }

      //Fast checks with bounding box
      if (!containsXY(sp.properties.bbox, coordinates[0], coordinates[1])) {
        return false;
      }

      if (
        !containsXY(
          sp.properties.bbox,
          parentHf.geometry.coordinates[0],
          parentHf.geometry.coordinates[1]
        )
      ) {
        return false;
      }

      const outreachIntersects = geometryIntersects(sp.geometry, {
        type: 'Point',
        coordinates,
      });

      if (!outreachIntersects) {
        return false;
      }

      const fixedPostParentIntersects = geometryIntersects(
        sp.geometry,
        parentHf.geometry
      );

      if (!fixedPostParentIntersects) {
        return false;
      }

      const primaryNames = this.bvService.data.getPrimaryNamesForSettlementPart(
        sp.properties.global_id,
        false
      );
      this.drawSettlementSettlementName =
        primaryNames.length > 0
          ? primaryNames[0].properties.name
          : sp.properties.settlement_name;

      return true;
    })!;

    return spSlumParent;
  }

  private validateLocation(_control: AbstractControl): ValidationErrors | null {
    //    this.logger.info(`validateLocation`, this);
    this.logger.debug(`validateLocation`, this.isLocationValid);

    if (!this.isLocationValid) {
      this.logger.debug(`validateLocation NO`);
      return {
        outOfBoundary: true,
      };
    }

    this.logger.debug(`validateLocation YES`);
    return null;
  }

  handleStepChange(stepEvent: StepperSelectionEvent) {
    this.logger.debug('step change', stepEvent);
    if (stepEvent.selectedStep.stepControl === this.locationFormGroup) {
      this.loadLocationStep();
      //Intentionally not early returning
      switchWizardCssClass(true);
    } else {
      switchWizardCssClass(false);
    }

    if (
      stepEvent.selectedStep.stepControl === this.outreachParentFormGroup ||
      stepEvent.selectedStep.stepControl === this.locationFormGroup
    ) {
      //Changing location again so we want to reset the draw state
      this.showStepDrawSettlement = false;
      //This is only shown for non slum cases with outreach (so never fp)
      this.showStepCatchment = false;
    }
    //We could be switching around, reset any drawing that is taking place
    this.resetDrawingState();
  }

  private loadLocationStep() {
    this.microplanMapEvents.mapPointLocationConfig.next({
      visible: true,
      requestMapLocation: false,
    });
    //Clear any drawing state too
    this.microplanMapEvents.drawPolygonConfig.next({
      active: false,
    });
    this.microplanMapEvents.editPolygonConfig.next({
      active: false,
    });

    this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);

    this.splitChanges = null;

    const newLat = this.locationFormGroup.get(this.FORM_KEY_LATITUDE)!.value;
    const newLon = this.locationFormGroup.get(this.FORM_KEY_LONGITUDE)!.value;

    //If ever we use the wizard to edit, this loads the location
    if (_.isFinite(newLon) && _.isFinite(newLat)) {
      this.microplanMapEvents.mapPointLocationState.next({
        latitude: newLat,
        longitude: newLon,
        fromMap: false,
      });
    }
  }

  private buildHealthFacilityGeo(): GeoJsonHealthFacility {
    let coordinates: [number, number] = [] as unknown as [number, number];

    const newGeoJson: GeoJsonHealthFacility = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates,
      },
      properties: {
        ...DefaultGeoJSonHealthFacilityProperties,
        global_id: uuidv4(),
        name: '',
        equipment: [],
        services: ['Routine Immunization'],

        type: FIXED_HEALTH_FACILITY_TYPE,
        boundary_polygon:
          this.bvService.boundaryInfo.boundary.properties.global_id,
        version_id: null,
      },
    };

    this.applyFormValues(newGeoJson);
    return newGeoJson;
  }

  private applyFormValues(healthFacility: GeoJsonHealthFacility) {
    //Validation can happen before the form groups are even loaded, this will silently
    //return.  Validation reruns later, so no worries
    if (!this.basicInformationFormGroup || !this.additionalInfoFormGroup) {
      return;
    }

    if (this.data.isOutreach) {
      healthFacility.properties.name = this.outreachDetailsFormGroup.get(
        this.FORM_KEY_NAME
      )!.value;
    } else {
      healthFacility.properties.name = this.basicInformationFormGroup.get(
        this.FORM_KEY_NAME
      )!.value;
    }
    //healthFacility.properties.services = this.basicInformationFormGroup.get(this.FORM_KEY_SERVICES)!.value;
    healthFacility.properties.level_of_care =
      this.basicInformationFormGroup.get(this.FORM_KEY_LEVEL_OF_CARE)!.value;
    healthFacility.properties.primary_type = this.basicInformationFormGroup.get(
      this.FORM_KEY_PRIMARY_TYPE
    )!.value;
    healthFacility.properties.maturity_level = this.additionalInfoFormGroup.get(
      this.FORM_KEY_MATURITY
    )!.value;

    //Bug fix -- in the case of outreach, the above might not be defined.  We need to give it a value because
    //it is not nullable in the database
    if (!healthFacility.properties.maturity_level) {
      healthFacility.properties.maturity_level = UNKNOWN;
    }
    if (!healthFacility.properties.level_of_care) {
      healthFacility.properties.level_of_care = UNKNOWN;
    }
    if (!healthFacility.properties.primary_type) {
      healthFacility.properties.primary_type = UNKNOWN;
    }

    if (this.data.isOutreach) {
      healthFacility.properties.frequency = this.outreachDetailsFormGroup.get(
        this.FORM_KEY_FREQUENCY
      )!.value;
    } else {
      healthFacility.properties.frequency = this.additionalInfoFormGroup.get(
        this.FORM_KEY_FREQUENCY
      )!.value;
    }
    healthFacility.properties.transport = this.outreachDetailsFormGroup.get(
      this.FORM_KEY_TRANSPORT
    )!.value;

    //private can be null if unknown
    if (
      this.basicInformationFormGroup.get(this.FORM_KEY_OWNERSHIP)!.value ==
      OWNERSHIP_PRIVATE
    ) {
      healthFacility.properties.private = true;
    } else if (
      this.basicInformationFormGroup.get(this.FORM_KEY_OWNERSHIP)!.value ==
      OWNERSHIP_PUBLIC
    ) {
      healthFacility.properties.private = false;
    }

    healthFacility.properties.synonyms = this.additionalInfoFormGroup.get(
      this.FORM_KEY_SYNONYM
    )!.value;
    healthFacility.properties.mp_status = this.additionalInfoFormGroup.get(
      this.FORM_KEY_MP_STATUS
    )!.value;

    const newLat = this.locationFormGroup.get(this.FORM_KEY_LATITUDE)!.value;
    const newLon = this.locationFormGroup.get(this.FORM_KEY_LONGITUDE)!.value;
    const setWithGps = this.locationFormGroup.get(
      this.FORM_KEY_SET_WITH_GPS
    )!.value;
    if (_.isFinite(newLat) && _.isFinite(newLon)) {
      const coordinates: [number, number] = [newLon, newLat];
      healthFacility.geometry = {
        type: 'Point',
        coordinates,
      };
      healthFacility.properties.set_with_gps = setWithGps === true;
    }

    if (this.data.isOutreach) {
      healthFacility.properties.type = OUTREACH_HEALTH_FACILITY_TYPE;
    }

    //Do this afterwards, this means we have the parent health facility in a list
    if (healthFacility.properties.type == OUTREACH_HEALTH_FACILITY_TYPE) {
      healthFacility.properties.parent = this.outreachParentFormGroup.get(
        this.FORM_KEY_PARENT_HEALTH_FACILITY
      )!.value;
    }

    const totalDaysOpen = applyDayOptions(healthFacility, this.selectedDays);

    if ((healthFacility.properties.frequency as string) == 'weekly') {
      let newFrequency: Frequency = getWeeklyFrequencyValue(totalDaysOpen);
      healthFacility.properties.frequency = newFrequency;
    }
  }

  private async saveNewHealthFacility(): Promise<boolean> {
    const actionId = uuidv4();

    this.logger.info('Saving existing one...');
    const healthFacility = this.buildHealthFacilityGeo();

    await this.crudLayerService.createItem(
      'health_facility__point',
      healthFacility,
      true,
      false,
      actionId
    );

    if (this.splitChanges) {
      if (this.splitChanges.namesToCreate.length > 0) {
        this.splitChanges.namesToCreate[0].properties.name =
          this.outreachDetailsFormGroup.get(this.FORM_KEY_PRIMARY_NAME)!.value;
      }

      await saveSettlementChanges(this, this.splitChanges, actionId);

      this.userActionLogService.addUserActionDescription('Saved split changes');
    }

    //Handle custom catchment

    let newSettlementParts = new Set<string>(
      this.customCatchmentSelections.map(
        (settlementNameSelection) =>
          this.bvService.data.snMap.get(settlementNameSelection.value)!
            .properties.settlement_part!
      )
    );

    if (newSettlementParts.size > 0) {
      await this.saveCrudActionsForNewHealthFacility(
        healthFacility,
        actionId,
        newSettlementParts
      );
    } else {
      this.logger.info('Not changing custom catchment!');
    }

    //Get the HF that is involved in the exclusion
    await this.bvService.computeAllCatchmentAssignmentsForHF(
      healthFacility,
      actionId,
      true
    );

    this.messageService.add({
      summary:
        healthFacility.properties.type === 'outreach'
          ? 'Outreach created'
          : 'Health Facility created',
    });
    return true;
  }

  private async saveCrudActionsForNewHealthFacility(
    healthFacility: GeoJsonHealthFacility,
    actionId: string,
    newSettlementParts: Set<string>
  ) {
    this.logger.info('Changing custom catchment!');

    for (const settlementPart of newSettlementParts) {
      const includeEntry: GeoJsonCatchmentItem = {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [0, 0],
        },
        properties: {
          global_id: uuidv4(),
          //A non generated entry is 'owned' by the HF and a generated one is owned by the settlement part
          boundary_polygon: healthFacility.properties.boundary_polygon,
          health_facility_point: healthFacility.properties.global_id,
          population_perc: 100.0,
          settlement_part: settlementPart,
          version_id: 0,
          type: 'include',
        },
      };

      await this.crudLayerService.createItem(
        'ri__catchment_item',
        includeEntry,
        false,
        false,
        actionId
      );
    }

    await this.crudLayerService.updateObservableAfterCrud('ri__catchment_item');
  }

  private initializeWizardUIValues() {
    if (this.data.isOutreach) {
      this.outreachParentFormGroup
        .get(this.FORM_KEY_PARENT_HEALTH_FACILITY)!
        .setValue(this.data.outreachParentHealthFacilityId);
    }

    //debugging; help with settlement wizard dev
    if (AppConfigService.ENABLE_WIZARD_DEBUG) {
      (async () => {
        this.outreachParentFormGroup
          .get(this.FORM_KEY_PARENT_HEALTH_FACILITY)!
          .setValue('ada99913-839b-48ec-89b4-06ac35da4fb6');
        //this.basicInformationFormGroup.get(this.FORM_KEY_NAME).setValue("bob hopital");
        //this.outreachDetailsFormGroup.get(this.FORM_KEY_NAME).setValue("bob outreach");

        await new Promise((p) => setTimeout(p, 1));
        this.myStepper.next();

        this.handleLonLatChange({
          lon: 7.140610570955309,
          lat: 7.60979059881852,
          set_with_gps: true,
        });
      })();

      setTimeout(() => {
        //this.handleLonLatChange([6.962101740740603, 8.739480501162959]);

        setTimeout(() => {
          //this.myStepper.next();
        }, 1);
      }, 1);
      //this.handleSetPoint();
    }
    return;
    //Assume current location is valid
  }

  public async finishSlumCasePolygonDrawing(drawnPolygon: PolygonGeoJson) {
    //make sure outreach being created still visible
    this.showHealthFacilityOnMap(this.lonLat!, false);

    //This executes when user hits next on the showStepDrawSettlement step, so this should be true
    console.assert(this.showStepDrawSettlement);

    const selectedSettlementPart = this.checkSettlementShapeCase(this.lonLat!);
    //The above returns null if there was a problem

    //This will throw if there is a problem
    const success = await this.handleDrawSlumSettlementPartEnd(
      selectedSettlementPart!,
      this.lonLat!,
      drawnPolygon
    );

    //User needs to edit / redraw their polygon
    if (!success) {
      return;
    }

    //no exception, go to the next step
    this.myStepper.next();
  }

  updateCustomCatchmentShape(drawnPolygon: PolygonGeoJson) {
    this.customCatchmentSelectionDone = true;

    //select which settlement names intersect the polygon the user drew
    //Since this can trigger on edits too, we start over
    this.customCatchmentSelections = [];

    const currentBoundaryId = this.bvService.data.boundaryId;

    const selectedSettlementParts = this.bvService.data.spList.filter(
      (settlementPart) => {
        return geometryIntersects(settlementPart, drawnPolygon);
      }
    );

    //Find the settlement that matches where the user clicked
    for (const selectedSettlementPart of selectedSettlementParts) {
      //Add all names of that
      const names = this.bvService.data.getPrimaryNamesForSettlementPart(
        selectedSettlementPart.properties.global_id,
        true
      );

      for (const settlementName of names) {
        if (
          this.customCatchmentSelections.some(
            (cs) => cs.value == settlementName.properties.global_id
          )
        ) {
          continue;
        }
        const settlementNameBoundary = this.bvService.data.bMap.get(
          settlementName.properties.boundary_polygon
        );

        this.customCatchmentSelections.push({
          label: settlementName.properties.name,
          value: settlementName.properties.global_id,
          isOutsideBoundary:
            settlementName.properties.boundary_polygon != currentBoundaryId,
          boundaryName: settlementNameBoundary!.properties.name,
        });
      }
    }

    this.customCatchmentSelections.sort((a, b) => {
      return a.label.localeCompare(b.label);
    });

    this.microplanMapEvents.setSelectedSettlementParts(
      this.customCatchmentSelections.map((selection) => selection.value)
    );
  }
}
