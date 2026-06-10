import { Component, OnInit } from '@angular/core';
import _ from 'lodash';
import cloneDeep from 'lodash.clonedeep';
import { NGXLogger } from 'ngx-logger';
import { v4 as uuidv4 } from 'uuid';

import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import {
  MapEventsService,
  OverlayLayer,
  ZoomMode,
} from '@services/map/base/map-events.service';
import { operatingHoursToDays } from '@services/vector_layer/single-hf-processing.service';
import { Subject, takeUntil } from 'rxjs';
import { callBlockingUiUntilDone } from 'src/app/components/wizard/wizard-location-control/helper-methods';
import {
  HealthFacilityOwnership,
  hfPrimaryTypeOptions,
  hfTypesOptions,
  mpStatusOptions,
  ownershipOptions,
  RI_SERVICE,
  servicesOptions,
} from 'src/app/constants/hf.constants';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import {
  BoundaryVectorLayersService,
  DropdownBoundary,
} from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { UserLocationService } from 'src/app/services/map/user-location.service';
import { ConfirmationService } from 'src/app/services/shared/notifications/confirmation.service';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { RIRouteService } from 'src/app/services/shared/route/ri-route.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { SingleHfService } from 'src/app/services/vector_layer/single-hf.service';
import { getExtentedBoundingBoxForFeatures } from 'src/app/utils/coords';
import {
  CATCHMENT_STATUS_NOT_STARTED,
  Frequency,
  GeoJsonHealthFacility,
  HealthFacilityCatchmentStatus,
  HealthFacilityLevelOfCare,
  HealthFacilityPrimaryType,
  HealthFacilityServices,
  UNKNOWN,
} from 'src/app/utils/server-interfaces/GeoJson';
import { boundaryStyle } from 'src/app/_shared/map/styles/map-boundary-styles';

@Component({
  selector: 'facility-details-content',
  templateUrl: './facility-details-content.component.html',
  styleUrls: ['./facility-details-content.component.less'],
  standalone: false
})
export class FacilityDetailsContentComponent implements OnInit {
  public hf: GeoJsonHealthFacility;

  //For text fields that we save periodically, we don't want to overwrite values as they type
  //but we DO want to reload if we are loading a new health facility
  private lastHfGlobalIdLoaded: string | null = null;
  public editing: boolean = false;
  public isOutreach: boolean = false;
  public outsideBoundary: boolean;
  public selectedBoundary!: string; // DropdownBoundary
  public surroundingBoundaryOptions: Array<DropdownBoundary> = [];
  public FORM_KEY_NAME = 'name';
  public FORM_KEY_COMMENTS = 'comments';

  public FORM_KEY_LEVEL_OF_CARE = 'type';
  public FORM_KEY_OWNERSHIP = 'ownership';
  public FORM_KEY_LATITUDE = 'latitude';
  public FORM_KEY_LONGITUDE = 'longitude';
  public FORM_KEY_EQUIPMENT = 'equipment';
  public FORM_KEY_STAFF = 'staff';
  public FORM_KEY_PRIMARY_TYPE = 'primary_type';
  public FORM_KEY_SYNONYM = 'synonym';
  public FORM_KEY_MP_STATUS = 'mp_status';
  public FORM_KEY_BOUNDARY = 'surrounding_boundary';
  public FORM_KEY_FREQUENCY = 'frequency';

  public hfTypesOptions = hfTypesOptions.filter((x) => x.value !== UNKNOWN);
  public ownershipOptions = ownershipOptions;
  public hfPrimaryTypeOptions = hfPrimaryTypeOptions;
  public mpStatusOptions = mpStatusOptions.filter((x) => x.value !== UNKNOWN);
  public mpStatusUnknown = UNKNOWN;
  public mpStatusNotStarted = CATCHMENT_STATUS_NOT_STARTED;
  public servicesOptions = servicesOptions;
  //public frequencyOptions = frequencyOptions;
  public selectedDays: boolean[] = [
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ];
  public daysDisabled = false;
  public additionalInfoFormGroup = this.formBuilder.group({
    [this.FORM_KEY_NAME]: ['', Validators.required],
    [this.FORM_KEY_COMMENTS]: new FormControl<string>(''),
    [this.FORM_KEY_EQUIPMENT]: [this.formBuilder.array([])],
    [this.FORM_KEY_OWNERSHIP]: new FormControl<string | null>(null),
    [this.FORM_KEY_LEVEL_OF_CARE]: new FormControl<HealthFacilityLevelOfCare>(
      'Primary'
    ),
    [this.FORM_KEY_STAFF]: new FormControl<number | null>(null),
    [this.FORM_KEY_PRIMARY_TYPE]:
      new FormControl<HealthFacilityPrimaryType | null>(null),
    [this.FORM_KEY_SYNONYM]: new FormControl<Array<string>>([]),
    [this.FORM_KEY_MP_STATUS]: new FormControl<HealthFacilityCatchmentStatus>(
      CATCHMENT_STATUS_NOT_STARTED
    ),
    [this.FORM_KEY_BOUNDARY]: new FormControl<string>(''),
    [this.FORM_KEY_LATITUDE]: new FormControl<number | null>(
      null,
      Validators.required
    ),
    [this.FORM_KEY_LONGITUDE]: new FormControl<number | null>(
      null,
      Validators.required
    ),
    [this.FORM_KEY_FREQUENCY]: new FormControl<Frequency | null>(null),
  });
  public userHasPermissionsCreateHf: boolean = false;

  //calculated if the boundary has been taken offline (can only edit in this case)
  //the app is in edit mode
  //and if the user has permissions
  public controlsEnabled: boolean = false;

  public loaded = false;

  // public newEquipment: string = "";
  // public newEquipmentSuggestions: Array<string> = [];

  //Flag to prevent update handlers from running while we are setting initial values
  private isInitializingUI = false;
  private unsubscribe = new Subject();

  constructor(
    private bvService: BoundaryVectorLayersService,
    private confirmationService: ConfirmationService,
    public crudLayerService: CrudLayerService,
    private formBuilder: FormBuilder,
    public isLoadingService: IsLoadingService,
    private locationService: UserLocationService,
    private logger: NGXLogger,
    private mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,
    private messageService: MessageService,
    private riRouteService: RIRouteService,
    private router: Router,
    private singleHfService: SingleHfService,
    private userContextService: UserContextService
  ) {}

  ngOnInit() {
    this.singleHfService.hf
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((hf: GeoJsonHealthFacility | null) => {
        if (!hf) {
          return;
        }
        this.logger.debug(
          `Health facility details, loading [${hf?.properties?.global_id}] [${hf?.properties?.name}]`
        );
        this.hf = hf;
        this.surroundingBoundaryOptions =
          this.singleHfService.surroundingBoundaryOptions;
        this.isOutreach = this.singleHfService.outreachGuid != null;
        this.userHasPermissionsCreateHf =
          this.singleHfService.userHasPermissionsCreateHf;

        this.updateComponentPermissions();
        this.initializeUIValues();
      });

    this.subscribeToEditMode();

    //Debugging
    // if (AppConfigService.ENABLE_EXPORT_DEBUG) {
    //     setTimeout(() => {
    //         this.logger.info(`EEE logging permissions`)
    //         this.userContextService.logPermissions().then();
    //     }, 500);
    // }
  }

  ngAfterViewInit() {
    this.outsideBoundarySwitchChange(this.outsideBoundary);
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  public async nameChange(newName: string) {
    await this.singleHfService.nameChange(newName);
  }

  public async commentsChange(newComments: string) {
    await this.singleHfService.commentsChange(newComments);
  }

  public async synonymChange(newSynonyms: string[]) {
    if (
      _.isEqual(_.sortBy(this.hf.properties.synonyms), _.sortBy(newSynonyms))
    ) {
      return;
    }
    const hfEdit = cloneDeep(this.hf);
    hfEdit.properties.synonyms = newSynonyms;
    await this.crudLayerService.updateItem('health_facility__point', hfEdit);
  }

  public async catchmentStatusChange(event: Event) {
    const newMpStatus = event as unknown as HealthFacilityCatchmentStatus;
    if (this.hf.properties.mp_status === newMpStatus) {
      return;
    }
    this.hf.properties.mp_status = newMpStatus;
    //We do want to notify here to make sure completed status icons update as they should
    await this.crudLayerService.updateItem(
      'health_facility__point',
      this.hf,
      true,
      false
    );
  }

  public async ownershipChange(event: Event) {
    const newOwnership = event as unknown as HealthFacilityOwnership;
    await this.singleHfService.ownershipChange(newOwnership);
  }

  public async typeChange(event: Event) {
    const newType = event as unknown as HealthFacilityLevelOfCare;
    await this.singleHfService.typeChange(newType);
  }

  public async primaryTypeChange(event: Event) {
    const primaryType = event as unknown as HealthFacilityPrimaryType;
    if (this.hf.properties.primary_type === primaryType) {
      return;
    }
    this.hf.properties.primary_type = primaryType;
    this.crudLayerService
      .updateItem('health_facility__point', this.hf)
      .then(() => {});
  }

  async dayOptionChange(selectedDays: boolean[]) {
    this.selectedDays = selectedDays;
    await this.singleHfService.singleHfProcessingService.dayOptionChange(
      this.hf,
      selectedDays
    );
  }

  async serviceChange(event: Event | HealthFacilityServices[]) {
    const newServices = event as unknown as HealthFacilityServices[];
    await this.singleHfService.serviceChange(newServices);
  }

  public unselectService(service: HealthFacilityServices) {
    // if not deep cloned, hf.properties is changed as well and the service is not updating the services
    //  because hf.properties === newServices.
    const selectedValues = cloneDeep(this.hf.properties.services);
    const serviceIndex = selectedValues.indexOf(service);

    if (serviceIndex >= 0) {
      selectedValues.splice(serviceIndex, 1);
      this.serviceChange(selectedValues);
    }
  }

  async handleDelete() {
    this.confirmationService.confirm({
      message: 'Are you sure that you want to delete this health facility?',
      accept: () => {
        //Actual logic to perform a confirmation
        this.deleteHf();
      },
      showRejectButton: true,
    });
  }

  enableLocationWizard() {
    this.singleHfService.enableLocationWizard();
  }

  handleZoom() {
    const extendedBoundingBox = getExtentedBoundingBoxForFeatures(50, this.hf);

    this.mapEvents.panToExtent({
      movementType: 'Pan',
      extent: extendedBoundingBox,
      zoomMode: ZoomMode.ZOOM_IN_MAX,
    });
  }

  public outsideBoundarySwitchChange(checked: boolean) {
    if (checked && this.controlsEnabled) {
      this.additionalInfoFormGroup.get(this.FORM_KEY_BOUNDARY)!.enable();
    } else {
      this.additionalInfoFormGroup.get(this.FORM_KEY_BOUNDARY)!.disable();
    }
    this.outsideBoundary = checked;
  }

  public async boundaryChange(boundaryId: string) {
    // not sure why sometimes boundary change is triggered without actual even and then selection is enabled again
    if (!boundaryId || this.hf.properties.boundary_polygon == boundaryId) {
      this.outsideBoundarySwitchChange(this.outsideBoundary);
      return;
    }
    this.confirmationService.confirm({
      message:
        'Are you sure that you want to change admin boundary for this health facility?',
      accept: () => {
        this.changeAdminBoundary(boundaryId);
      },
      showRejectButton: true,
      reject: () => {
        // reset back the value on reject
        this.additionalInfoFormGroup
          .get(this.FORM_KEY_BOUNDARY)!
          .setValue(this.hf.properties.boundary_polygon);
      },
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

  private updateComponentPermissions() {
    //this.logger.debug(`EEE component perms ${this.editing} ; ${this.singleHfService.userHasPermissionsUpdateHf}`);
    this.controlsEnabled =
      this.editing && this.singleHfService.userHasPermissionsUpdateHf;

    for (const fieldKey in this.additionalInfoFormGroup.controls) {
      if (this.controlsEnabled) {
        this.additionalInfoFormGroup.get(fieldKey)!.enable();
      } else {
        this.additionalInfoFormGroup.get(fieldKey)!.disable();
      }
    }

    const selectedValues = this.hf.properties.services;
    const serviceIndex = selectedValues.indexOf(RI_SERVICE);
    if (serviceIndex < 0) {
      this.daysDisabled = true;
    } else {
      this.daysDisabled = false;
    }
  }

  private initializeUIValues() {
    this.isInitializingUI = true;

    //Note as we type the name we are saving updates
    //and we don't want a previous update to overwrite this as they type
    //See st-details-content.component hf name handled the same
    const nameControl = this.additionalInfoFormGroup.get(this.FORM_KEY_NAME)!;

    const loadingNewHf =
      this.hf.properties.global_id != this.lastHfGlobalIdLoaded;

    if (
      loadingNewHf ||
      !_.isString(nameControl.value) ||
      nameControl.value.length <= 0
    ) {
      nameControl.setValue(this.hf.properties.name);
    }

    const commentControl = this.additionalInfoFormGroup.get(
      this.FORM_KEY_COMMENTS
    )!;

    if (
      loadingNewHf ||
      !_.isString(commentControl.value) ||
      commentControl.value.length <= 0
    ) {
      commentControl.setValue(this.hf.properties.comments);
    }

    this.additionalInfoFormGroup
      .get(this.FORM_KEY_LEVEL_OF_CARE)!
      .setValue(this.hf.properties.level_of_care);

    this.outsideBoundary =
      this.bvService.data.boundaryId != this.hf.properties.boundary_polygon;
    this.additionalInfoFormGroup
      .get(this.FORM_KEY_SYNONYM)!
      .setValue(Object.values(this.hf.properties.synonyms));
    this.additionalInfoFormGroup
      .get(this.FORM_KEY_MP_STATUS)!
      .setValue(this.hf.properties.mp_status);
    this.additionalInfoFormGroup
      .get(this.FORM_KEY_OWNERSHIP)!
      .setValue(
        this.singleHfService.ownershipMap(this.hf!.properties.private!)
      );
    this.additionalInfoFormGroup
      .get(this.FORM_KEY_PRIMARY_TYPE)!
      .setValue(this.hf.properties.primary_type);
    this.additionalInfoFormGroup
      .get(this.FORM_KEY_BOUNDARY)!
      .setValue(this.hf.properties.boundary_polygon);
    this.additionalInfoFormGroup
      .get(this.FORM_KEY_LATITUDE)!
      .setValue(this.hf.geometry.coordinates[1]);
    this.additionalInfoFormGroup
      .get(this.FORM_KEY_LONGITUDE)!
      .setValue(this.hf.geometry.coordinates[0]);

    this.additionalInfoFormGroup
      .get(this.FORM_KEY_FREQUENCY)!
      .setValue(this.hf.properties.frequency);

    this.selectedDays = operatingHoursToDays(this.hf);

    this.lastHfGlobalIdLoaded = this.hf.properties.global_id;
    this.isInitializingUI = false;
  }

  private async deleteHf() {
    const boundaryId = this.hf.properties.boundary_polygon;
    this.logger.info(
      `deleting hf ${this.hf.properties.global_id} with name ${this.hf.properties.name}`
    );

    const childCheck = this.bvService.data.hfChildMap.get(
      this.hf.properties.global_id
    );
    if (childCheck && childCheck.length > 0) {
      this.messageService.add({
        summary: 'Error',
        detail:
          'This health facility has attached outreach facilities.  Those must be removed first',
        severity: 'error',
      });
      return;
    }

    const ok = await callBlockingUiUntilDone(this, async () => {
      const actionId = uuidv4();
      await this.crudLayerService.deleteItem(
        'health_facility__point',
        this.hf.properties.global_id,
        true,
        false,
        actionId
      );

      //This should be done for outreach or fixed post
      await this.bvService.computeAllCatchmentAssignmentsForHF(
        this.hf,
        actionId,
        false
      );

      //Also make sure map gets redrawn
      //This is already called
      //this.microplanMapEvents.triggerCatchmentRendering();
      return true;
    });

    //Needs 2 because we have edit and the guid
    if (ok) {
      await this.router.navigate(
        [
          RoutesChunks.ROUTINE_IMMUNIZATION,
          boundaryId,
          RoutesChunks.HEALTH_FACILITIES,
        ],
        {
          queryParamsHandling: 'preserve',
        }
      );
    }
  }

  private async changeAdminBoundary(selectedBoundary: string) {
    //This fires when the form values are set, which we don't want
    if (this.isInitializingUI) {
      return;
    }
    this.selectedBoundary = selectedBoundary;

    //Highlight these on the map
    this.microplanMapEvents.triggerHfHighlightEvent(
      this.hf.properties.global_id
    );

    const boundary = this.bvService.data.bMap.get(this.selectedBoundary);

    if (boundary) {
      this.mapEvents.addFeature({
        geo_json: boundary,
        style: boundaryStyle,
        layer: OverlayLayer.NORMAL,
      });
    }

    const extendedBoundingBox = getExtentedBoundingBoxForFeatures(
      50,
      this.hf,
      boundary!
    );

    this.mapEvents.panToExtent({
      movementType: 'Pan',
      extent: extendedBoundingBox,
      zoomMode: ZoomMode.ZOOM_IN_MAX,
    });

    const actionId = uuidv4();

    await this.crudLayerService.deleteGeojsonItems(
      'health_facility__point',
      [cloneDeep(this.hf)],
      false,
      false,
      actionId
    );
    this.hf.properties.boundary_polygon = this.selectedBoundary;
    //Keeping the same global id, both the delete / create get uploaded but get handled in their respective partitions
    await this.crudLayerService.createItem(
      'health_facility__point',
      this.hf,
      true,
      true,
      actionId
    );
    await this.router.navigate(
      [
        RoutesChunks.ROUTINE_IMMUNIZATION,
        this.riRouteService.getBoundaryIdValue(),
        RoutesChunks.HEALTH_FACILITIES,
      ],
      {
        queryParamsHandling: 'preserve',
      }
    );
  }
}
