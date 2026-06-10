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
import { LocationControlOutput } from '@components/wizard/wizard-location-control/wizard-location-control.component';
import {
  MapEventsService,
  OverlayLayer,
} from '@services/map/base/map-events.service';
import { UserActionLogService } from '@services/user-action-log.service';
import { BBox2d } from '@turf/helpers/dist/js/lib/geojson';
import {
  bbox,
  bbox as turfBbox,
  buffer,
  feature,
  Feature as TurfFeature,
  featureCollection,
  intersect,
  MultiPolygon as TurfMultiPolygon,
  pointOnFeature,
  Polygon as TurfPolygon,
  union,
  voronoi,
} from '@turf/turf';
import * as _ from 'lodash';
import cloneDeep from 'lodash/cloneDeep';
import { NGXLogger } from 'ngx-logger';
import { containsXY, intersects } from 'ol/extent';
import { filter, Subject, switchMap, takeUntil } from 'rxjs';
import { problematicOptions } from 'src/app/constants/st.constants';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import {
  manuallyPopulateSettlementPartFieldsIfNeeded,
  resetRasterSettlementPartFields,
} from 'src/app/services/geo/Rasterize';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { MessageService } from 'src/app/services/shared/notifications/message.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  DefaultGeoJSonSettlementNameProperties,
  DefaultGeoJSonSettlementPartProperties,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
  MultiPolygon,
  Polygon,
  Polygon as PolygonGeoJson,
  Position,
  ProblematicOption,
} from 'src/app/utils/server-interfaces/GeoJson';
import {
  geometryIntersects,
  isEmpty,
} from 'src/app/utils/server-interfaces/utils/geom.util';
import {
  formatPopulation,
  isMachineGenerated,
  joinListUnique,
} from 'src/app/utils/string-formatting';
import { SelectOption } from 'src/app/utils/ui/ui-component-interfaces';
import { newSettlementStyle } from 'src/app/_shared/map/styles/map-settlement-styles';
import { v4 as uuidv4 } from 'uuid';
import {
  addWizardCssClassToCdkOverlayWrapper,
  switchWizardCssClass,
} from '../health-facility-wizard/health-facility-wizard.component';
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

/*
TODO db changes remove population_perc field
Perhaps add settlement_part => settlement_name link?
Add the split fields
*/

/*
Design note

When the user adds a settlement point, we have some cases

1)  Does not intersect any settlement part

We create a buffered point (to be fixed -- https://github.com/novelt/GMT/issues/2762)

or the user can draw a polygon that does not intersect anything

2)  Intersects a settlement part AND an split_type = 'auto_split_parent'

Same as case 3 but no auto split parent settlement part is created

As in case 3, the existing settlement names will still point to the same settlement parts,
but those settlement parts get regenerated as v polygons using all existing children
of the auto split parent (via property split_parent).

3)  Intersects a settlement part AND NOT an split_type = 'auto_split_parent'

the existing settlement part's global id is maintained, shape is the new v polygon
new settlement part is created for the new settlement point

a new settlement part is created with the original settlement parts geometry
with split_type = 'auto_split_parent'

*/

const GENERIC_SPLIT_ERROR =
  'An internal error occured, please send the logs to an administrator for analysys';

export interface SettlementWizardDialogData {}

const FORM_KEY_NAME = 'name';

const FORM_KEY_LATITUDE = 'latitude';
const FORM_KEY_LONGITUDE = 'longitude';
const FORM_KEY_SET_WITH_GPS = 'set_with_gps';
const FORM_KEY_ESTIMATED_POP = 'estimatedPop';
const FORM_KEY_COMPUTED_POP = 'computedPop';
const FORM_KEY_UNINHABITED = 'uninhabited';

const FORM_KEY_SYNONYM = 'synonym';
const FORM_KEY_PROBLEMATIC = 'problematic';

@Component({
  selector: 'gmt-settlement-wizard',
  templateUrl: './settlement-wizard.component.html',
  styleUrls: ['../wizard.less', './settlement-wizard.component.less'],
  standalone: false
})
export class SettlementWizardComponent
  implements OnInit, AfterViewInit, OnDestroy, WizardComponent
{
  FORM_KEY_NAME = FORM_KEY_NAME;

  FORM_KEY_LATITUDE = FORM_KEY_LATITUDE;
  FORM_KEY_LONGITUDE = FORM_KEY_LONGITUDE;
  FORM_KEY_ESTIMATED_POP = FORM_KEY_ESTIMATED_POP;
  FORM_KEY_COMPUTED_POP = FORM_KEY_COMPUTED_POP;
  FORM_KEY_UNINHABITED = FORM_KEY_UNINHABITED;

  FORM_KEY_SYNONYM = FORM_KEY_SYNONYM;
  FORM_KEY_PROBLEMATIC = FORM_KEY_PROBLEMATIC;

  //states of the location tab
  isSetPoint: boolean;
  isDrawBoundaries: boolean;

  leftPanelOpenedBeforeSetPoint = false;

  @HostBinding('style.--matStepperHeaderDisplay') matStepperHeaderDisplay =
    'flex';

  private isLocationValid = false;
  private newSettlementPolygon: Polygon | null = null;

  problematicOptions: Array<SelectOption> = problematicOptions;

  //Reactive, strongly typed Form groups
  basicInformationFormGroup = this._formBuilder.group({
    [FORM_KEY_NAME]: new FormControl<string>('', [
      Validators.required,
      this.validateName.bind(this),
    ]),
    [FORM_KEY_PROBLEMATIC]: new FormControl<Array<ProblematicOption>>([]),
  });
  locationFormGroupOptions: AbstractControlOptions = {
    validators: this.validateLocation.bind(this),
  };
  locationFormGroup = this._formBuilder.group(
    {
      [FORM_KEY_LATITUDE]: new FormControl<number | null>(
        null,
        Validators.required
      ),
      [FORM_KEY_LONGITUDE]: new FormControl<number | null>(
        null,
        Validators.required
      ),
      [FORM_KEY_SET_WITH_GPS]: new FormControl<boolean | null>(null),
    },
    this.locationFormGroupOptions
  );

  additionalInfoFormGroup = this._formBuilder.group({
    [FORM_KEY_UNINHABITED]: [false],
    [FORM_KEY_SYNONYM]: new FormControl<Array<string>>([]),
    [FORM_KEY_ESTIMATED_POP]: new FormControl<number | null>(null),
    [FORM_KEY_COMPUTED_POP]: new FormControl<string>(''),
  });

  @ViewChild('stepper') private myStepper: MatStepper;

  @ViewChild('polygonEditNewSettlementBoundary')
  wizardPolygonEdit: WizardPolygonEditComponent;

  private unsubscribe = new Subject();

  constructor(
    public messageService: MessageService,
    public mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,
    public bvService: BoundaryVectorLayersService,
    public userContextService: UserContextService,
    public crudLayerService: CrudLayerService,
    public isLoadingService: IsLoadingService,
    public dialogRef: MatDialogRef<SettlementWizardComponent>,
    //Used to pass data from the component opening this dialog
    @Inject(MAT_DIALOG_DATA) public data: SettlementWizardDialogData,
    private _formBuilder: FormBuilder,
    public logger: NGXLogger,
    //Used to get current size of the popup
    public elementRef: ElementRef,
    private userActionLogService: UserActionLogService
  ) {}

  ngOnInit(): void {
    this.logger.info('Data for settlement wizard', this.data);

    let dataLoaded = false;

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
        //Load the data once
        if (!dataLoaded) {
          this.initializeWizardUIValues();
          dataLoaded = true;
        }
      });

    //this.subscribeToMapPointLocationConfigChange();
  }
  ngAfterViewInit(): void {
    //to work around ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => {
      enableMapFullScreen(this);

      //Initial step is user input
      switchWizardCssClass(false);

      addWizardCssClassToCdkOverlayWrapper(true);
    }, 1);
  }

  ngOnDestroy() {
    this.logger.debug('settlement wizard destroy');
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  private async updateAfterLocationSet() {
    //Draw on the map where they chose
    const changes = await this.buildChangesToSave();

    if (changes.namesToCreate.length == 1) {
      this.mapEvents.addFeature({
        geo_json: changes.namesToCreate[0],
        style: newSettlementStyle,
        layer: OverlayLayer.NORMAL,
      });

      //Find the new settlement part if any to get computed_pop
      const settlementPart = changes.partsToCreate.find(
        (part) =>
          part.properties.global_id ==
          changes.namesToCreate[0].properties.settlement_part
      );
      if (!settlementPart) {
        //Either we created a new settlement part via drawn boundary or buffer or we
        //created a new voronoi polygon to maintain 1 settlement part per primary settlement name
        this.logger.warn(`Expected a new settlement part for the new name`);
      } else {
        this.additionalInfoFormGroup
          .get(FORM_KEY_COMPUTED_POP)!
          .setValue(
            formatPopulation(
              settlementPart.properties.computed_pop,
              undefined,
              false
            )
          );
      }
    } else {
      this.logger.warn(
        `Expected exactly 1 new name ${changes.namesToCreate.length}`
      );
    }
  }

  async handleLonLatChange(newLonLatOutput: LocationControlOutput) {
    const newLonLat: [number, number] = [
      newLonLatOutput.lon,
      newLonLatOutput.lat,
    ];
    this.logger.debug('handleLonLatChange in settlement wizard', newLonLat);

    //In all cases, the settlement point must be within the ward boundary
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
      return;
    }

    this.isLocationValid = true;

    this.handleChangeSetPointMode(false);

    this.locationFormGroup
      .get(this.FORM_KEY_LATITUDE)!
      .setValue(newLonLatOutput.lat);
    this.locationFormGroup
      .get(this.FORM_KEY_LONGITUDE)!
      .setValue(newLonLatOutput.lon);
    this.locationFormGroup
      .get(FORM_KEY_SET_WITH_GPS)!
      .setValue(newLonLatOutput.set_with_gps);

    await this.updateAfterLocationSet();

    this.myStepper.next();
  }

  handleDrawBoundaries() {
    this.userActionLogService.addUserActionDescription(
      'Drawing settlement boundaries'
    );
    //User will click a point now, we need the overlay disabled
    switchWizardCssClass(true);

    this.isDrawBoundaries = true;
    this.wizardPolygonEdit.initializeDrawing(false);
  }

  handleChangeSetPointMode(newSetPoint: boolean) {
    if (newSetPoint) {
      this.userActionLogService.addUserActionDescription(
        `Adding settlement point`
      );
    }

    //User will click a point now, we need the overlay disabled
    switchWizardCssClass(true);
    this.isSetPoint = newSetPoint;

    if (this.isSetPoint) {
      this.microplanMapEvents.mapPointLocationConfig.next({
        visible: true,
        requestMapLocation: false,
      });
    } else {
      this.microplanMapEvents.mapPointLocationConfig.next({
        visible: false,
        requestMapLocation: false,
      });
    }
  }

  public handleCancel() {
    this.userActionLogService.addUserActionDescription(
      'Cancelled Settlement wizard'
    );
    this.closeWindow();
  }

  async handleCloseDialog() {
    this.userActionLogService.addUserActionDescription(
      'Settlement wizard saving start'
    );
    //Done button
    if (await this.saveNewSettlement()) {
      this.userActionLogService.addUserActionDescription(
        'Settlement wizard saving stop success'
      );
      this.closeWindow();
    }
  }

  private closeWindow() {
    this.wizardPolygonEdit.finishedDrawing();
    disableMapFullScreen(this);
    addWizardCssClassToCdkOverlayWrapper(false);
    this.dialogRef.close();
  }

  async initializeAdditionalInfoStep() {
    await this.updateAfterLocationSet();
  }

  private buildNewSettlement(): GeoJsonSettlementName {
    return {
      type: 'Feature',
      properties: {
        ...DefaultGeoJSonSettlementNameProperties,
        global_id: uuidv4(),
        boundary_polygon:
          this.bvService.boundaryInfo.boundary.properties.global_id,
        is_primary: true,
      },
      geometry: {
        type: 'Point',
        coordinates: [0, 0],
      },
    } as GeoJsonSettlementName;
  }

  /**
   * When saving a settlement name without a corresponding settlement part, we create a new one by buffering around the new name.
   * This buffer becomes a new settlement part.
   * @param newSettlement
   * @param actionId
   * @returns
   */
  private async getChangesNewSettlementPart(
    newSettlement: GeoJsonSettlementName,
    settlementPolygonCoordinates: Array<Array<Position>>,
    changes: SettlementChanges
  ) {
    let settlementPart: GeoJsonSettlementPart | null = null;

    const global_id = uuidv4();

    const geometry: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [settlementPolygonCoordinates],
    };

    const bbox = turfBbox(geometry) as BBox2d;

    //create a new settlement part
    settlementPart = {
      type: 'Feature',
      properties: {
        ...DefaultGeoJSonSettlementPartProperties,
        global_id,
        boundary_polygon:
          this.bvService.boundaryInfo.boundary.properties.global_id,
        version_id: null,
        type: 'gmt',
        settlement_name: newSettlement.properties.name,
        original_guids: [global_id],
        bbox,
      },
      geometry,
    };

    newSettlement.properties.settlement_part =
      settlementPart.properties.global_id;

    await this.bvService.updateSettlementPartPop(settlementPart);

    changes.partsToCreate.push(settlementPart);
  }

  private async getChangesWithNewSettlementPart(
    newSettlement: GeoJsonSettlementName,
    changes: SettlementChanges
  ) {
    if (this.newSettlementPolygon) {
      await this.getChangesNewSettlementPart(
        newSettlement,
        this.newSettlementPolygon.coordinates,
        changes
      );
    } else {
      let bufferGeom: TurfFeature<TurfPolygon> = buffer(newSettlement, 100, {
        units: 'meters',
      });
      await this.getChangesNewSettlementPart(
        newSettlement,
        bufferGeom.geometry.coordinates as Array<Array<Position>>,
        changes
      );
    }

    changes.namesToCreate.push(newSettlement);
  }

  /*
    Compute all the settlement names involved in the veronoi split

    Also any machine generated names will be deleted (primary or no)

    @return A list of non machine generated primary names
    */
  private collectVeronoiNames(
    veronoiChanges: SettlementChanges,
    splitParentSettlementPart: GeoJsonSettlementPart
  ): Array<GeoJsonSettlementName> {
    const names: Array<GeoJsonSettlementName> = [];

    if (
      splitParentSettlementPart.properties.split_type == 'auto_split_parent'
    ) {
      //Find all the children that have been created from the original auto split parent
      const spChildren = this.bvService.data.spList.filter(
        (sp) =>
          sp.properties.split_parent ==
          splitParentSettlementPart.properties.global_id
      );

      //If we have no children, one conceivable case is that the user manually modified all the children, so in this case, we'll try
      //deleting it and starting the process over again
      if (spChildren.length == 0) {
        //determineVoronoiParentGeometry should have returned the non automatically managed child
        //settlement part
        this.logger.error(
          `No children found for split parent ${splitParentSettlementPart.properties.global_id}`
        );
        throw new Error(GENERIC_SPLIT_ERROR);
      }

      for (const sp of spChildren) {
        names.push(
          ...this.bvService.data.spToSnMap.get(sp.properties.global_id)!
        );

        if (sp.properties.split_type != 'auto_split_child') {
          this.logger.error(
            'Settlement part with split parent does not have type auto split child',
            sp
          );
          throw Error(GENERIC_SPLIT_ERROR);
        }

        veronoiChanges.partsToDelete.push(sp);
      }
    } else {
      //Normal case, get all the names of a single settlement part
      names.push(
        ...(this.bvService.data.spToSnMap.get(
          splitParentSettlementPart.properties.global_id
        ) || [])
      );
    }

    for (const n of names) {
      if (isMachineGenerated(n.properties.name)) {
        veronoiChanges.namesToDelete.push(n);
      }
    }

    const realPrimaryNames = names.filter(
      (n) => n.properties.is_primary && !isMachineGenerated(n.properties.name)
    );
    return realPrimaryNames;
  }

  /*
    This is the case where
    the settlement point intersects an existing settlement part
    and the user is not drawing the polygon themselves
    so we do an automatic split
    */
  private async getChangesNewSettlementWithVeronoiSplit(
    newSettlement: GeoJsonSettlementName,
    //If we are adding a settlement name to a settlement part that has already been automatically split,
    //this should be the original parent, note !  This also be a settlement that we use
    //to create a new split parent
    splitParentSettlementPart: GeoJsonSettlementPart,
    changes: SettlementChanges
  ) {
    const realPrimaryNames = this.collectVeronoiNames(
      changes,
      splitParentSettlementPart
    );
    realPrimaryNames.push(newSettlement);

    const vPolygons = this.buildVeronoiPolygons(
      splitParentSettlementPart,
      realPrimaryNames
    );

    const autoSplitParent = this.getOrBuildAutoSplitParent(
      splitParentSettlementPart,
      changes
    );

    for (const feature of vPolygons) {
      const matchingName = realPrimaryNames.find((name) =>
        geometryIntersects(name, feature)
      );

      if (!matchingName) {
        this.logger.error(
          'Unable to find name matching name for voronoi polygon'
        );
        throw new Error(GENERIC_SPLIT_ERROR);
      }

      //Create the settlement part
      const settlementPartJson = await this.createVeronoiSettlementPart(
        feature,
        autoSplitParent,
        matchingName
      );

      //https://github.com/novelt/GMT/issues/2740
      //We attempt to perserve settlement part global ids in order to have the includes/excludes not change
      //This also means the split settlement parent will be a new settlement if this is the 1st split

      if (!matchingName.properties.is_primary) {
        this.logger.warn(
          `Expected ${matchingName.properties.name} to be a primary name!`
        );
      }

      if (
        matchingName.properties.global_id == newSettlement.properties.global_id
      ) {
        changes.namesToCreate.push(matchingName);

        changes.partsToCreate.push(settlementPartJson);
        //As we are preserving all the existing names => settlement parts, the only
        //case where we need to set the settlement part is the new one
        matchingName.properties.settlement_part =
          settlementPartJson.properties.global_id;
      } else {
        //No changes needed on the settlement name, only the settlement part
        //Make the settlement part id match
        settlementPartJson.properties.global_id =
          matchingName.properties.settlement_part!;

        //TODO make sure to remove from changes.partsToDelete in collectVeronoiNames

        //Here the shape has changed
        changes.partsToUpdate.push(settlementPartJson);
        //changes.namesToUpdate.push(matchingName);
      }
    }
  }

  private getOrBuildAutoSplitParent(
    splitParentSettlementPart: GeoJsonSettlementPart,
    changes: SettlementChanges
  ): GeoJsonSettlementPart {
    //If this is the initial split, then we want to create a new settlement part
    //Otherwise we have nothing to do
    if (
      splitParentSettlementPart.properties.split_type == 'auto_split_parent'
    ) {
      this.logger.info(
        'Auto split parent already exists, no need to create split parent'
      );
      //Note in theory we could just have 2 names (the existing and new)
      //for example
      //Add a 2nd name, create a parent
      //merge this with some other settlement
      //Add a 3rd name, have 2 names and an existing auto split parent
      return splitParentSettlementPart;
    } else {
      this.logger.info(
        'Auto split parent does not exist, creating a split parent'
      );
      splitParentSettlementPart = _.cloneDeep(splitParentSettlementPart);
      splitParentSettlementPart.properties.global_id = uuidv4();
      splitParentSettlementPart.properties.split_type = 'auto_split_parent';
      splitParentSettlementPart.properties.split_parent = null;
      changes.partsToCreate.push(splitParentSettlementPart);
      return splitParentSettlementPart;
    }
  }

  private async createVeronoiSettlementPart(
    voronoiFeature: TurfFeature<TurfMultiPolygon | TurfPolygon>,
    autoSplitParent: GeoJsonSettlementPart,
    matchingName: GeoJsonSettlementName
  ): Promise<GeoJsonSettlementPart> {
    const coordinates: Position[][][] =
      voronoiFeature.geometry.type === 'MultiPolygon'
        ? (voronoiFeature.geometry.coordinates as Position[][][])
        : [voronoiFeature.geometry.coordinates as Position[][]];

    const geometry: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates,
    };
    const bbox = turfBbox(geometry) as BBox2d;

    let settlementPartJson: GeoJsonSettlementPart = {
      type: 'Feature',
      properties: {
        ...DefaultGeoJSonSettlementPartProperties,
        global_id: uuidv4(),
        boundary_polygon: autoSplitParent.properties.boundary_polygon,
        settlement_name: matchingName.properties.name,
        type: autoSplitParent.properties.type,
        split_parent: autoSplitParent.properties.global_id,
        split_type: 'auto_split_child',
        original_guids: joinListUnique(
          autoSplitParent.properties.original_guids,
          [autoSplitParent.properties.global_id]
        ),
        bbox,
      },
      geometry,
    };

    await this.bvService.updateSettlementPartPop(settlementPartJson);
    resetRasterSettlementPartFields(settlementPartJson);
    manuallyPopulateSettlementPartFieldsIfNeeded(settlementPartJson);

    return settlementPartJson;
  }

  private buildVeronoiPolygons(
    splitParentSettlementPart: GeoJsonSettlementPart,
    realPrimaryNames: Array<GeoJsonSettlementName>
  ): Array<TurfFeature<TurfMultiPolygon | TurfPolygon>> {
    //If we have no names, then the polygon we want is just the one from the split parent
    if (realPrimaryNames.length == 1) {
      this.logger.info(
        'Only 1 name machine generated names, returning parent geometry'
      );
      return [feature(splitParentSettlementPart.geometry)];
    }

    if (realPrimaryNames.length < 1) {
      this.logger.error('Empty array of names');
      throw new Error(GENERIC_SPLIT_ERROR);
    }

    //The actual parent is the union of the current children of the split parent (or just the normal settlement part)
    //Note that if a user further modifiers an auto split child, it's no longer considered in the auto vonornoi process
    let spUnionParent: null | TurfFeature<TurfPolygon | TurfMultiPolygon> =
      null;

    if (
      splitParentSettlementPart.properties.split_type == 'auto_split_parent'
    ) {
      //Find all the children that have been created from the original auto split parent
      const spChildren = this.bvService.data.spList.filter(
        (sp) =>
          sp.properties.split_parent ==
          splitParentSettlementPart.properties.global_id
      );
      for (const [spIdx, sp] of spChildren.entries()) {
        if (spIdx == 0) {
          spUnionParent = sp;
        } else {
          spUnionParent = union(spUnionParent!, sp);
        }

        if (isEmpty(spUnionParent)) {
          this.logger.error('Empty Settlement part union');
          throw new Error(GENERIC_SPLIT_ERROR);
        }
      }
    } else {
      spUnionParent = splitParentSettlementPart;
    }

    const bboxSettlementPart = bbox(splitParentSettlementPart);
    const vFeatureCollection = voronoi(featureCollection(realPrimaryNames), {
      bbox: bboxSettlementPart,
    });

    //Filter out any empty v polygons
    const features = vFeatureCollection.features;
    const nonEmptyFeatures = features.filter((f) => !isEmpty(f));

    if (realPrimaryNames.length != nonEmptyFeatures.length) {
      this.logger.error(
        `Not all HFs and Primary names have a unique voronoi polygon ${features.length} vs ${nonEmptyFeatures.length}`,
        features
      );
      throw new Error(GENERIC_SPLIT_ERROR);
    }

    const ret: Array<TurfFeature<TurfMultiPolygon | TurfPolygon>> = [];
    for (const feature of nonEmptyFeatures) {
      //We don't want the raw veronoi polygon, but the subset of the split parent
      const settlementPartGeom = intersect(feature, spUnionParent!);

      if (isEmpty(settlementPartGeom)) {
        this.logger.error('Settlement name point empty');
        throw new Error(GENERIC_SPLIT_ERROR);
      }

      if (
        settlementPartGeom!.geometry.type != 'MultiPolygon' &&
        settlementPartGeom!.geometry.type != 'Polygon'
      ) {
        this.logger.error(
          'Voronoi intersection not a multipolygon nor a polygon'
        );
        throw new Error(GENERIC_SPLIT_ERROR);
      }

      ret.push(settlementPartGeom!);
    }

    return ret;
  }

  private async saveNewSettlement(): Promise<boolean> {
    return await callBlockingUiUntilDone(this, async () => {
      const changes = await this.buildChangesToSave();
      await saveSettlementChanges(this, changes);
      await new Promise((p) => setTimeout(p, 3000));
      this.messageService.add({
        summary: 'Settlement created',
      });
      this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL);
      return true;
    });
  }

  private async buildChangesToSave(): Promise<SettlementChanges> {
    const changes: SettlementChanges = {
      namesToCreate: [],
      namesToDelete: [],
      namesToUpdate: [],
      partsToCreate: [],
      partsToDelete: [],
      partsToUpdate: [],
      riToDelete: [],
    };
    const newSettlement = this.buildNewSettlement();
    this.applyFormValues(newSettlement);

    //Lots of cases here, deal with each case, handling the work in a function
    //The general strategy is to store all the changes we need to do and only once the errors have been checked
    //do we start executing crud operations

    //If the user chose to draw a new settlement polygon
    if (this.newSettlementPolygon) {
      this.userActionLogService.addUserActionDescription(
        'User chose to draw a new settlement part polygon'
      );
      await this.getChangesWithNewSettlementPart(newSettlement, changes);
      return changes;
    }

    let intersectingSettlementParts = this.getIntersectingSettlementParts(
      newSettlement.geometry.coordinates
    );

    if (intersectingSettlementParts.length == 0) {
      this.userActionLogService.addUserActionDescription(
        "Users chosen settlement name location doesn't intersect anything, so we create a buffer"
      );
      await this.getChangesWithNewSettlementPart(newSettlement, changes);
      return changes;
    }

    this.userActionLogService.addUserActionDescription(
      `save new settlement with an intersecting part, determine voronoi parent`
    );
    //At this point we will create voronoi settlement parts with the remaining non machine generated names

    //Note at this point we should have validated coordinates that are within the boundary
    let voronoiParent = cloneDeep(
      this.determineVoronoiParentGeometry(intersectingSettlementParts)
    );

    this.userActionLogService.addUserActionDescription(
      `save new settlement with an intersecting part, voronai parent is ${voronoiParent?.properties?.global_id}`
    );

    await this.getChangesNewSettlementWithVeronoiSplit(
      newSettlement,
      voronoiParent,
      changes
    );

    return changes;
  }

  private validateLocation(_control: AbstractControl): ValidationErrors | null {
    //    this.logger.info(`validateLocation`, this);
    console.log(`validateLocation`, this.isLocationValid);

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
    //Default to showing the overlay / user input, set point/draw boundaries will disable the overlay
    switchWizardCssClass(false);

    if (stepEvent.selectedStep.stepControl === this.locationFormGroup) {
      if (this.isDrawBoundaries) {
        //Reinitialize the boundary control if we are back to drawing the boundary
        this.wizardPolygonEdit.initializeDrawing(false);
      }
    }
  }

  showHelp() {
    window.open(
      `${AppConfigService.conf.doc.root}/content/tutorials/20Tutorial2.html#adding-a-settlement`,
      '_blank'
    );
  }

  private initializeWizardUIValues() {
    //debugging; help with settlement wizard dev
    if (AppConfigService.ENABLE_WIZARD_DEBUG) {
      this.basicInformationFormGroup.get(FORM_KEY_NAME)!.setValue('bob town');

      setTimeout(() => {
        this.myStepper.next();
        this.handleChangeSetPointMode(true);

        setTimeout(() => {
          this.handleLonLatChange({
            lon: 8.795869187398178,
            lat: 11.8,
            set_with_gps: true,
          });
        }, 1);
      }, 1);
    }

    return;
  }

  private applyFormValues(settlementName: GeoJsonSettlementName) {
    //Validation can happen before the form groups are even loaded, this will silently
    //return.  Validation reruns later, so no worries
    if (!this.basicInformationFormGroup || !this.locationFormGroup) {
      return;
    }

    settlementName.properties.name =
      this.basicInformationFormGroup.get(FORM_KEY_NAME)!.value!;
    settlementName.properties.estimated_pop = this.additionalInfoFormGroup.get(
      FORM_KEY_ESTIMATED_POP
    )!.value;
    settlementName.properties.uninhabited =
      this.additionalInfoFormGroup.get(FORM_KEY_UNINHABITED)!.value!;

    //location
    const newLat = this.locationFormGroup.get(FORM_KEY_LATITUDE)!.value;
    const newLon = this.locationFormGroup.get(FORM_KEY_LONGITUDE)!.value;
    const setWithGps = this.locationFormGroup.get(FORM_KEY_SET_WITH_GPS)!.value;
    if (
      _.isFinite(newLat) &&
      _.isFinite(newLon) &&
      !_.isNil(newLon) &&
      !_.isNil(newLat)
    ) {
      const coordinates: [number, number] = [newLon, newLat];
      settlementName.geometry = {
        type: 'Point',
        coordinates,
      };
      settlementName.properties.set_with_gps = setWithGps === true;
    }

    //additional info
    settlementName.properties.synonyms =
      this.additionalInfoFormGroup.get(FORM_KEY_SYNONYM)!.value!;
    settlementName.properties.problematic =
      this.basicInformationFormGroup.get(FORM_KEY_PROBLEMATIC)!.value!;
  }

  private getIntersectingSettlementParts(
    coordinates: [number, number]
  ): Array<GeoJsonSettlementPart> {
    return this.bvService.data.spList.filter((sp) => {
      //Fast check with bounding box
      if (!containsXY(sp.properties.bbox, coordinates[0], coordinates[1])) {
        return false;
      }
      //Slower more exact check
      return geometryIntersects(sp, {
        type: 'Point',
        coordinates,
      });
    });
  }

  private getIntersectingSettlementPartsFromPolygon(
    polygon: Polygon
  ): Array<GeoJsonSettlementPart> {
    //get extent
    const bbox = turfBbox(polygon) as BBox2d;

    return this.bvService.data.spList.filter((sp) => {
      //Fast check with bounding box intersection check
      if (!intersects(bbox, sp.properties.bbox)) {
        return false;
      }
      //Slower more exact check
      return geometryIntersects(sp, polygon);
    });
  }

  /*
  This will return the auto split parent if it exists

  or a settlement whose geometry will be used to create a new auto split parent (see code / comments for cases)
  */
  private determineVoronoiParentGeometry(
    intersectingSettlementParts: Array<GeoJsonSettlementPart>
  ): GeoJsonSettlementPart {
    //this.logger.warn("determineVoronoiParentGeometry");

    //First we check if we are intersecting a settlement that has been split automatically into veronoi polygons
    const autoSplitParents = intersectingSettlementParts.filter(
      (sp) => sp.properties.split_type == 'auto_split_parent'
    );

    if (autoSplitParents.length > 1) {
      this.logger.error('Too many auto split parents found');
      throw new Error(GENERIC_SPLIT_ERROR);
    }

    if (autoSplitParents.length == 1) {
      //A special case here, if we auto split a settlement part into 3 parts,
      //but then manually merge or split 2 of them, we don't want to use it as the parent
      //This means we also should be intersecting one of the split parents children

      //Find if we have any automatically split settlement parts
      const children = intersectingSettlementParts.filter(
        (sp) =>
          sp.properties.split_type == 'auto_split_child' &&
          sp.properties.split_parent == autoSplitParents[0].properties.global_id
      );

      if (children.length > 0) {
        if (children.length > 1) {
          this.logger.error('Too many auto split children found');
          throw new Error(GENERIC_SPLIT_ERROR);
        }
        //In this case, the new settlement point is in an automatically split child
        return autoSplitParents[0];
      } else {
        const nonParents = intersectingSettlementParts.filter(
          (sp) => sp.properties.split_type != 'auto_split_parent'
        );
        if (nonParents.length != 1) {
          //here we expected one of the intersections to be the child of the auto_split_parent that was further modified (split/merged)
          //and so no longer being "managed" by the original auto split parent
          this.logger.error("Didn't find manually split/merged settlement");
          throw new Error(GENERIC_SPLIT_ERROR);
        }
        return nonParents[0];
      }
    }

    //In this case, the new settlement name point is not within a previously split veronoi polygon
    //This means we should have exactly one intersecting settlement part
    if (intersectingSettlementParts.length != 1) {
      this.logger.error(
        `Expected exactly 1 intersection with a settlement part but found ${intersectingSettlementParts.length}`
      );
      throw new Error(GENERIC_SPLIT_ERROR);
    }

    return intersectingSettlementParts[0];
  }

  private validateName(control: AbstractControl) {
    if (!control.value) {
      return { emptyName: true };
    }

    if (isMachineGenerated(control.value)) {
      return { invalidName: true };
    }

    //Also check for duplicates
    if (
      this.bvService.data.snList.some((sn) => {
        if (sn.properties.boundary_polygon != this.bvService.data.boundaryId) {
          return false;
        }

        if (sn.properties.name == control.value) {
          //dup found
          return true;
        }
        return false;
      })
    ) {
      return {
        duplicateName: {
          message: 'A settlement with this name already exists',
        },
      };
    }

    return null;
  }

  public handleDrawnShape(mapDrawnPolygon: PolygonGeoJson) {
    //This polygon must not intersect anything
    //See https://github.com/novelt/GMT/issues/2312
    let intersectingSettlementParts =
      this.getIntersectingSettlementPartsFromPolygon(mapDrawnPolygon);

    if (intersectingSettlementParts.length > 0) {
      this.userActionLogService.addUserActionDescription(
        'User drawn shape intersected existing settlement'
      );

      this.messageService.add({
        summary: 'Shape validation error',
        detail:
          'Note, when creating a new settlement by drawing its boundaries, it must not intersect any existing settlement.  You must use the split/merge tool to modify the existing settlement boundaries.  Please edit the shape to have it not intersect (once Next is enabled) or click start over.  ',
        severity: 'warning',
      });

      //let user edit the settlement polygon by staying on this step
      return;
    }

    this.newSettlementPolygon = mapDrawnPolygon;

    let settlementNameLocation = pointOnFeature(this.newSettlementPolygon);

    let settlementNameLocationLonLat = settlementNameLocation.geometry
      .coordinates as Position;

    this.isLocationValid = true;

    this.locationFormGroup
      .get(FORM_KEY_LATITUDE)!
      .setValue(settlementNameLocationLonLat[1]);
    this.locationFormGroup
      .get(FORM_KEY_LONGITUDE)!
      .setValue(settlementNameLocationLonLat[0]);

    this.wizardPolygonEdit.finishedDrawing();
    this.myStepper.next();
  }
}
