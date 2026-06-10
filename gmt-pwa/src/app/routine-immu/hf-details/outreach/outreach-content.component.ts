import { Component, Input, OnInit } from '@angular/core';
import { FormBuilder, FormControl } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { LocationControlOutput } from '@components/wizard/wizard-location-control/wizard-location-control.component';
import {
  MapEventsService,
  ZoomMode,
} from '@services/map/base/map-events.service';
import {
  operatingHoursToDays,
  SingleHfProcessingService,
} from '@services/vector_layer/single-hf-processing.service';
import cloneDeep from 'lodash.clonedeep';
import { NGXLogger } from 'ngx-logger';
import { Subject, take, takeUntil } from 'rxjs';
import { DEFAULT_WIZARD_DIALOG_OPTIONS } from 'src/app/components/wizard/health-facility-wizard/health-facility-wizard.component';
import { callBlockingUiUntilDone } from 'src/app/components/wizard/wizard-location-control/helper-methods';
import {
  frequencyOptions,
  transportOptions,
} from 'src/app/constants/hf.constants';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { LocationEditWizardComponent } from 'src/app/routine-immu/location-edit-wizard/location-edit-wizard.component';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { ConfirmationService } from 'src/app/services/shared/notifications/confirmation.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import {
  HealthFacilitySite,
  SingleHfService,
} from 'src/app/services/vector_layer/single-hf.service';
import { getExtentedBoundingBoxForFeatures } from 'src/app/utils/coords';
import {
  Frequency,
  GeoJsonHealthFacility,
} from 'src/app/utils/server-interfaces/GeoJson';
import { isEmpty } from 'src/app/utils/server-interfaces/utils/geom.util';
import {
  getNumberOrDefault,
  INVALID_COORD,
} from 'src/app/utils/string-formatting';
import { v4 as uuidv4 } from 'uuid';

export interface CatchmentStats {
  estPop: number;
  population: number;
  travelTimeWalking: number;
  travelTimeMixed: number;
  totalCountSettlements: number;
}

@Component({
  selector: 'outreach-content',
  templateUrl: './outreach-content.component.html',
  styleUrls: ['./outreach-content.component.less'],
  standalone: false
})
export class OutreachContentComponent implements OnInit {
  @Input() outreach: HealthFacilitySite;
  public frequencyOptions = frequencyOptions;
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
  public transportOptions = transportOptions;
  public FORM_KEY_NAME = 'name';
  public FORM_KEY_COMMENTS = 'comments';
  public FORM_KEY_FREQUENCY = 'frequency';
  public FORM_KEY_TRANSPORT = 'transport';
  public panelOpenState: boolean = false;
  public editing: boolean = false;

  public outreachDetailsFormGroup = this.formBuilder.group({
    [this.FORM_KEY_NAME]: new FormControl<string | null>(null),
    [this.FORM_KEY_COMMENTS]: new FormControl<string>(''),
    [this.FORM_KEY_FREQUENCY]: new FormControl<Frequency | null>(null),
    [this.FORM_KEY_TRANSPORT]: new FormControl<string | null>(null),
  });
  public userHasPermissionsCreateHf: boolean = false;
  public userHasPermissionsUpdateHf: boolean = false;
  public catchmentStats: CatchmentStats = {
    totalCountSettlements: -1,
    population: -1,
    estPop: -1,
    travelTimeMixed: -1,
    travelTimeWalking: -1,
  };
  private renameClearTimeout: ReturnType<typeof setTimeout> | null = null;
  private commentsClearTimeout: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe = new Subject();

  constructor(
    private bvService: BoundaryVectorLayersService,
    private confirmationService: ConfirmationService,
    public crudLayerService: CrudLayerService,
    private dialog: MatDialog,
    private formBuilder: FormBuilder,
    public isLoadingService: IsLoadingService,
    private logger: NGXLogger,
    private mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,
    private router: Router,
    public singleHfService: SingleHfService,
    private singleHfProcessingService: SingleHfProcessingService,
    private userContextService: UserContextService
  ) {}

  ngOnInit() {
    this.singleHfService.hf
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((hf: GeoJsonHealthFacility | null) => {
        if (!hf) {
          return;
        }
        this.userHasPermissionsCreateHf =
          this.singleHfService.userHasPermissionsCreateHf;
        this.userHasPermissionsUpdateHf =
          this.singleHfService.userHasPermissionsUpdateHf;
        this.updateComponentPermissions();
      });
    this.initializeUIValues();
    this.subscribeToEditMode();
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
    for (const fieldKey in this.outreachDetailsFormGroup.controls) {
      if (this.editing && this.userHasPermissionsUpdateHf) {
        this.outreachDetailsFormGroup.get(fieldKey)!.enable();
        this.daysDisabled = false;
      } else {
        this.outreachDetailsFormGroup.get(fieldKey)!.disable();
        this.daysDisabled = true;
      }
    }
  }

  private initializeUIValues() {
    this.outreachDetailsFormGroup
      .get(this.FORM_KEY_NAME)!
      .setValue(this.outreach.name);

    this.outreachDetailsFormGroup
      .get(this.FORM_KEY_COMMENTS)!
      .setValue(this.outreach.json.properties.comments);

    const realFreqValue = this.outreach.json.properties.frequency;
    const weeklyFrequencies: Array<Frequency> = [
      'oncePerWeek',
      'twicePerWeek',
      'threePerWeek',
      'fourPerWeek',
      'fivePerWeek',
      'sixPerWeek',
      'daily',
    ];
    if (weeklyFrequencies.includes(realFreqValue)) {
      this.outreachDetailsFormGroup
        .get(this.FORM_KEY_FREQUENCY)!
        .setValue('weekly');
    } else {
      this.outreachDetailsFormGroup
        .get(this.FORM_KEY_FREQUENCY)!
        .setValue(realFreqValue);
    }
    this.outreachDetailsFormGroup
      .get(this.FORM_KEY_TRANSPORT)!
      .setValue(Object.values(this.outreach.json.properties.transport));

    this.selectedDays = operatingHoursToDays(this.outreach.json);
  }

  public async nameChange(newName: string) {
    // event is triggered first time when data is retrieved. That is why we need this check
    if (this.outreach.name === newName) {
      return;
    }
    //Cancel the delayed search if there is one
    if (this.renameClearTimeout) {
      clearTimeout(this.renameClearTimeout);
    }
    //Wait a second before executing
    this.renameClearTimeout = setTimeout(async () => {
      await this.updateName();
    }, 1000);
  }

  public async commentsChange(newComments: string) {
    // event is triggered first time when data is retrieved. That is why we need this check
    if (this.outreach.json.properties.comments === newComments) {
      return;
    }
    //Cancel the delayed search if there is one
    if (this.commentsClearTimeout) {
      clearTimeout(this.commentsClearTimeout);
    }
    //Wait a second before executing
    this.commentsClearTimeout = setTimeout(async () => {
      const outreachEdit = cloneDeep(this.outreach.json);
      outreachEdit.properties.comments = this.outreachDetailsFormGroup.get(
        this.FORM_KEY_COMMENTS
      )!.value;
      await this.crudLayerService.updateItem(
        'health_facility__point',
        outreachEdit,
        true
      );
    }, 1000);
  }

  async frequencyChange() {
    const newFrequency = this.outreachDetailsFormGroup.get(
      this.FORM_KEY_FREQUENCY
    )!.value;

    //If weekly then let dayOptionChange handle it to map weekly to the real frequency of 1-7x / week
    if (newFrequency == 'weekly') {
      await this.dayOptionChange([true, true, true, true, true, true, true]);
    } else {
      await this.singleHfProcessingService.frequencyChange(
        this.outreach.json,
        newFrequency
      );
    }
  }

  async transportChange() {
    const newTransport = this.outreachDetailsFormGroup.get(
      this.FORM_KEY_TRANSPORT
    )!.value;
    if (newTransport == this.outreach.json.properties.transport) {
      return;
    }
    const outreachEdit = cloneDeep(this.outreach.json);
    outreachEdit.properties.transport = newTransport;
    await this.crudLayerService.updateItem(
      'health_facility__point',
      outreachEdit
    );
  }

  async dayOptionChange(selectedDays: boolean[]) {
    this.selectedDays = selectedDays;
    await this.singleHfService.singleHfProcessingService.dayOptionChange(
      this.outreach.json,
      selectedDays
    );
  }

  async navigateToOutreach(outreach: HealthFacilitySite) {
    await this.router.navigate(
      [
        RoutesChunks.ROUTINE_IMMUNIZATION,
        outreach.json.properties.boundary_polygon,
        RoutesChunks.HEALTH_FACILITIES,
        outreach.json.properties.global_id,
        RoutesChunks.EDIT,
      ],
      {
        queryParamsHandling: 'preserve',
      }
    );
  }

  enableLocationWizard() {
    let data: LocationControlOutput = {
      lon: this.outreach.json.geometry.coordinates[0],
      lat: this.outreach.json.geometry.coordinates[1],
      set_with_gps: this.outreach.json.properties.set_with_gps || false,
    };

    let dialogRef = this.dialog.open(LocationEditWizardComponent, {
      ...DEFAULT_WIZARD_DIALOG_OPTIONS,
      data,
    });
    dialogRef.componentInstance.location
      .pipe(take(1), takeUntil(this.unsubscribe))
      .subscribe(async (location: LocationControlOutput) => {
        await this.handlePositionChange(location);
      });
  }

  private async updateName() {
    const outreachEdit = cloneDeep(this.outreach.json);
    outreachEdit.properties.name = this.outreachDetailsFormGroup.get(
      this.FORM_KEY_NAME
    )!.value;
    await this.crudLayerService.updateItem(
      'health_facility__point',
      outreachEdit,
      true
    );
  }

  async handleDelete() {
    this.confirmationService.confirm({
      message: 'Are you sure that you want to delete this outreach site?',
      accept: () => {
        //Actual logic to perform a confirmation
        this.deleteOutreach();
      },
      showRejectButton: true,
    });
  }

  public handleOpenOutreachPanel() {
    this.panelOpenState = true;
    this.singleHfService.expandedOutreachGuid =
      this.outreach.json.properties.global_id;
  }

  public handleCloseOutreachPanel() {
    this.panelOpenState = false;
    this.singleHfService.expandedOutreachGuid = null;
  }

  private async deleteOutreach() {
    const parentHf = this.bvService.data.hfMap.get(
      this.outreach.json.properties.parent!
    )!;

    this.logger.info(
      `deleting outreach from parent hf ${parentHf.properties.global_id} with name ${parentHf.properties.name}`
    );
    this.logger.info(
      `deleting outreach id hf ${this.outreach.json.properties.global_id} with name ${this.outreach.json.properties.name}`
    );

    await callBlockingUiUntilDone(this, async () => {
      const actionId = uuidv4();
      await this.crudLayerService.deleteItem(
        'health_facility__point',
        this.outreach.json.properties.global_id,
        true,
        false,
        actionId
      );

      //This should be done for outreach or fixed post
      //Pass the parentHf as the "oldhf" in order to include settlements associated with it to make sure its catchment is updated
      await this.bvService.computeAllCatchmentAssignmentsForHF(
        this.outreach.json,
        actionId,
        false,
        parentHf
      );

      //Also make sure map gets redrawn
      //This is already done by callBlockingUiUntilDone
      //this.microplanMapEvents.triggerHfRendering();

      this.singleHfService.buildCatchedSettlementTree(parentHf);
      this.singleHfService.buildSuggestedSettlements(parentHf); // TODO - should I try to simplify these 3 calls?

      //Refresh the parent HF outreach list since we just deleted an outreach
      //This will trigger in hf-details.component the hf observable which
      //reloads the outreaches array
      this.singleHfService.hf.next(parentHf);

      return true;
    });
  }

  handleShowHfSiteOnMap(event: MouseEvent) {
    event.stopPropagation();
    const healthFacility = this.outreach.json;

    if (isEmpty(healthFacility)) {
      return;
    }
    this.mapEvents.panToExtent({
      movementType: 'Pan',
      extent: getExtentedBoundingBoxForFeatures(1000, healthFacility),
      zoomMode: ZoomMode.ZOOM_IN_MAX,
    });
  }

  private async handlePositionChange(location: LocationControlOutput) {
    const lon = getNumberOrDefault(location.lon, INVALID_COORD);
    const lat = getNumberOrDefault(location.lat, INVALID_COORD);
    if (lon == INVALID_COORD || lat == INVALID_COORD) {
      return;
    }

    await callBlockingUiUntilDone(
      this,
      async () => {
        //To recompute properly
        const oldOutreach = cloneDeep(this.outreach.json);

        this.outreach.json.geometry.coordinates = [lon, lat];
        this.outreach.json.properties.set_with_gps = location.set_with_gps;

        const actionId = uuidv4();
        await this.bvService.computeAllCatchmentAssignmentsForHF(
          this.outreach.json,
          actionId,
          true,
          oldOutreach
        );

        await this.crudLayerService.updateItem(
          'health_facility__point',
          this.outreach.json,
          true,
          false,
          actionId
        );

        return true;
      },
      true
    );

    //need to wait until ui updates are on
    this.microplanMapEvents.triggerhfMoved(
      this.outreach.json.properties.global_id
    );
  }
}
