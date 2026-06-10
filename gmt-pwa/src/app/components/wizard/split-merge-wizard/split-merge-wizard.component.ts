import {
  Component,
  ElementRef,
  HostBinding,
  Inject,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatStepper } from '@angular/material/stepper';
import { BBox2d } from '@turf/helpers/dist/js/lib/geojson';
import {
  bbox,
  bbox as turfBbox,
  difference,
  Feature as TurfFeature,
  intersect,
  MultiPolygon as TurfMultiPolygon,
  pointOnFeature,
  Polygon as TurfPolygon,
} from '@turf/turf';
import { NGXLogger } from 'ngx-logger';
import * as polyclip from 'polyclip-ts';
import { filter, Subject, switchMap, take, takeUntil } from 'rxjs';
import {
  BoundaryVectorLayersService,
  generateSettlementName,
} from 'src/app/services/boundary-vector-layers.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import {
  DefaultGeoJSonSettlementNameProperties,
  DefaultGeoJSonSettlementPartProperties,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
  MultiPolygon,
  MultiPolygon as MultiPolygonGeoJson,
  Point,
  Polygon as PolygonGeoJson,
  Position,
  SettlementType,
} from 'src/app/utils/server-interfaces/GeoJson';
import { geometryIntersects } from 'src/app/utils/server-interfaces/utils/geom.util';
import {
  isMachineGenerated,
  joinListUnique,
} from 'src/app/utils/string-formatting';
import { SelectOption } from 'src/app/utils/ui/ui-component-interfaces';
import { v4 as uuidv4 } from 'uuid';
import {
  callBlockingUiUntilDone,
  disableMapFullScreen,
  enableMapFullScreen,
  saveSettlementChanges,
  SettlementChanges,
  WizardComponent,
} from '../wizard-location-control/helper-methods';

import { StepperSelectionEvent } from '@angular/cdk/stepper';
import { MapEventsService } from '@services/map/base/map-events.service';
import { UserActionLogService } from '@services/user-action-log.service';
import cloneDeep from 'lodash.clonedeep';
import {
  manuallyPopulateSettlementPartFieldsIfNeeded,
  resetRasterSettlementPartFields,
} from 'src/app/services/geo/Rasterize';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { RasterDataService } from 'src/app/services/raster-data.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  addWizardCssClassToCdkOverlayWrapper,
  switchWizardCssClass,
} from '../health-facility-wizard/health-facility-wizard.component';
import { WizardPolygonEditComponent } from '../wizard-polygon-edit/wizard-polygon-edit.component';

export interface SplitMergeWizardDialogData {
  //If we are editing an existing settlement
  //editSettlementNameId: string | null,
}

const FORM_KEY_PRIMARY_NAME = 'primaryName';
const FORM_KEY_NAME_CHOSEN = 'nameChosen';

const GENERIC_MESSAGE_SERVICE_ARGS = {
  summary: 'Internal error while attempting to merge settlements',
  severity: 'error',
};

@Component({
  selector: 'gmt-split-merge-wizard',
  templateUrl: './split-merge-wizard.component.html',
  styleUrls: ['../wizard.less', './split-merge-wizard.component.less'],
  standalone: false
})
export class SplitMergeWizardComponent
  implements OnInit, OnDestroy, WizardComponent, MergeComponent
{
  FORM_KEY_PRIMARY_NAME = FORM_KEY_PRIMARY_NAME;

  //states of the location tab
  canMerge: boolean;
  canSplit: boolean;

  selectedSettlementPartIds: Array<string> = [];

  showChoosePrimaryName = false;
  showEnterPrimaryName = false;
  areMerging = false;
  areSplitting = false;
  leftPanelOpenedBeforeSetPoint = false;

  //If we delay the split changes until we have chosen a name
  splitChanges: SettlementChanges | null = null;

  @HostBinding('style.--matStepperHeaderDisplay') matStepperHeaderDisplay =
    'flex';

  primaryNameOptions: Array<SelectOption> = [];

  //Reactive, strongly typed Form groups
  basicInformationFormGroup = this._formBuilder.group({});

  choosePrimaryNameFormGroup = this._formBuilder.group({
    [FORM_KEY_PRIMARY_NAME]: new FormControl<string | null>(null, [
      Validators.required,
    ]),
  });

  //Note this is an optional free entry, when we are splitting and need
  //to generate a primary name
  enterPrimaryNameFormGroup = this._formBuilder.group({
    [FORM_KEY_PRIMARY_NAME]: new FormControl<string>(''),
    [FORM_KEY_NAME_CHOSEN]: new FormControl<boolean | null>(null, [
      Validators.required,
    ]),
  });

  @ViewChild('stepper') private myStepper: MatStepper;

  @ViewChild('polygonEditSplitSettlementBoundary')
  wizardPolygonEdit: WizardPolygonEditComponent;

  private unsubscribe = new Subject();

  constructor(
    public messageService: MessageService,
    public mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,
    public bvService: BoundaryVectorLayersService,
    public userContextService: UserContextService,
    public crudLayerService: CrudLayerService,
    public dialogRef: MatDialogRef<SplitMergeWizardComponent>,
    //Used to pass data from the component opening this dialog
    @Inject(MAT_DIALOG_DATA) public data: SplitMergeWizardDialogData,
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
    this.logger.info('Data for split/merge wizard', this.data);

    //to avoid ng after init errors
    setTimeout(() => {
      enableMapFullScreen(this);
      addWizardCssClassToCdkOverlayWrapper(true);

      //Initial step is map interaction
      switchWizardCssClass(true);
    }, 1);

    this.subscribeToSelectedParts();

    this.userContextService
      .getCurrentBoundaryObservable()
      .pipe(
        filter((boundary) => !!boundary),
        switchMap((boundary) => {
          this.logger.info('Microplan Add Wizard List Boundary id', boundary);
          return this.bvService.ensureBoundaryLoaded(boundary!.boundaryId);
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe(() => {
        //do nothing
      });

    if (AppConfigService.ENABLE_WIZARD_DEBUG) {
      this.mapEvents
        .getIsMapInitialized()
        .pipe(
          filter((isInitialized) => isInitialized),
          take(1),
          takeUntil(this.unsubscribe)
        )
        .subscribe(() => {
          this.microplanMapEvents.setSelectedSettlementParts([
            //"1d008cf4-ab2c-4e2e-ba30-eb4bbe474129","31330231-6615-4840-afcc-8dcbd324c8e7"
            //'e02afe3e-880f-4a67-a160-5c65d7375d86',
            '0ca768ae-d269-427f-9219-44fc18455544',
            '4d9a9fee-245c-4ef8-b096-40946d23f6ab',
            '4ff36df5-6f4b-4c0f-9720-9f88ba9f3459',
            '61dde56a-fd73-4a94-bf2f-6b96ec019901',
            'd7ffcfcf-a5b5-4d31-b838-126a6b63e0e8',
            'd9d28fe4-1cc7-477c-9b5a-4259d7e64545',
            'f68e829c-e861-4f3a-bef2-81675afcf446',
          ]);

          setTimeout(() => {
            //this.mergeSettlements();
          }, 1);
        });
    }
  }

  ngOnDestroy() {
    this.logger.debug('split/merge wizard destroy');
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  handleStepChange(stepEvent: StepperSelectionEvent) {
    // when changing step, the wizard can get bigger and get inaccessible. We want to prevent that
    //We keep the wizard at the top
    //ensureValidWizardPosition(this);

    if (
      stepEvent.selectedStep.stepControl === this.choosePrimaryNameFormGroup ||
      stepEvent.selectedStep.stepControl === this.enterPrimaryNameFormGroup
    ) {
      //user input
      switchWizardCssClass(false);
    } else {
      //map interaction
      switchWizardCssClass(true);
    }
  }

  handleCancel() {
    this.userActionLogService.addUserActionDescription(
      'User cancelled split/merge wizard'
    );
    this.closeDialog();
  }

  async handleStartOver() {
    this.userActionLogService.addUserActionDescription('Start over clicked');
    this.showChoosePrimaryName = false;
    this.showEnterPrimaryName = false;
    this.areMerging = false;
    this.areSplitting = false;
    this.splitChanges = null;
    this.microplanMapEvents.setSelectedSettlementParts([]);
    this.wizardPolygonEdit.finishedDrawing();
    enableMapFullScreen(this);
    addWizardCssClassToCdkOverlayWrapper(true);

    //We didn't actually do anything yet, so no undo needed

    this.myStepper.reset();
  }

  private closeDialog() {
    this.wizardPolygonEdit.finishedDrawing();
    disableMapFullScreen(this);
    addWizardCssClassToCdkOverlayWrapper(false);

    this.microplanMapEvents.mapPointLocationConfig.next({
      visible: false,
      requestMapLocation: false,
    });

    this.dialogRef.close();
  }

  async handleFinish() {
    let success = false;
    this.userActionLogService.addUserActionDescription(
      `Split/merge wizard - finish starting - Are merging? ${this.areMerging} - Are splitting? ${this.areSplitting} chose name ${this.showChoosePrimaryName}`
    );

    //Are we merging?
    if (this.areMerging) {
      //Did we choose a name
      if (this.showChoosePrimaryName) {
        success = await callBlockingUiUntilDone(this, async () => {
          const chosenName = this.choosePrimaryNameFormGroup.get(
            FORM_KEY_PRIMARY_NAME
          )!.value!;
          this.userActionLogService.addUserActionDescription(
            `Split/merge wizard - finish merging chosen name [${chosenName}] set part ids: ${this.selectedSettlementPartIds.join(
              ', '
            )}`
          );
          return await handleMergeRequestImpl(
            this,
            this.selectedSettlementPartIds,
            chosenName
          );
        });
      } else {
        //Unclear how this would be the case, merging should always need to choos a name....
        this.userActionLogService.addUserActionDescription(
          `Split/merge wizard - finish merging no chosen name starting`
        );
        success = await callBlockingUiUntilDone(
          this,
          async () => await this.mergeSettlementsImpl()
        );
        this.userActionLogService.addUserActionDescription(
          `Split/merge wizard - finish merging no chosen name success: [${success}]`
        );
      }
    } else if (this.areSplitting) {
      this.userActionLogService.addUserActionDescription(
        `Split/merge wizard - finish splitting starting`
      );
      //In both the enter primary name and not case, we call the same method
      success = await callBlockingUiUntilDone(
        this,
        async () => await saveSettlementChanges(this, this.splitChanges!)
      );
      this.userActionLogService.addUserActionDescription(
        `Split/merge wizard - finish splitting success: [${success}]`
      );
    }

    if (success) {
      this.userActionLogService.addUserActionDescription(
        'Split/merge wizard - Finish succeeded'
      );
      this.closeDialog();
    } else {
      this.userActionLogService.addUserActionDescription(
        'Split/merge wizard - Finish failed'
      );
    }
  }

  private subscribeToSelectedParts() {
    this.microplanMapEvents
      .getSelectedSettlementPartsObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((spIds) => {
        this.selectedSettlementPartIds = spIds;

        this.logger.debug(
          'Selected parts in split/wizard: ',
          this.selectedSettlementPartIds
        );

        this.userActionLogService.addUserActionDescription(
          `Settlement split/merge wizard selected ids: ${this.selectedSettlementPartIds.join(
            ', '
          )}`
        );

        this.canMerge = this.selectedSettlementPartIds.length > 1;
        this.canSplit = this.selectedSettlementPartIds.length == 1;
      });
  }

  //When split is done, after the user has drawn a polygon
  public async handleDrawEnd(drawnPolygon: PolygonGeoJson) {
    const success = await callBlockingUiUntilDone(
      this,
      async () => await this.handleDrawEndImpl(drawnPolygon)
    );

    //the above clears the selected settlement part visualization, so we put it back
    this.microplanMapEvents.setSelectedSettlementParts(
      this.selectedSettlementPartIds
    );

    if (success) {
      this.wizardPolygonEdit.finishedDrawing();
      this.myStepper.next();
      return;
    }
    //Otherwise we stay on the editing part
  }
  private async handleDrawEndImpl(
    drawnPolygon: PolygonGeoJson
  ): Promise<boolean> {
    //console.log("handleDrawEnd settlement control");
    // Get the drawn polygon and the intersection with settlements

    console.assert(this.selectedSettlementPartIds.length == 1);

    const selectedSettlementPart = this.bvService.data.spMap.get(
      this.selectedSettlementPartIds[0]
    )!;

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
          'Your shape does not intersect with the settlement you are trying to split.',
        severity: 'warning',
      });

      return false;
    } else {
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

      this.splitChanges = await handleSplitRequestImpl(this, {
        settlementPartId: selectedSettlementPart.properties.global_id,
        polys: polys4326,
      });

      //Check if we want to create a generated settlement name
      if (this.splitChanges.namesToCreate.length > 0) {
        if (
          isMachineGenerated(this.splitChanges.namesToCreate[0].properties.name)
        ) {
          this.logger.info(
            'Splitting will generate a machine generated name, giving user a chance to enter a name'
          );
          this.showEnterPrimaryName = true;

          this.enterPrimaryNameFormGroup
            .get(FORM_KEY_PRIMARY_NAME)!
            .setValue(this.splitChanges.namesToCreate[0].properties.name);

          //Render the enter name step
          await new Promise((p) => setTimeout(p, 1));
          switchWizardCssClass(false);
          //disableMapFullScreen(this);

          //handleDrawEnd will call myStepper.next()
          return true;
        }
      }

      //changes will be saved at the end
      return true;
    }
  }

  startSplitSettlement() {
    this.userActionLogService.addUserActionDescription(
      `split/merge wizard - split clicked ${this.areSplitting}`
    );

    this.areSplitting = true;
    this.areMerging = false;

    this.wizardPolygonEdit.initializeDrawing(false);
  }

  async enterSplitPrimaryName() {
    const name = this.enterPrimaryNameFormGroup.get(
      FORM_KEY_PRIMARY_NAME
    )!.value;

    this.userActionLogService.addUserActionDescription(
      `User entered split primary name as [${name}]`
    );

    if (name && name.length > 0) {
      this.splitChanges!.namesToCreate[0].properties.name = name;
    }

    //This step is valid now
    this.enterPrimaryNameFormGroup.get(FORM_KEY_NAME_CHOSEN)!.setValue(true);

    //Now save the split changes with the chosen name

    this.myStepper.next();
  }

  async chooseMergePrimaryName() {
    this.userActionLogService.addUserActionDescription(
      `Merge clicked in choose primary name step in set. merge -- ${
        this.choosePrimaryNameFormGroup.valid
      } -- ${this.choosePrimaryNameFormGroup.get(FORM_KEY_PRIMARY_NAME)?.value}`
    );

    if (!this.choosePrimaryNameFormGroup.valid) {
      //this.choosePrimaryNameFormGroup.get(FORM_KEY_PRIMARY_NAME).updateValueAndValidity();

      //To show the missing field in red
      this.myStepper.next();
      return;
    }

    //work is done at on finish
    this.myStepper.next();
  }

  async mergeSettlements() {
    this.userActionLogService.addUserActionDescription(
      'Split/Merge wizard - Merge settlement clicked'
    );
    this.areMerging = true;
    this.areSplitting = false;

    //The work will wait until the user clicks finish

    //First stay here on this step if we have any errors
    const [allNames, _settlementParts] = handleMergeRequestErrors(
      this,
      this.selectedSettlementPartIds
    );

    //If any errors this will be true
    if (allNames.length == 0) {
      this.logger.info('Some error should be shown on merge settlements');
      return;
    }

    //For now, we need to know if we need to prompt the user to choose between 2 primary settlement name
    //points in the 2 or more to be merged polygons

    const primaryNames = allNames.filter((name) => name.properties.is_primary);
    const nameCandidates = primaryNames.filter(
      (name) => !isMachineGenerated(name.properties.name)
    );

    this.logger.info(
      `# of primary names ${primaryNames.length} of those non machine generated ${nameCandidates.length}`
    );

    if (nameCandidates.length > 1) {
      this.userActionLogService.addUserActionDescription(
        'User needs to choose primary name'
      );
      this.showChoosePrimaryName = true;
      this.primaryNameOptions = nameCandidates.map((nc) => {
        return {
          value: nc.properties.global_id,
          label: nc.properties.name,
        };
      });
      //Render the enter name step
      await new Promise((p) => setTimeout(p, 1));
      //we maintain in full screen mode througouh
      //disableMapFullScreen(this);
      switchWizardCssClass(false);

      //continue below where we call next step
    }

    //No name choice needed, lets continue.  This can happen if one of the names is
    //machine generated

    this.myStepper.next();
  }

  //Note this is called at the end
  //At this point there should be no errors and
  async mergeSettlementsImpl(): Promise<boolean> {
    this.logger.debug(
      'Selected settlement parts =',
      this.selectedSettlementPartIds
    );

    //Check if we need to choose a primary name first
    const [allNames, _settlementParts] = handleMergeRequestErrors(
      this,
      this.selectedSettlementPartIds
    );

    if (allNames.length == 0) {
      return false;
    }

    const primaryNames = allNames.filter((name) => name.properties.is_primary);
    const nameCandidates = primaryNames.filter(
      (name) => !isMachineGenerated(name.properties.name)
    );

    this.logger.info(
      `# of primary names ${primaryNames.length} of those non machine generated ${nameCandidates.length}`
    );

    if (nameCandidates.length > 1) {
      this.showChoosePrimaryName = true;
      this.primaryNameOptions = nameCandidates.map((nc) => {
        return {
          value: nc.properties.global_id,
          label: nc.properties.name,
        };
      });
      //Render the enter name step
      await new Promise((p) => setTimeout(p, 1));
      //disableMapFullScreen(this);
      switchWizardCssClass(false);

      //mergeSettlements will call next step
      return true;
    }

    if (primaryNames.length == 0) {
      this.messageService.add({
        summary: 'Settlement parts have no primary names',
        severity: 'error',
      });

      return false;
    } else {
      let chosenName: GeoJsonSettlementName | null = null;
      if (nameCandidates.length == 1) {
        chosenName = nameCandidates[0];
      } else {
        //sort names
        primaryNames.sort((n1, n2) => {
          //has are less
          const sp1 = this.bvService.data.spMap.get(
            n1.properties.settlement_part!
          )!;
          const sp2 = this.bvService.data.spMap.get(
            n2.properties.settlement_part!
          )!;

          const level1 = getSettlementTypeLevel(sp1.properties.type);
          const level2 = getSettlementTypeLevel(sp2.properties.type);
          return level1 - level2;
        });

        chosenName = primaryNames[primaryNames.length - 1];
      }

      return await handleMergeRequestImpl(
        this,
        this.selectedSettlementPartIds,
        chosenName.properties.global_id
      );
    }
  }
}

function getSettlementTypeLevel(settlementType: SettlementType): number {
  switch (settlementType) {
    case 'gmt':
      return 0;
    case 'bua':
      return 3;
    case 'ssa':
      return 2;
    case 'ha':
      return 1;
  }
}

interface SplitSettlementRequest {
  settlementPartId: string;
  polys: Array<MultiPolygon>;
}

async function handleMergeRequestImpl(
  component: MergeComponent,
  settlementPartIds: Array<string>,
  primaryNameId: string
): Promise<boolean> {
  const actionId = uuidv4();

  //Do all error handling up front before we start changing things
  const [allNames, settlementParts] = handleMergeRequestErrors(
    component,
    settlementPartIds
  );

  if (!settlementParts || settlementParts.length <= 0) {
    return false;
  }

  const chosenName = component.bvService.data.snMap.get(primaryNameId)!;

  //Ok, now we start modifying

  //Fuse all the settlement parts
  let multiPoly = handleMergeRequestFuseGeometries(
    settlementParts,
    component.logger
  );

  if (!multiPoly) {
    component.logger.error('Not able to fuse geometries');
    //We have to stop because otherwise we risk losing settlement geometry surface area
    component.messageService.add(GENERIC_MESSAGE_SERVICE_ARGS);
    return false;
  }

  const multiSettlementPart = handleMergeRequestBuildGeoJson(
    component,
    settlementParts,
    chosenName,
    multiPoly
  );

  /*
    For https://github.com/novelt/GMT/issues/2740 we want to preserve the exclude/include relationships
    based on the name.  By preserving the settlement part global id, this accomplishes that
    */
  const chosenPrimaryNameSp = chosenName.properties.settlement_part;

  for (const sp of settlementParts) {
    if (sp.properties.global_id != chosenPrimaryNameSp) {
      await component.crudLayerService.deleteItem(
        'settlement__part',
        sp.properties.global_id,
        false,
        false,
        actionId
      );

      //Remove all include/exclude items associated with that settlement part
      const ciList = component.bvService.data.getCatchmentForSp(
        sp.properties.global_id,
        false,
        false
      );
      for (const ci of ciList) {
        if (ci.properties.type == 'generated') {
          continue;
        }

        //note we don't need to notify (refreshing observables) since computeAllCatchmentAssignments will
        //do that.  And invalid exclude entries won't change anything.
        await component.crudLayerService.deleteItem(
          'ri__catchment_item',
          ci.properties.global_id,
          false,
          false,
          actionId
        );
      }
    } else {
      //Keep the global id the same, so essentially the chosen primary name's settlement part grows
      multiSettlementPart.properties.global_id = chosenPrimaryNameSp;
      resetRasterSettlementPartFields(multiSettlementPart);
      manuallyPopulateSettlementPartFieldsIfNeeded(multiSettlementPart);
      await component.bvService.updateSettlementPartPop(multiSettlementPart);
      await component.crudLayerService.updateItem(
        'settlement__part',
        multiSettlementPart,
        false,
        false,
        actionId
      );
    }
  }

  //assign all non-generated names to the new merged part
  await updateOrDeleteSettlementNames(
    component,
    allNames,
    chosenName,
    actionId,
    multiSettlementPart.properties.global_id
  );

  await component.crudLayerService.updateObservableAfterCrud(
    'settlement__part'
  );
  await component.crudLayerService.updateObservableAfterCrud(
    'settlement__name'
  );
  await component.crudLayerService.updateObservableAfterCrud(
    'ri__catchment_item'
  );
  //In cases of multiple primary names, we leave as is

  component.microplanMapEvents.setSelectedSettlementParts([]);

  await component.bvService.computeAllCatchmentAssignments(
    [multiSettlementPart],
    actionId,
    new Set()
  );

  return true;
}

export interface MergeComponent {
  bvService: BoundaryVectorLayersService;
  messageService: MessageService;
  isLoadingService: IsLoadingService;
  rasterService: RasterDataService;
  crudLayerService: CrudLayerService;
  mapEvents: MapEventsService;
  microplanMapEvents: MicroplanMapEventsService;
  logger: NGXLogger;
}

function handleSplitRequestErrors(
  component: MergeComponent,
  sr: SplitSettlementRequest
): [GeoJsonSettlementPart | null, Array<GeoJsonSettlementName>] {
  const splitSettlement = component.bvService.data.spMap.get(
    sr.settlementPartId
  );

  if (!splitSettlement) {
    component.logger.error(
      `Cannot find settlement in spMap part with id ${sr.settlementPartId}`
    );
    return [null, []];
  }
  const namesList = component.bvService.data.spToSnMap.get(sr.settlementPartId);

  //Even if empty, should still have an []
  if (!Array.isArray(namesList)) {
    component.logger.error(
      `Cannot find settlement part with id ${sr.settlementPartId}`
    );
    return [null, []];
  }

  if (
    component.bvService.boundaryInfo.boundary.properties.global_id !=
    splitSettlement.properties.boundary_polygon
  ) {
    component.logger.error(
      `Settlement part boundary inconsistent with current boundary ${component.bvService.boundaryInfo.boundary.properties.global_id} != ${splitSettlement.properties.boundary_polygon}`
    );
    return [null, []];
  }

  return [splitSettlement, namesList];
}

export async function handleSplitRequestImpl(
  component: MergeComponent,
  sr: SplitSettlementRequest
): Promise<SettlementChanges> {
  const [splitSettlement, namesList] = handleSplitRequestErrors(component, sr);

  const changes: SettlementChanges = {
    partsToDelete: [],
    namesToDelete: [],
    partsToCreate: [],
    namesToCreate: [],
    namesToUpdate: [],
    partsToUpdate: [],
    riToDelete: [],
  };

  if (!splitSettlement) {
    return changes;
  }

  component.logger.info(`handleSplitRequestHelper`, sr);

  //Delete the settlement part
  changes.partsToDelete.push(
    component.bvService.data.spMap.get(sr.settlementPartId)!
  );

  //Remove all exclude = true items associated with that settlement part
  //Not that exlude = false get recalculated automatically
  const ciList = component.bvService.data.getCatchmentForSp(
    sr.settlementPartId,
    false,
    false
  );
  for (const ci of ciList) {
    if (ci.properties.type != 'generated') {
      continue;
    }

    //note we don't need to notify (refreshing observables) since computeAllCatchmentAssignments will
    //do that.  And invalid exclude entries won't change anything.
    changes.riToDelete.push(ci);
  }

  //Create the 2 other parts
  const partJsonList: Array<GeoJsonSettlementPart> =
    await handleSplitRequestCreateNewParts(
      component,
      splitSettlement,
      sr,
      changes
    );

  //Reassign the names geospatially
  const namesPerPart = await handleSplitRequestAssignNames(
    component,
    partJsonList,
    namesList,
    changes
  );

  //Find any unnamed settlement parts, and either
  //try to find alternate name, choose 1 at random, and promote it, or generate a name
  await handleSplitRequestEnsurePartsAreNamed(
    component,
    partJsonList,
    namesPerPart,
    changes
  );

  //In cases of multiple primary names, we leave as is

  return changes;
}

async function updateOrDeleteSettlementNames(
  component: MergeComponent,
  allNames: GeoJsonSettlementName[],
  chosenPrimaryName: GeoJsonSettlementName,
  actionId: string,
  mergedSettlementPartGlobalId: string
) {
  component.logger.debug(`Processing names`, allNames);
  for (const name of allNames) {
    if (name.properties.global_id == chosenPrimaryName.properties.global_id) {
      //since this is the chosen primary name, it is already pointed to the settlement part that has now grown
      continue;
    }

    if (isMachineGenerated(name.properties.name)) {
      await component.crudLayerService.deleteItem(
        'settlement__name',
        name.properties.global_id,
        false,
        false,
        actionId
      );
      continue;
    }

    //Make non primary
    name.properties.settlement_part = mergedSettlementPartGlobalId;
    name.properties.is_primary = false;
    component.logger.debug(`Making name ${name.properties.name} non primary`);
    await component.crudLayerService.updateItem(
      'settlement__name',
      name,
      false,
      false,
      actionId
    );
  }
}

function handleMergeRequestErrors(
  component: MergeComponent,
  settlementPartIds: Array<string>
): [Array<GeoJsonSettlementName>, Array<GeoJsonSettlementPart>] {
  const settlementParts: Array<GeoJsonSettlementPart> = [];

  for (const sId of settlementPartIds) {
    const sp = component.bvService.data.spMap.get(sId);

    if (!sp) {
      component.logger.error(`Cannot find settlement part with id ${sId}`);
      component.messageService.add(GENERIC_MESSAGE_SERVICE_ARGS);
      return [[], []];
    }

    if (sp.properties.boundary_polygon != component.bvService.data.boundaryId) {
      component.messageService.add({
        summary: 'Not allowed to merge settlements from another boundary',
        severity: 'error',
      });
      return [[], []];
    }

    settlementParts.push(sp);
  }

  if (settlementParts.length < 2) {
    component.messageService.add({
      summary: 'Please select at least 2 settlement boundaries to merge',
      severity: 'error',
    });
    return [[], []];
  }

  //Find all names associated with the previous parts

  const allNames: Array<GeoJsonSettlementName> = [];

  for (const sp of settlementParts) {
    //Support error case if settlement part has no names
    const names =
      component.bvService.data.spToSnMap.get(sp.properties.global_id) || [];

    // if (!names) {
    //   component.logger.info(`EEE Could not find associated names for ${sp.properties.global_id}`);
    //   component.messageService.add(GENERIC_MESSAGE_SERVICE_ARGS);
    //   return [[], []];
    // }

    allNames.push(...names);
  }

  //Because the names can be updated to switch is primary flag
  return [cloneDeep(allNames), settlementParts];
}

function handleMergeRequestFuseGeometries(
  settlementParts: Array<GeoJsonSettlementPart>,
  logger: NGXLogger
): MultiPolygon | null {
  const spGeometries = settlementParts.map(
    (sp) => sp.geometry.coordinates as Array<Array<Array<Position>>>
  );
  try {
    const multiPoly = polyclip.union(spGeometries[0], ...spGeometries.slice(1));
    return {
      type: 'MultiPolygon',
      coordinates: multiPoly,
    };
  } catch (e) {
    logger.error(e);

    return null;
  }
  /*let multiPoly: MultiPolygon = cloneDeep(settlementParts[0].geometry);

  //merge from index 1 to the end
  for (const sp of settlementParts.slice(1)) {
    //Sp should always be multipolygons
    if (sp.geometry.type != 'MultiPolygon') {
      logger.warn(`sp ${sp.properties.global_id} is not a multipolygon`);
    }

    logger.debug(`Merging sp [${sp.properties.global_id}]`);

    try {
      for (const polyCords of sp.geometry.coordinates) {
        logger.debug(
          `Merging polyCords sp [${sp.properties.global_id}] ${polyCords.length}`
        );
        const tp = turfPolygon(polyCords);
        const smallBuffer = buffer(tp, 0.25, { units: 'meters' });
        const unionMulti = union(multiPoly, smallBuffer);
        if (!unionMulti) {
          return null;
        }

        if (unionMulti.geometry.type == 'Polygon') {
          multiPoly.coordinates = [
            unionMulti.geometry.coordinates as Array<Array<Position>>,
          ];
        } else {
          //multipolygon
          multiPoly.coordinates = unionMulti.geometry.coordinates as Array<
            Array<Array<Position>>
          >;
        }
      }
    } catch (e) {
      logger.error(e);

      return null;
    }
  }

  return multiPoly;*/
}

function handleMergeRequestBuildGeoJson(
  component: MergeComponent,
  settlementParts: Array<GeoJsonSettlementPart>,
  chosenPrimaryName: GeoJsonSettlementName,
  multiPoly: MultiPolygon
): GeoJsonSettlementPart {
  //Figure out a name (this is internal use only, for sorting mainly at the moment)
  const mergedName = chosenPrimaryName.properties.name;
  //The type
  let type: SettlementType = 'gmt';
  for (const sp of settlementParts) {
    if (sp.properties.type == 'bua') {
      type = 'bua';
      //No need to check further
      break;
    }

    //SSA cannot trump BUA, note once type is bua we already quit the loop; so type can never be bua
    if (sp.properties.type == 'ssa') {
      type = 'ssa';
    }

    //HA can only trump gmt
    if (sp.properties.type == 'ha' && type == 'gmt') {
      type = 'ha';
    }
  }

  //original guids
  const allParentGuids = new Set<string>();
  settlementParts.forEach((p) => {
    allParentGuids.add(p.properties.global_id);
    for (const og of p.properties.original_guids) {
      allParentGuids.add(og);
    }
  });
  const original_guids = Array.from(allParentGuids);

  const theBbox = bbox(multiPoly) as BBox2d;

  const multiSettlementPart: GeoJsonSettlementPart = {
    type: 'Feature',
    properties: {
      ...DefaultGeoJSonSettlementPartProperties,
      global_id: uuidv4(),
      boundary_polygon:
        component.bvService.boundaryInfo.boundary.properties.global_id,
      type,
      split_type: 'merged_by_hand',
      //If this happened to be split automatically, once the user touches it, it's no longer managed automatically
      split_parent: null,
      settlement_name: mergedName,
      original_guids,
      bbox: theBbox,
    },
    geometry: multiPoly,
  };

  return multiSettlementPart;
}

async function handleSplitRequestCreateNewParts(
  component: MergeComponent,
  splitSettlement: GeoJsonSettlementPart,
  sr: SplitSettlementRequest,
  changes: SettlementChanges
): Promise<Array<GeoJsonSettlementPart>> {
  const partJsonList: Array<GeoJsonSettlementPart> = sr.polys.map((p) => {
    const geometry: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: p.coordinates,
    };
    const bbox = turfBbox(geometry) as BBox2d;

    const sp: GeoJsonSettlementPart = {
      type: 'Feature',
      properties: {
        ...DefaultGeoJSonSettlementPartProperties,
        global_id: uuidv4(),
        boundary_polygon: splitSettlement.properties.boundary_polygon,
        settlement_name: splitSettlement.properties.settlement_name,
        type: splitSettlement.properties.type,
        split_type: 'split_by_hand',
        //If this happened to be split automatically, once the user touches it, it's no longer managed automatically
        split_parent: null,
        original_guids: joinListUnique(
          splitSettlement.properties.original_guids,
          [splitSettlement.properties.global_id]
        ),
        bbox,
      },
      geometry,
    };

    return sp;
  });

  for (const newPart of partJsonList) {
    resetRasterSettlementPartFields(newPart);
    manuallyPopulateSettlementPartFieldsIfNeeded(newPart);
    await component.bvService.updateSettlementPartPop(newPart);

    changes.partsToCreate.push(newPart);
  }

  return partJsonList;
}

async function handleSplitRequestAssignNames(
  component: MergeComponent,
  partJsonList: Array<GeoJsonSettlementPart>,
  namesList: Array<GeoJsonSettlementName>,
  changes: SettlementChanges
): Promise<Array<Array<GeoJsonSettlementName>>> {
  const namesPerPart: Array<Array<GeoJsonSettlementName>> = [];

  for (const sp of partJsonList) {
    namesPerPart.push([]);
  }

  for (const name of namesList) {
    let newPartId: string | null = null;
    for (const [idx, newPart] of partJsonList.entries()) {
      if (geometryIntersects(newPart, name)) {
        newPartId = newPart.properties.global_id;
        namesPerPart[idx].push(name);
        break;
      }
    }

    component.logger.info(
      `Setting settlement part of ${name.properties.global_id} / ${name.properties.name} to ${newPartId}`
    );
    //This could in theory by null, which is ok
    name.properties.settlement_part = newPartId;
    //await component.crudLayerService.updateItem("settlement__name", name, false, false, actionId);
    changes.namesToUpdate.push(name);
  }

  //await component.crudLayerService.bulkUpdateItem("settlement__name", namesList, false, false, actionId);

  return namesPerPart;
}

async function handleSplitRequestEnsurePartsAreNamed(
  component: MergeComponent,
  partJsonList: Array<GeoJsonSettlementPart>,
  namesPerPart: Array<Array<GeoJsonSettlementName>>,
  changes: SettlementChanges
) {
  for (let idx = 0; idx < namesPerPart.length; idx += 1) {
    const pnList = namesPerPart[idx].filter((n) => n.properties.is_primary);

    if (pnList.length > 0) {
      component.logger.info(
        `Part #${idx} has ${pnList.length} primary names, setting settlement part name to ${pnList[0].properties.name}`
      );

      partJsonList[idx].properties.settlement_name = pnList[0].properties.name;

      changes.partsToUpdate.push(partJsonList[idx]);

      continue;
    }

    const anList = namesPerPart[idx].filter((n) => !n.properties.is_primary);

    if (anList.length > 0) {
      component.logger.info(
        `Part #${idx} has an alternate name ${anList.length}, promoting first one ${anList[0].properties.name}`
      );
      anList[0].properties.is_primary = true;

      changes.namesToUpdate.push(anList[0]);

      //also update name of settlement part
      partJsonList[idx].properties.settlement_name = anList[0].properties.name;
      changes.partsToUpdate.push(partJsonList[idx]);
    } else {
      //generate a machine name
      const centroid_part = pointOnFeature(partJsonList[idx]);

      const geojson: GeoJsonSettlementName = {
        type: 'Feature',
        properties: {
          ...DefaultGeoJSonSettlementNameProperties,
          global_id: uuidv4(),
          boundary_polygon: partJsonList[idx].properties.boundary_polygon,
          name: generateSettlementName(
            partJsonList[idx].properties.type,
            centroid_part.geometry.coordinates[0],
            centroid_part.geometry.coordinates[1]
          ),
          is_primary: true,
          settlement_part: partJsonList[idx].properties.global_id,
        },
        geometry: centroid_part.geometry as Point,
      };

      changes.namesToCreate.push(geojson);
    }
  }
}
