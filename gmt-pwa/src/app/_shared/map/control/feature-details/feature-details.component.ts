import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IconProp } from '@fortawesome/fontawesome-svg-core';
import {
  faDrawPolygon,
  faFlag,
  faHouseMedical,
  faUsers,
} from '@fortawesome/free-solid-svg-icons';
import { BreadcrumbService } from '@services/breadcrumb.service';
import {
  MapEventsService,
  MicroplanMapClicked,
} from '@services/map/base/map-events.service';
import { BoundaryLayerService } from '@services/vector_layer/boundary-layer.service';
import {
  loadHealthFacility,
  operatingHoursToDays,
} from '@services/vector_layer/single-hf-processing.service';
import { SingleStProcessingService } from '@services/vector_layer/single-st-processing.service';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  mpStatusCompleteLabel,
  qualityIndexHigh,
  qualityIndexLow,
  qualityIndexLowMedium,
  qualityIndexMedium,
} from 'src/app/constants/indicators.constants';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { DAY_LABELS } from 'src/app/routine-immu/hf-details/days/days.component';
import { SWITCH_BOUNDARY_CONFIRMATION } from 'src/app/routine-immu/microplan-boundary-map/microplan-boundary-map.component';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { ConfirmationService } from 'src/app/services/shared/notifications/confirmation.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  FIXED_HEALTH_FACILITY_TYPE,
  GeoJsonBoundaryWithIndicators,
  GeoJsonHealthFacility,
  GeoJsonSettlementName,
  HealthFacilityCatchmentStatus,
  HealthFacilityPrimaryType,
} from 'src/app/utils/server-interfaces/GeoJson';
import {
  BOUNDARY_EDITED_LAYER,
  BOUNDARY_LAYER,
  HF_LAYER,
  HF_LAYER_ICON,
  MapVectorLayerName,
  MAP_POI_LAYERS,
  ST_GEOMETRY_LAYER,
  ST_NAME_LAYER,
  ST_NAME_LAYER_ICON,
  VisualizationMapVectorLayerName,
} from 'src/app/utils/server-interfaces/VectorLayerName';
import {
  formatFrequency,
  formatPopulation,
  formatStrategy,
} from 'src/app/utils/string-formatting';
import {IconDefinition} from "@fortawesome/fontawesome-common-types";

interface CatchmentObject {
  pop: number;
  outreach: number;
  unclaimed: number;
  fixedPost: number;
  problematic: number;
}

interface FeatureDetails {
  name: string;
  subtitle?: string;
  additionalText?: string;
  type: string;
  icon?: IconProp | IconDefinition;
  catchmentType?: 'hf' | 'settlement' | 'boundary';
  catchmentInfo?: CatchmentObject;

  //Defined if a fixed post or outreach
  hfDetails?: HfFeatureDetails;
  settlementDetails?: SettlementFeatureDetails;
  boundaryDetails?: BoundaryDetails;
}

interface BoundaryDetails {
  //These are already formatted numbers
  mp_completion: string;
  coverage: string;
  data_quality: string;
}

interface HfFeatureDetails {
  //Will only be defined for health facilities (is_hf = true)
  is_outreach: boolean;
  mp_status: HealthFacilityCatchmentStatus;

  primary_type: HealthFacilityPrimaryType | 'Not applicable';

  services: Array<string>;

  //Fixed post only attributes
  number_of_outreach: number;
  open_days: Array<string>;
  number_of_staff: number;

  //Outreach only attributes
  transport: Array<string>;
  //formatted
  frequency: string;
  outreach_name: string;
}

interface SettlementFeatureDetails {
  //formatted
  computed_pop: number;
  estimated_pop: number;
  uninhabited: boolean;
  problematic: Array<string>;
}

const defaultFeatureDetailValues = {
  name: '',
  type: '',
  icon: null,
} as unknown as FeatureDetails;

@Component({
  selector: 'feature-details',
  templateUrl: './feature-details.component.html',
  styleUrls: ['./feature-details.component.less'],
  providers: [],
  standalone: false
})
export class FeatureDetailsComponent implements OnInit, OnDestroy {
  public featureDetails: FeatureDetails = defaultFeatureDetailValues;
  public showGoToDetailsButton: boolean = true;
  private mapClickedEvent: MicroplanMapClicked | null = null;
  private unsubscribe = new Subject();

  constructor(
    private boundaryLayerService: BoundaryLayerService,
    private breadcrumbService: BreadcrumbService,
    private confirmationService: ConfirmationService,
    private crudLayerService: CrudLayerService,
    private mapEvents: MapEventsService,
    public microplanMapEvents: MicroplanMapEventsService,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private bvService: BoundaryVectorLayersService,
    private userContextService: UserContextService,
    private singleStProcessingService: SingleStProcessingService,
    private logger: NGXLogger
  ) {}

  async ngOnInit() {
    this.subscribeToSingleClickSelection();
    this.subscribeToShowPopupEvent();
    // close panel when navigation ends
    this.router.events.subscribe((val) => {
      this.handleCancelDialog();
    });
    // this.subscribeToSelectableSettlementsController()
  }

  ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
  }

  public handleRedirectToFeature() {
    if (this.mapClickedEvent == null) {
      return;
    }
    const selectedObjectLayerId = this.mapClickedEvent.selectedLayer;
    this.userContextService.leftPanelIsOpened.next(true);
    if (
      selectedObjectLayerId === HF_LAYER ||
      selectedObjectLayerId === HF_LAYER_ICON
    ) {
      this.handleRouteToHf();
    } else if (
      selectedObjectLayerId === ST_NAME_LAYER ||
      selectedObjectLayerId === ST_NAME_LAYER_ICON
    ) {
      const sn = this.bvService.data.snMap.get(
        this.mapClickedEvent.selectedGlobalId!
      )!;
      this.handleRouteToSn(sn);
    } else if (selectedObjectLayerId === ST_GEOMETRY_LAYER) {
      this.handleRouteToSp();
    } else if (selectedObjectLayerId === BOUNDARY_LAYER) {
      this.handleRouteToBoundary();
    }
  }

  public formatPopulation(pop: number | null) {
    return formatPopulation(pop);
  }

  public handleCancelDialog() {
    // if there is anything to clear
    if (this.featureDetails && this.featureDetails.name != '') {
      this.mapEvents.triggerClearFocus();
    }

    this.featureDetails = defaultFeatureDetailValues;
  }

  private handleRouteToHf() {
    const hf = this.bvService.data.hfMap.get(
      this.mapClickedEvent!.selectedGlobalId!
    )!;
    if (!hf) {
      return;
    }
    const navigateToFeature = () => {
      this.router
        .navigate(
          [
            RoutesChunks.ROUTINE_IMMUNIZATION,
            hf.properties.boundary_polygon,
            RoutesChunks.HEALTH_FACILITIES,
            hf.properties.global_id,
            RoutesChunks.EDIT,
          ],
          {
            queryParamsHandling: 'preserve',
          }
        )
        .then();
    };
    this.centerSelectedFeature(hf);
    this.confirmAndNavigate(hf.properties.boundary_polygon, navigateToFeature);
  }

  private handleRouteToSn(sn: GeoJsonSettlementName) {
    if (!sn || !sn.properties.is_primary) {
      return;
    }

    this.centerSelectedFeature(sn);
    this.confirmAndNavigate(sn.properties.boundary_polygon, () => {
      this.router
        .navigate(
          [
            RoutesChunks.ROUTINE_IMMUNIZATION,
            sn.properties.boundary_polygon,
            RoutesChunks.SETTLEMENTS,
            sn.properties.global_id,
            RoutesChunks.EDIT,
          ],
          {
            queryParamsHandling: 'preserve',
          }
        )
        .then();
    });
  }

  private handleRouteToSp() {
    const sn = this.getStPrimaryNameFromStPart();
    if (!sn) {
      return;
    }
    const point = sn.geometry.coordinates;
    this.mapEvents.center({
      movementType: 'Center',
      center: point,
    });
    this.handleRouteToSn(sn);
  }

  private subscribeToSingleClickSelection() {
    this.mapEvents
      .getClickedObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((event) => {
        this.resetFeatureValues();
        this.showDetailsPopup(event);
      });
  }

  private resetFeatureValues() {
    this.showGoToDetailsButton = true;
    this.featureDetails = defaultFeatureDetailValues;
  }

  private showDetailsPopup(mapClickEvent: MicroplanMapClicked) {
    this.mapClickedEvent = mapClickEvent;
    if (!this.mapClickedEvent) {
      return;
    }
    //this.logger.debug(`EEE`, this.mapClickedEvent);
    const selectedObjectLayerId = this.mapClickedEvent.selectedLayer!;
    if (
      selectedObjectLayerId === HF_LAYER ||
      selectedObjectLayerId === HF_LAYER_ICON
    ) {
      this.showGoToDetailsButton = true;
      this.fillPropertiesForHf();
    } else if (
      selectedObjectLayerId === ST_NAME_LAYER ||
      selectedObjectLayerId === ST_NAME_LAYER_ICON
    ) {
      this.showGoToDetailsButton = true;
      this.fillPropertiesForSn();
    } else if (
      MAP_POI_LAYERS.map((m) => m as string).includes(selectedObjectLayerId)
    ) {
      this.showGoToDetailsButton = false;
      this.fillPropertiesForPoi();
    } else if (selectedObjectLayerId === ST_GEOMETRY_LAYER) {
      this.showGoToDetailsButton = true;
      this.fillPropertiesForSp();
    } else if (selectedObjectLayerId === BOUNDARY_EDITED_LAYER) {
      this.showGoToDetailsButton = false;
      this.fillPropertiesForEditedBoundary();
    } else if (selectedObjectLayerId === BOUNDARY_LAYER) {
      this.showGoToDetailsButton = true;
      this.fillPropertiesForBoundary();
    }
  }

  private subscribeToShowPopupEvent() {
    this.mapEvents
      .detailsPopupObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        (event: {
          layerId: MapVectorLayerName | VisualizationMapVectorLayerName;
          featureId: string;
        }) => {
          this.mapClickedEvent = {
            selectedGlobalId: event.featureId,
            coordinates: [0, 0],
            selectedLayer: event.layerId,
          };
          if (event.layerId === HF_LAYER || event.layerId === HF_LAYER_ICON) {
            this.fillPropertiesForHf();
          } else if (
            event.layerId === ST_NAME_LAYER ||
            event.layerId === ST_NAME_LAYER_ICON
          ) {
            this.fillPropertiesForSn();
          }
        }
      );
  }
  private fillPropertiesForHf() {
    this.microplanMapEvents.triggerHfHighlightEvent(
      this.mapClickedEvent!.selectedGlobalId
    );

    const hf = this.bvService.data.hfMap.get(
      this.mapClickedEvent!.selectedGlobalId!
    );
    if (!hf) {
      return;
    }
    let parentHf;
    const isOutreach = !!hf.properties.parent;
    const coverageHf = loadHealthFacility(
      { logger: this.logger, boundaryData: this.bvService.data },
      hf.properties.global_id
    )!;
    const additionalTextItems: Array<string> = [hf.properties.level_of_care];
    const icon =
      hf.properties.type === FIXED_HEALTH_FACILITY_TYPE
        ? faHouseMedical
        : faFlag;
    if (typeof hf.properties.private === 'boolean') {
      additionalTextItems.unshift(hf.properties.private ? 'Private' : 'Public');
    }

    //RI days of operation (array of days... ideally something like Mon-Sun)

    //Returns a list of which days open
    const selectedDays = operatingHoursToDays(hf);
    let openDays = DAY_LABELS.filter((dayLabel, index) => {
      return selectedDays[index];
    });

    let numberOfOutreach = 0;
    // Number of outreach sites
    if (!isOutreach) {
      numberOfOutreach = (
        this.bvService.data.hfChildMap.get(hf.properties.global_id) || []
      ).length;
      //additionalTextItems.push("Number of outreach: " + numberOfOutreach);
    }

    if (isOutreach) {
      parentHf = loadHealthFacility(
        { logger: this.logger, boundaryData: this.bvService.data },
        hf.properties.parent!
      );
    }

    let primary_type: HealthFacilityPrimaryType | 'Not applicable' =
      hf.properties.primary_type;

    //If the type of the HF is not "primary", then we want to display "Not applicable"
    if (hf.properties.level_of_care != 'Primary') {
      primary_type = 'Not applicable';
    }

    const catchmentInfo: CatchmentObject = {
      pop: coverageHf.catchmentPopulation.computedPop,
      fixedPost:
        (coverageHf.percFixedPost / 100) *
        coverageHf.catchmentPopulation.computedPop,
      outreach:
        (coverageHf.percOutreach / 100) *
        coverageHf.catchmentPopulation.computedPop,
      //not needed for HF
      unclaimed: 0,
      problematic:
        (coverageHf.percProblematic / 100) *
        coverageHf.catchmentPopulation.computedPop,
    };

    if (isOutreach) {
      //set everything to outreach
      //percOutreach should be 0...
      catchmentInfo.outreach =
        ((coverageHf.percFixedPost + coverageHf.percOutreach) / 100) *
        coverageHf.catchmentPopulation.computedPop;
      catchmentInfo.fixedPost = 0;
    }

    let hfFeatureDetails: FeatureDetails = {
      name: isOutreach ? parentHf.hf.properties.name : hf.properties.name,
      subtitle: additionalTextItems.join(', '),
      type: formatStrategy(hf.properties.type),
      icon,
      catchmentInfo,
      catchmentType: 'hf',
      hfDetails: {
        //MP status
        mp_status: hf.properties.mp_status,
        //Primary type (if available)
        primary_type,
        //Services
        services: hf.properties.services,
        is_outreach: isOutreach,
        number_of_outreach: numberOfOutreach,
        open_days: openDays,
        number_of_staff: hf.properties.staff_names.length,
        transport: hf.properties.transport,
        frequency: formatFrequency(hf.properties.frequency),
        outreach_name: hf.properties.name,
      },
    };

    this.featureDetails = hfFeatureDetails;
  }

  private fillPropertiesForSn() {
    if (_.isNil(this.mapClickedEvent)) {
      return;
    }
    this.microplanMapEvents.triggerSettlementHighlightEvent(
      this.mapClickedEvent.selectedGlobalId
    );

    const sn = this.bvService.data.snMap.get(
      this.mapClickedEvent.selectedGlobalId!
    );

    if (_.isNil(sn)) {
      return;
    }

    const sp = this.bvService.data.spMap.get(sn.properties.settlement_part!);

    if (_.isNil(sp)) {
      return;
    }

    const catchmentObj = this.singleStProcessingService.calculateCatchment(
      sp,
      sn
    )!.catchment;

    this.featureDetails = {
      name: sn.properties.name,
      type: 'Settlement',
      icon: faUsers,
      settlementDetails: {
        computed_pop: sp.properties.computed_pop!,
        estimated_pop: sn.properties.estimated_pop!,
        problematic: sn.properties.problematic,
        uninhabited: sn.properties.uninhabited,
      },
      catchmentInfo: {
        pop: catchmentObj.pop,
        fixedPost: catchmentObj.fixedPost,
        outreach: catchmentObj.outreach,
        unclaimed: catchmentObj.unclaimed,
        problematic: catchmentObj.problematic.length > 0 ? catchmentObj.pop : 0,
      },
      catchmentType: 'settlement',
    };

    //non synced uninhabited will still have computed pop
    if (sn.properties.uninhabited) {
      this.featureDetails.settlementDetails!.computed_pop = 0;
      this.featureDetails.settlementDetails!.estimated_pop = 0;
      this.featureDetails.catchmentInfo!.pop = 0;
      this.featureDetails.catchmentInfo!.fixedPost = 0;
      this.featureDetails.catchmentInfo!.outreach = 0;
      this.featureDetails.catchmentInfo!.unclaimed = 0;
      this.featureDetails.catchmentInfo!.problematic = 0;
    }
  }

  private fillPropertiesForPoi() {
    if (_.isNil(this.mapClickedEvent)) {
      return;
    }

    this.microplanMapEvents.triggerPoiHighlightEvent(
      this.mapClickedEvent.selectedGlobalId!
    );
    this.featureDetails = {
      name: 'Point of interest',
      type: 'Point of interest',
    };
    const poi = this.bvService.data.pointList.find(
      (p) => p.properties.global_id == this.mapClickedEvent!.selectedGlobalId!
    );
    if (!poi) {
      return;
    }
    this.featureDetails.name = poi.properties['name'];
    this.featureDetails.type = poi.properties['type'];
  }

  private fillPropertiesForSp() {
    const sn = this.getStPrimaryNameFromStPart();
    if (!sn) {
      return;
    }
    if (_.isNil(this.mapClickedEvent)) {
      return;
    }

    //Do the same thing as if we clicked a settlement name
    this.mapClickedEvent.selectedGlobalId = sn.properties.global_id;
    this.mapClickedEvent.selectedLayer = ST_NAME_LAYER;
    this.fillPropertiesForSn();

    /*this.logger.debug(sn);
        this.microplanMapEvents.triggerSettlementHighlightEvent(sn.properties.global_id);
        this.featureDetails = {
          name: sn.properties.name,
          subtitle: 'Settlement',
          type: 'Settlement',
          icon: faDrawPolygon
        }*/
  }

  private async fillPropertiesForBoundary() {
    if (_.isNil(this.mapClickedEvent)) {
      return;
    }
    const boundary = await this.boundaryLayerService.fetchBoundaryById(
      this.mapClickedEvent.selectedGlobalId!
    );
    if (!boundary) {
      return;
    }

    this.logger.debug(boundary);

    const boundaryDetails = this.addIndicatorsText(boundary)!;
    this.featureDetails = {
      name: boundary.properties.name,
      subtitle: this.getAdminLevelName(boundary.properties.level),
      type: 'Boundary',
      icon: faDrawPolygon,
      catchmentInfo: {
        pop:
          boundary.properties.catchment_pop_fp! +
          boundary.properties.catchment_pop_outreach! +
          boundary.properties.catchment_pop_unclaimed!,
        outreach: boundary.properties.catchment_pop_outreach,
        unclaimed: boundary.properties.catchment_pop_unclaimed,
        fixedPost: boundary.properties.catchment_pop_fp,
      } as CatchmentObject,
      catchmentType: 'boundary',
      boundaryDetails,
    };
  }

  private fillPropertiesForEditedBoundary() {
    const boundary = this.bvService.data.bMap.get(
      this.mapClickedEvent!.selectedGlobalId!
    );
    if (!boundary) {
      return;
    }
    this.featureDetails = {
      name: boundary.properties.name,
      subtitle: 'Edited Boundary',
      type: 'Edited Boundary',
      icon: null,
    } as unknown as FeatureDetails;
  }

  private confirmAndNavigate(
    featureBoundaryId: string,
    navigateToFeature: Function
  ) {
    // feature: GeoJsonBase,
    const currentBoundaryId =
      this.activatedRoute.snapshot.params[
        RoutesChunks.PARAM_BOUNDARY.replace(':', '')
      ];

    if (featureBoundaryId !== currentBoundaryId) {
      this.confirmationService.confirm({
        message: SWITCH_BOUNDARY_CONFIRMATION,
        accept: () => {
          this.userContextService.leftPanelIsOpened.next(true);
          navigateToFeature();
        },
        showRejectButton: true,
      });
    } else {
      navigateToFeature();
    }
  }

  private getStPrimaryNameFromStPart(): null | GeoJsonSettlementName {
    if (!this.mapClickedEvent) {
      return null;
    }
    const sp = this.bvService.data.spMap.get(
      this.mapClickedEvent.selectedGlobalId!
    );
    if (!sp) {
      return null;
    }
    const snList = this.bvService.data.getPrimaryNamesForSettlementPart(
      sp.properties.global_id,
      false
    );

    if (snList.length <= 0) {
      return null;
    }
    return snList[0];
  }

  private centerSelectedFeature(
    feature: GeoJsonSettlementName | GeoJsonHealthFacility
  ) {
    const center = feature.geometry.coordinates;
    this.mapEvents.center({
      movementType: 'Center',
      center,
    });
  }

  private async handleRouteToBoundary() {
    if (_.isNil(this.mapClickedEvent)) {
      return;
    }
    const boundary = await this.boundaryLayerService.fetchBoundaryById(
      this.mapClickedEvent.selectedGlobalId!
    );
    if (!boundary) {
      return;
    }
    await this.breadcrumbService.routeToBoundary(
      boundary.properties.level,
      this.mapClickedEvent.selectedGlobalId!,
      false
    );
  }

  private getAdminLevelName(level: number): string {
    switch (level) {
      case 1:
        return 'State';
      case 2:
        return 'LGA';
      default:
        return 'Ward';
    }
  }

  private addIndicatorsText(
    boundary: GeoJsonBoundaryWithIndicators
  ): BoundaryDetails | null {
    let mp_completion;
    let coverage;
    let data_quality;
    const level = boundary.properties.level;
    if (boundary.properties.boundary_mp_status) {
      let hfMicroplanStatus;
      if (level == AppConfigService.conf.generic.operational_boundary_level) {
        hfMicroplanStatus = boundary.properties.num_fp_mp_status;
      } else {
        hfMicroplanStatus = boundary.properties.boundary_mp_status;
      }
      if (!hfMicroplanStatus) {
        return null;
      }
      const total: number = hfMicroplanStatus.reduce((a, b) => a + b, 0);
      if (total) {
        const completedPerc =
          (hfMicroplanStatus[
            AppConfigService.conf.hf_microplan_status![mpStatusCompleteLabel]
          ] /
            total) *
          100;
        mp_completion = completedPerc.toFixed(0) + '%';
      }
    }
    if (boundary.properties.catchment_pop_fp) {
      const catchmentPopFp = boundary.properties.catchment_pop_fp;
      const catchmentPopOutreach = boundary.properties.catchment_pop_outreach!;
      const catchmentPopUnclaimed =
        boundary.properties.catchment_pop_unclaimed!;
      const totalCoveragePop =
        catchmentPopFp + catchmentPopOutreach + catchmentPopUnclaimed;
      let percentageCovered = -1;
      if (totalCoveragePop) {
        percentageCovered =
          ((catchmentPopFp + catchmentPopOutreach) / totalCoveragePop) * 100;
        coverage = `${percentageCovered.toFixed(0)}%`;
      }
    }
    if (boundary.properties.boundary_data_quality) {
      if (level == AppConfigService.conf.generic.operational_boundary_level) {
        const totalStCount = boundary.properties.num_set_total;
        const stWithGeneratedNames = boundary.properties.num_set_mgn!;
        if (!totalStCount) {
          return null;
        }
        const quality =
          ((totalStCount - stWithGeneratedNames) / totalStCount) * 100;
        data_quality = `${quality.toFixed(0)}%`;
      } else {
        const dataQualityNumbers = boundary.properties.boundary_data_quality;
        if (!dataQualityNumbers) {
          return null;
        }
        const maxQualityLevel = dataQualityNumbers.reduce(
          (a, b) => Math.max(a, b),
          0
        );
        if (maxQualityLevel == 0) {
          return null;
        }
        if (maxQualityLevel == dataQualityNumbers[qualityIndexLow]) {
          data_quality = `0-20%`;
        } else if (
          maxQualityLevel == dataQualityNumbers[qualityIndexLowMedium]
        ) {
          data_quality = `20-50%`;
        } else if (maxQualityLevel == dataQualityNumbers[qualityIndexMedium]) {
          data_quality = `50-80%`;
        } else if (maxQualityLevel == dataQualityNumbers[qualityIndexHigh]) {
          data_quality = `80-100%`;
        }
      }
    }
    return {
      mp_completion,
      coverage,
      data_quality,
    };
  }
}
