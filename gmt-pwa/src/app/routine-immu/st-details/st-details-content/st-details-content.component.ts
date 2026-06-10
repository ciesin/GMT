import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSlideToggleChange } from '@angular/material/slide-toggle';
import { Router } from '@angular/router';
import { callBlockingUiUntilDone } from '@components/wizard/wizard-location-control/helper-methods';
import {
  MapEventsService,
  OverlayLayer,
  ZoomMode,
} from '@services/map/base/map-events.service';
import { MicroplanMapEventsService } from '@services/map/MicroplanMapEventsService';
import { ConfirmationService } from '@services/shared/notifications/confirmation.service';
import { MessageService } from '@services/shared/notifications/message.service';
import { RIRouteService } from '@services/shared/route/ri-route.service';
import { CrudLayerService } from '@services/vector_layer/crud-layer.service';
import _, { cloneDeep, isNil } from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { Subject, take, takeUntil } from 'rxjs';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import {
  problematicOptions,
  uninhabitedReasonsOptions,
} from 'src/app/constants/st.constants';
import {
  BoundaryVectorLayersService,
  DropdownBoundary,
} from 'src/app/services/boundary-vector-layers.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { SingleStService } from 'src/app/services/vector_layer/single-st.service';
import { getExtentedBoundingBoxForFeatures } from 'src/app/utils/coords';
import {
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
  ProblematicOption,
  UNKNOWN,
} from 'src/app/utils/server-interfaces/GeoJson';
import { formatPopulation } from 'src/app/utils/string-formatting';
import { SelectOption } from 'src/app/utils/ui/ui-component-interfaces';
import { boundaryStyle } from 'src/app/_shared/map/styles/map-boundary-styles';
import { v4 as uuidv4 } from 'uuid';
import {
  UninhabitedPopupComponent,
  UninhabitedPopupDialogData,
} from './uninhabited-popup/uninhabited-popup.component';

@Component({
  selector: 'st-details-content',
  templateUrl: './st-details-content.component.html',
  styleUrls: ['./st-details-content.component.less'],
  standalone: false
})
export class StDetailsContentComponent implements OnInit, AfterViewInit {
  public stName!: GeoJsonSettlementName;

  public editing: boolean = false;
  //See similiar comment in facility details
  public controlsEnabled: boolean = false;

  //See comments for lastHfGlobalIdLoaded in facility details
  private lastStNameGlobalIdLoaded: string | null = null;

  public surroundingBoundaryOptions: Array<DropdownBoundary> = [];
  public outsideBoundary: boolean;
  public selectedBoundary!: string; // DropdownBoundary
  //Flag to prevent update handlers from running while we are setting initial values
  private isInitializingUI = false;

  public isOutreach: boolean = false;
  public newLatStr = '';
  public newLonStr = '';

  public FORM_KEY_NAME = 'name';
  public FORM_KEY_SYNONYM = 'synonym';
  public FORM_KEY_COMMENTS = 'comments';
  public FORM_KEY_PROBLEMATIC = 'problematic';
  public FORM_KEY_ESTIMATED_POP = 'estimated_pop';
  public FORM_KEY_COMPUTED_POP = 'computed_pop';

  public FORM_KEY_BOUNDARY = 'surrounding_boundary';

  basicInformationFormGroup = this.formBuilder.group({
    [this.FORM_KEY_NAME]: ['', Validators.required],
    [this.FORM_KEY_SYNONYM]: new FormControl<Array<string>>([]),
    [this.FORM_KEY_COMMENTS]: new FormControl<string>(''),
    [this.FORM_KEY_PROBLEMATIC]: new FormControl<Array<ProblematicOption>>([]),
    [this.FORM_KEY_ESTIMATED_POP]: new FormControl<number | null>(null),
    //String because its readonly & formatted
    [this.FORM_KEY_COMPUTED_POP]: new FormControl<string>(''),

    [this.FORM_KEY_BOUNDARY]: new FormControl<string>(''),
  });
  public problematicOptions: Array<SelectOption> = problematicOptions.filter(
    (x) => x.value !== UNKNOWN
  );
  public uninhabitedReasonsOptions: Array<SelectOption> =
    uninhabitedReasonsOptions.filter((x) => x.value !== UNKNOWN);

  private settlementPart: GeoJsonSettlementPart | null = null;
  private unsubscribe = new Subject();

  constructor(
    private formBuilder: FormBuilder,
    public isLoadingService: IsLoadingService,
    private userContextService: UserContextService,
    private bvService: BoundaryVectorLayersService,
    private singleStService: SingleStService,
    private confirmationService: ConfirmationService,
    private mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,
    private riRouteService: RIRouteService,
    public crudLayerService: CrudLayerService,
    private router: Router,
    private logger: NGXLogger,
    private matDialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private messageService: MessageService
  ) {
    this.isLoadingService.setLoading(true);
  }

  ngOnInit() {
    this.singleStService.stName
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((stName: GeoJsonSettlementName | null) => {
        if (!stName) {
          return;
        }
        this.stName = stName;
        this.bvService
          .buildSurroundingBoundaryDropdownItems(false)
          .then((bo) => {
            this.surroundingBoundaryOptions = bo;
          });

        this.settlementPart = this.singleStService.settlementPart!;
        this.initializeUIValues();
        this.isLoadingService.setLoading(false);
      });
    this.subscribeToEditMode();
  }

  ngAfterViewInit() {
    this.initializeUIValues();

    this.outsideBoundarySwitchChange(this.outsideBoundary);
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  public async nameChange(newName: string) {
    await this.singleStService.nameChange(newName);
  }

  public async commentsChange(newComments: string) {
    await this.singleStService.commentsChange(newComments);
  }

  public async synonymChange(newSynonyms: string[]) {
    await this.singleStService.synonymChange(newSynonyms);
  }

  public async problematicChange() {
    const newProblematic = this.basicInformationFormGroup.get(
      this.FORM_KEY_PROBLEMATIC
    )!.value;
    await this.singleStService.problematicChange(newProblematic);
  }

  public async handleEstimatedPopChange() {
    let newPop = this.basicInformationFormGroup.get(
      this.FORM_KEY_ESTIMATED_POP
    )!.value;

    if (newPop == this.stName.properties.estimated_pop) {
      //no change, do nothing
      //As change triggers at load, this prevents a loop
      return;
    }

    if (newPop <= 0) {
      const ok = await this.showUninhabitedDialog(null, {
        uninhabited: true,
        uninhabited_reason: null,
        uninhabited_other_detail: null,
      });
      if (!ok) {
        //revert
        this.basicInformationFormGroup
          .get(this.FORM_KEY_ESTIMATED_POP)!
          .setValue(this.stName.properties.estimated_pop);
        return;
      }
    }
    await this.singleStService.handleEstimatedPopChange(newPop);
  }

  public async uninhabitedChange(
    event: MatSlideToggleChange,
    actionId: string | null = null
  ) {
    const uninhabited = event.checked;

    if (uninhabited == this.stName.properties.uninhabited) {
      //no change, do nothing
      //As change triggers at load, this prevents a loop
      return;
    }

    if (uninhabited) {
      const ok = await this.showUninhabitedDialog(actionId, {
        uninhabited,
        uninhabited_reason: null,
        uninhabited_other_detail: null,
      });
      if (!ok) {
        //revert
        event.source.checked = false;
      }
    } else {
      this.singleStService.uninhabitedChange(
        {
          uninhabited,
          uninhabited_other_detail: null,
          uninhabited_reason: null,
        },
        actionId
      );
    }
    /*
    let newReason = this.basicInformationFormGroup.get(
      this.FORM_KEY_UNINHABITED_REASON
    )!.value;
    await this.singleStService.uninhabitedReasonChange(newReason);
    */
  }

  public async handleEditUninhabitedReason() {
    await this.showUninhabitedDialog(null, {
      uninhabited: this.stName.properties.uninhabited,
      uninhabited_reason: this.stName.properties.uninhabited_reason,
      uninhabited_other_detail: this.stName.properties.uninhabited_other_detail,
    });
  }

  private showUninhabitedDialog(
    actionId: string | null,
    data: UninhabitedPopupDialogData
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const dialogRef = this.matDialog.open(UninhabitedPopupComponent, {
        autoFocus: false,
        width: '430px',
        data,
      });

      dialogRef
        .afterClosed()
        .pipe(take(1))
        .subscribe((result) => {
          if (result) {
            this.singleStService.uninhabitedChange(result, actionId).then();
            resolve(true);
          } else {
            resolve(false);
          }
        });
    });
  }

  public getUninhabitedReason(): string {
    const ur = this.stName.properties.uninhabited_reason;
    if (ur == 'Other') {
      return this.stName.properties.uninhabited_other_detail || '-';
    } else {
      return ur || '-';
    }
  }

  public getIsGmt(): boolean {
    //true if the settlement type is gmt (meaning a buffered point / polygon added in GMT)
    if (isNil(this.settlementPart)) {
      return false;
    }

    return this.settlementPart.properties.type == 'gmt';
  }

  async handleDelete() {
    this.confirmationService.confirm({
      message: 'Are you sure that you want to delete this settlement?',
      accept: () => {
        //Actual logic to perform a confirmation
        this.deleteSettlement();
      },
      showRejectButton: true,
    });
  }

  private async deleteSettlement() {
    const boundaryId = this.stName.properties.boundary_polygon;

    if (isNil(this.settlementPart)) {
      this.logger.error('Cannot delete, no sp');
      return;
    }

    if (this.settlementPart.properties.type != 'gmt') {
      this.messageService.add({
        summary: 'Error',
        detail: 'This settlement was not added in GMT and cannot be removed',
        severity: 'error',
      });
      return;
    }

    const ok = await callBlockingUiUntilDone(this, async () => {
      const actionId = uuidv4();
      await this.crudLayerService.deleteItem(
        'settlement__name',
        this.stName.properties.global_id,
        true,
        false,
        actionId
      );

      await this.crudLayerService.deleteItem(
        'settlement__part',
        this.settlementPart!.properties.global_id,
        true,
        false,
        actionId
      );

      await this.bvService.computeCatchmentsForRemovedSp(
        this.settlementPart,
        actionId
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
          RoutesChunks.SETTLEMENTS,
        ],
        {
          queryParamsHandling: 'preserve',
        }
      );
    }
  }

  public enableLocationWizard() {
    this.singleStService.enableLocationWizard();
  }

  private initializeUIValues() {
    this.isInitializingUI = true;

    const loadingNewSettlement =
      this.stName.properties.global_id != this.lastStNameGlobalIdLoaded;

    this.outsideBoundary =
      this.bvService.data.boundaryId != this.stName.properties.boundary_polygon;

    this.basicInformationFormGroup
      .get(this.FORM_KEY_BOUNDARY)!
      .setValue(this.stName.properties.boundary_polygon);

    //Note as we type the name we are saving updates
    //and we don't want a previous update to overwrite this as they type
    //See facility-details-content.component hf name handled the same
    const nameControl = this.basicInformationFormGroup.get(this.FORM_KEY_NAME)!;

    if (
      loadingNewSettlement ||
      !_.isString(nameControl.value) ||
      nameControl.value.length <= 0
    ) {
      nameControl.setValue(this.stName.properties.name);
    }

    const commentControl = this.basicInformationFormGroup.get(
      this.FORM_KEY_COMMENTS
    )!;

    if (
      loadingNewSettlement ||
      !_.isString(commentControl.value) ||
      commentControl.value.length <= 0
    ) {
      commentControl.setValue(this.stName.properties.comments);
    }

    // we have to make a copy, because synonyms are the list and only reference is passed
    this.basicInformationFormGroup
      .get(this.FORM_KEY_SYNONYM)!
      .setValue(cloneDeep(this.stName.properties.synonyms));
    this.basicInformationFormGroup
      .get(this.FORM_KEY_PROBLEMATIC)!
      .setValue(this.stName.properties.problematic);
    this.basicInformationFormGroup
      .get(this.FORM_KEY_ESTIMATED_POP)!
      .setValue(this.stName.properties.estimated_pop);

    if (_.isNil(this.settlementPart)) {
      this.logger.warn('Settlement part is nil for st details page');
      this.basicInformationFormGroup
        .get(this.FORM_KEY_COMPUTED_POP)!
        .setValue(formatPopulation(0, undefined, false));
    } else {
      this.basicInformationFormGroup
        .get(this.FORM_KEY_COMPUTED_POP)!
        .setValue(
          formatPopulation(
            this.settlementPart.properties.computed_pop,
            undefined,
            false
          )
        );
    }

    this.lastStNameGlobalIdLoaded = this.stName.properties.global_id;
    this.isInitializingUI = false;
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
    this.logger.debug(
      `settlement perms ${this.editing} ${this.singleStService.userHasPermissionsUpdateSettlement} ${this.bvService.isOffline}`
    );
    this.controlsEnabled =
      this.editing && this.singleStService.userHasPermissionsUpdateSettlement;
    for (const fieldKey in this.basicInformationFormGroup.controls) {
      if (this.controlsEnabled) {
        this.basicInformationFormGroup.get(fieldKey)!.enable();
      } else {
        this.basicInformationFormGroup.get(fieldKey)!.disable();
      }
    }
    this.basicInformationFormGroup.get(this.FORM_KEY_COMPUTED_POP)!.disable();
  }

  public outsideBoundarySwitchChange(checked: boolean) {
    if (checked && this.controlsEnabled) {
      this.basicInformationFormGroup.get(this.FORM_KEY_BOUNDARY)!.enable();
    } else {
      this.basicInformationFormGroup.get(this.FORM_KEY_BOUNDARY)!.disable();
    }
    this.outsideBoundary = checked;
  }

  public async boundaryChange(boundaryId: string) {
    // not sure why sometimes boundary change is triggered without actual even and then selection is enabled again
    if (!boundaryId || this.stName.properties.boundary_polygon == boundaryId) {
      this.outsideBoundarySwitchChange(this.outsideBoundary);
      return;
    }
    this.confirmationService.confirm({
      message:
        'Are you sure that you want to change admin boundary for this settlement?',
      accept: () => {
        this.changeAdminBoundary(boundaryId);
      },
      showRejectButton: true,
      reject: () => {
        // reset back the value on reject
        this.basicInformationFormGroup
          .get(this.FORM_KEY_BOUNDARY)!
          .setValue(this.stName.properties.boundary_polygon);
      },
    });
  }

  private async changeAdminBoundary(selectedBoundary: string) {
    //This fires when the form values are set, which we don't want
    if (this.isInitializingUI) {
      return;
    }
    this.selectedBoundary = selectedBoundary;

    //Highlight these on the map
    //this.microplanMapEvents.triggerHfHighlightEvent(this.hf.properties.global_id);
    this.microplanMapEvents.triggerSettlementHighlightEvent(
      this.stName.properties.global_id
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
      this.stName,
      boundary!
    );

    this.mapEvents.panToExtent({
      movementType: 'Pan',
      extent: extendedBoundingBox,
      zoomMode: ZoomMode.ZOOM_IN_MAX,
    });

    const actionId = uuidv4();
    //Note !!! When syncing changes, the "before" json
    await this.crudLayerService.deleteGeojsonItems(
      'settlement__name',
      [cloneDeep(this.stName)],
      false,
      false,
      actionId
    );
    await this.crudLayerService.deleteGeojsonItems(
      'settlement__part',
      [cloneDeep(this.settlementPart!)],
      false,
      false,
      actionId
    );

    //Note normally there should only be primary name
    //Also leaving the non primary names as is
    this.stName.properties.boundary_polygon = this.selectedBoundary;
    this.settlementPart!.properties.boundary_polygon = this.selectedBoundary;

    //Keeping the same global id, both the delete / create get uploaded but get handled in their respective partitions
    await this.crudLayerService.createItem(
      'settlement__name',
      this.stName,
      true,
      true,
      actionId
    );
    await this.crudLayerService.createItem(
      'settlement__part',
      this.settlementPart!,
      true,
      true,
      actionId
    );

    await this.router.navigate(
      [
        RoutesChunks.ROUTINE_IMMUNIZATION,
        this.riRouteService.getBoundaryIdValue(),
        RoutesChunks.SETTLEMENTS,
      ],
      {
        queryParamsHandling: 'preserve',
      }
    );
  }
}
