import {
  Component,
  EventEmitter,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Extent as GeojsonExtent } from 'src/app/utils/server-interfaces/GeoJson';
import {
  BBox as TurfBBox,
  bboxPolygon,
  booleanPointInPolygon,
  buffer,
  difference,
  Feature as TurfFeature,
  lineString,
  multiPolygon,
  MultiPolygon as TurfMultiPolygon,
  Polygon as TurfPolygon,
} from '@turf/turf';
import { NGXLogger } from 'ngx-logger';
import { Feature } from 'ol';
import { containsXY, equals as equalExtents, Extent } from 'ol/extent';
import { MultiPolygon, Polygon, SimpleGeometry } from 'ol/geom';
import { circular } from 'ol/geom/Polygon';
import BaseLayer from 'ol/layer/Base';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import View from 'ol/View';
import { MenuItem } from 'primeng/api';
import { SplitButton } from 'primeng/splitbutton';
import { combineLatest, Subject, Subscription } from 'rxjs';
import {
  filter,
  first,
  map,
  switchMap,
  takeUntil,
  takeWhile,
  withLatestFrom,
} from 'rxjs/operators';
import { RoutesChunks } from 'src/app/constants/routing.enum';
import { BoundaryVectorLayersService } from 'src/app/services/boundary-vector-layers.service';
import { BaselineService } from 'src/app/services/map/BaselineService';
import { MicroplanMapEventsService } from 'src/app/services/map/MicroplanMapEventsService';
import { VectorSourceService } from 'src/app/services/map/vector-source.service';
import { UserContextService } from 'src/app/services/user-context.service';
import { PermissionsLayerService } from 'src/app/services/vector_layer/permissions-layer.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  BOUNDARY_EDITED_LAYER,
  CHURCH_LAYER,
  GENERIC_LINE_LAYER,
  HF_LAYER,
  HF_LAYER_ICON,
  MapVectorLayerName,
  MAP_POI_LAYERS,
  MARKET_LAYER,
  MOSQUE_LAYER,
  SCHOOL_LAYER,
  ST_GEOMETRY_LAYER,
  ST_NAME_LAYER,
  ST_NAME_LAYER_ICON,
  VectorLayerForPermissions,
} from 'src/app/utils/server-interfaces/VectorLayerName';
import { formatPopulation } from 'src/app/utils/string-formatting';
import { MapLayerSelection } from 'src/app/_shared/map/control/layers-selector/map-control-layers-selector.component';
import { BaseMapComponent } from 'src/app/_shared/map/panel/base-map.component';
import {
  activeLocationStyle,
  badAccuracyStyle,
  goodAccuracyStyle,
  notActiveLocationStyle,
} from 'src/app/_shared/map/styles/gnss-styles';
import {
  boundariesScopedSatelliteExample,
  editedBoundariesStyleFunction,
} from 'src/app/_shared/map/styles/map-boundary-styles';
import {
  healthFacilitiesIconScoped,
  healthFacilitiesStyleFunction,
  healthFacilitiesTextScoped,
} from 'src/app/_shared/map/styles/map-hf-styles';
import {
  poi,
  poiStyleFunction,
  roads,
} from 'src/app/_shared/map/styles/map-poi-styles';
import {
  settlementsNameIconScoped,
  settlementsNameTextScoped,
  settlementsStyleFunction,
} from 'src/app/_shared/map/styles/map-settlement-styles';
import { bufferExtent } from 'src/app/_shared/map/util/map-utils';
import { v4 as uuidv4 } from 'uuid';
import { MapLayer } from '../page-microplan-boundary/page-microplan.component';

import {
  LayerIds,
  MapEventsService,
  MicroplanMapClicked,
  OverlayLayer,
  ServiceApiFeature,
} from '@services/map/base/map-events.service';
import * as _ from 'lodash';
import { SATELLITE_MAP } from 'src/app/constants/basemap-names';
import { MapState, MapStateService } from 'src/app/services/map/MapState';
import {GeolocationCoordinatesInterfaceFix, UserLocationService} from 'src/app/services/map/user-location.service';
import {
  ActivePageContext,
  RIRouteService,
} from 'src/app/services/shared/route/ri-route.service';
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import {
  GeoJsonBase,
  GeoJsonHealthFacility,
  GeoJsonSettlementName,
  Polygon as PolygonGMT,
  Position,
  PropertyValue,
} from 'src/app/utils/server-interfaces/GeoJson';
import { geometryIntersects } from 'src/app/utils/server-interfaces/utils/geom.util';
import {
  mapLayerOrder,
  mapStyles,
} from 'src/app/_shared/map/styles/map-design';
import { MessageService } from '../../services/shared/notifications/message.service';
import Timeout = NodeJS.Timeout;

export interface StrategyOptions {
  [key: string]: string;
}

const LAYER_BOUNDARY_ID: string = 'boundary__polygon';
const BOUNDARY_ZOOM_ADJUSTMENT: number = 1.1;

export interface  GeolocationCoordinatesInterface {
    readonly accuracy: number;
    readonly altitude: number | null;
    readonly altitudeAccuracy: number | null;
    readonly heading: number | null;
    readonly latitude: number;
    readonly longitude: number;
    readonly speed: number | null;
}


export const SWITCH_BOUNDARY_CONFIRMATION =
  "You're going to switch to another boundary. Do you confirm ?";

@Component({
  selector: 'gmt-microplan-boundary-map',
  templateUrl: './microplan-boundary-map.component.html',
  styleUrls: ['./microplan-boundary-map.component.less'],
  standalone: false
})
export class MicroplanBoundaryMapComponent extends BaseMapComponent {
  @Output() override extentChange = new EventEmitter<GeojsonExtent>();
  @ViewChild('strategyMenu') strategyMenu?: SplitButton;
  // TODO - maybe half deprecated
  strategyOptions: StrategyOptions = {
    voronoi: 'Voronoi',
    traveltime: 'Travel Time',
    distance: 'Distance',
  };
  selectedStrategy: string = 'voronoi';
  strategyMenuEntries: MenuItem[] = [];

  isEdit: boolean = true;
  private activePageContext!: ActivePageContext;
  public distanceGuidesAreEnabled = false;
  public distanceMetersInput: [number, number] = [0, 0];
  public tabletPosition: GeolocationCoordinatesInterfaceFix | null = null;
  public legendOpen: boolean = false;
  public wizardEnabled = false;
  public HF_LAYER = HF_LAYER;
  public CATCHMENT_LAYER = LayerIds.CATCHMENT;
  public ST_NAME_LAYER = ST_NAME_LAYER;
  public ST_GEOMETRY_LAYER = ST_GEOMETRY_LAYER;
  public POP_RASTER_GENERIC = LayerIds.POP_RASTER_GENERIC;
  public visibleLayers = [
    HF_LAYER,
    LayerIds.CATCHMENT,
    ST_NAME_LAYER,
    LayerIds.POP_RASTER_GENERIC,
  ];
  public singleCatchment: boolean = true;
  public disableSingleCatchment = true;
  public focusedHfs: string[] | false = false;
  public focusedSettlements: string[] | false = false;
  //Updated by observable
  private userHasPermissionsUpdateSettlement = false;

  //If true, a map click on a feature will route to that features edit page (eg. health facility or primary name)
  private enableRouting: boolean = true;

  private settlementList: Array<GeoJsonSettlementName>;

  private catchmentLayer: VectorLayer = new VectorLayer({
    source: new VectorSource(),
    visible: false,
  });
  private hfBufferLayer: VectorLayer = new VectorLayer({
    source: new VectorSource(),
    visible: false,
  });
  private locationLayer: VectorLayer = new VectorLayer({
    source: new VectorSource(),
    visible: true,
  });
  private hfVoronoiLayer: VectorLayer = new VectorLayer({
    source: new VectorSource(),
    visible: false,
  });
  private populationRasterGeneric: VectorLayer = new VectorLayer({
    source: new VectorSource(),
  });
  private populationRasterProblematic: VectorLayer = new VectorLayer({
    source: new VectorSource(),
  });
  private populationRasterValues: VectorLayer = new VectorLayer({
    source: new VectorSource(),
    visible: false,
  });
  private catchmentLineVisualizationSubscription: Subscription | null = null;
  private rasterSquaresVisualizationSubscription: Subscription | null = null;

  private selectedHfId: null | string = null;
  private selectedSettlementId: null | string = null;

  private layers: MapLayer[] = [
    {
      id: LAYER_BOUNDARY_ID,
      mapLayerId: LAYER_BOUNDARY_ID,
      legendGroup: AppConfigService.ENABLE_BOUNDARY_CHOICES
        ? 'POINTS OF INTEREST'
        : null,
      name: 'Boundaries',
      index: OverlayLayer.BOUNDARIES,
      //FYI Andres
      //We don't need "this" bound as this in the method.  Cleaner if its an actual argument
      //This is why the 1st argument is null.  The 2nd param becomes the 1st in this
      //curried function
      style: boundariesScopedSatelliteExample.bind(null, this),
      //style: (feature, resolution) => {return boundariesScoped(this.bvService.data.boundaryId)(feature, resolution);},
    },
    {
      id: ST_GEOMETRY_LAYER,
      mapLayerId: ST_GEOMETRY_LAYER,
      legendGroup: 'SETTLEMENTS',
      name: 'Boundaries',
      index: mapLayerOrder.stl,
      style: mapStyles.STL.polygon,
      visible: false,
    },
    ,
    {
      id: CHURCH_LAYER,
      mapLayerId: CHURCH_LAYER,
      legendGroup: 'POINTS OF INTEREST',
      name: 'Churches',
      index: mapLayerOrder.poi,
      style: poi,
      visible: false,
    },
    {
      id: MOSQUE_LAYER,
      mapLayerId: MOSQUE_LAYER,
      legendGroup: 'POINTS OF INTEREST',
      name: 'Mosques',
      index: mapLayerOrder.poi,
      style: poi,
      visible: false,
    },
    {
      id: MARKET_LAYER,
      mapLayerId: MARKET_LAYER,
      legendGroup: 'POINTS OF INTEREST',
      name: 'Markets',
      index: mapLayerOrder.poi, // Stacking/order in the map
      style: poi,
      visible: false,
    },
    {
      id: SCHOOL_LAYER,
      mapLayerId: SCHOOL_LAYER,
      legendGroup: 'POINTS OF INTEREST',
      name: 'Schools',
      index: mapLayerOrder.poi,
      style: poi,
      visible: false,
    },
    {
      id: ST_NAME_LAYER,
      mapLayerId: ST_NAME_LAYER,
      legendGroup: 'SETTLEMENTS',
      name: 'Settlements',
      index: mapLayerOrder.stlLabel, // This controls stacking
      style: (feature, resolution) => {
        return settlementsNameTextScoped(
          this.bvService.data.boundaryId,
          false,
          null,
          this.isSatelliteBasemapEnabled(),
          this.focusedSettlements
        )(feature, resolution);
      },
    },
    {
      id: ST_NAME_LAYER,
      mapLayerId: ST_NAME_LAYER_ICON,
      legendGroup: null,
      name: 'Settlements',
      index: mapLayerOrder.stlLabel, // This controls stacking
      style: (feature, resolution) => {
        return settlementsNameIconScoped(
          this.bvService.data.boundaryId,
          false,
          null,
          this.focusedSettlements
        )(feature, resolution);
      },
    },
    {
      id: HF_LAYER,
      mapLayerId: HF_LAYER,
      name: 'Facility',
      legendGroup: 'HEALTH FACILITIES',
      index: mapLayerOrder.hf,
      style: (feature, resolution) => {
        return healthFacilitiesTextScoped(
          this.bvService.data.boundaryId,
          this.isSatelliteBasemapEnabled(),
          this.focusedHfs
        )(feature, resolution);
      },
      visible: this.visibleLayers.includes(HF_LAYER),
    },
    {
      id: HF_LAYER,
      mapLayerId: HF_LAYER_ICON,
      name: 'Facility icon',
      legendGroup: null,
      index: mapLayerOrder.hfIcon,
      style: (feature, resolution) => {
        return healthFacilitiesIconScoped(
          this.bvService.data.boundaryId,
          this.focusedHfs
        )(feature, resolution);
      },
      visible: this.visibleLayers.includes(HF_LAYER),
    },
    {
      id: GENERIC_LINE_LAYER,
      mapLayerId: GENERIC_LINE_LAYER,
      legendGroup: 'POINTS OF INTEREST',
      name: 'Roads',
      index: OverlayLayer.ROADS,
      style: roads,
    },
  ] as MapLayer[];

  private unsubscribe = new Subject();
  versions = [{ name: 'Version 1' }, { name: 'Version 2' }];
  tabletLocationWatchId: Timeout | null;
  private locationFeature: ServiceApiFeature | null = {
    geo_json: {
      type: 'Feature',
      properties: { global_id: '', boundary_polygon: '', version_id: null },
      geometry: { type: 'Point', coordinates: [-1, -1] },
    },
    style: notActiveLocationStyle,
    layer: OverlayLayer.GNSS_LOCATION,
  };
  private locationAccuracyFeature = {
    geo_json: {
      type: 'Feature' as 'Feature',
      properties: { global_id: '', boundary_polygon: '', version_id: null },
      geometry: {
        type: 'Polygon',
        coordinates: [[]] as Position[][],
      } as PolygonGMT,
    },
    style: badAccuracyStyle,
    layer: OverlayLayer.GNSS_LOCATION,
  };

  constructor(
    private activatedRoute: ActivatedRoute,
    private vectorSourceService: VectorSourceService,
    private mapState: MapStateService,
    private mapEvents: MapEventsService,
    private microplanMapEvents: MicroplanMapEventsService,
    private permissionsLayerService: PermissionsLayerService,
    private userContextService: UserContextService,
    private riRouteService: RIRouteService,
    public bvService: BoundaryVectorLayersService,
    private baselineService: BaselineService,
    private crudLayerService: CrudLayerService,
    private messageService: MessageService,
    private locationService: UserLocationService,
    logger: NGXLogger // protected zone: NgZone
  ) {
    // super(zone);
    super(logger);
    this.distanceMetersInput = [
      0,
      AppConfigService.conf.catchment.min_fixed_post_buffer_m,
    ];
  }

  override ngOnInit(): void {
    super.ngOnInit();

    // Todo: Remove again
    (window as any).mp = this;

    this.extentChange.pipe(takeUntil(this.unsubscribe)).subscribe((extent) => {
      this.mapEvents.extentChange(extent);
    });

    // Fill strategy menu entries
    this.fillStrategyMenuEntries();

    let tempBoundaryId: string | null = null;
    let boundaryId: string | null = null;

    this.activatedRoute!.params.pipe(
      map((params) => {
        return params[RoutesChunks.PARAM_BOUNDARY.replace(':', '')];
      }),
      switchMap((boundaryId) => {
        tempBoundaryId = boundaryId;
        return this.bvService.ensureBoundaryLoaded(boundaryId);
      }),
      switchMap((_ok) => {
        return this.crudLayerService.suppressUserInterfaceUpdates.asObservable();
      }),
      filter((suppressUi) => !suppressUi),
      switchMap((_) => {
        boundaryId = tempBoundaryId;
        return this.bvService.loadedObs();
      }),
      takeUntil(this.unsubscribe)
    ).subscribe((vectorDataLoaded) => {
      // We want to rerender the catchment patterns after any change
      // if (boundaryId == tempBoundaryId || tempBoundaryId == null) {
      //   return;
      // }
      // update catchment visualization (if we will decide to have single catchment by default, this should be part of
      // subscribeToHfOrSettlementIdChange() function )
      this.updateRasterSquaresVisualizationPattern(true).then();

      this.setComponentPermissions();
    });
    this.subscribeToLocationChange();
    this.subscribeToRouteChanges();
    // Configure map with baselayers
    this.addBaseLayers(this.mapState.getState().baselayers);
    this.createMapLayers();
    this.addCatchmentRelatedLayers();
    //Listening to observables
    this.userContextService
      .getIsEditingObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((isEdit) => {
        this.isEdit = isEdit;
      });
    this.subscribeToMapMovementChange();
    this.permissionsLayerService
      .getPermissionsObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((_) => {
        this.setComponentPermissions();
      });

    this.subscribeToMapEventsForCatchmentRedraw();
    this.subscribeToDetailsPopupTrigger();
    this.subscribeToInteractions();
    this.subscribeToWizardEnabled();
    this.subscribeMapSingleClick();
    this.subscribeClearFocus();
    // this.subscribeCreatingEditableLayer();
    this.subscribeMapSelectionChange();
    this.subscribeSelectedPartsChanged();
    this.subscribeFeatureHighlights();
    this.subscribeToHfFocus();
    this.subscribeToSettlementFocus();
    this.subscribeToSettlementPartsSelection();
    this.listenToLayerVisibilityChange();
  }

  override ngOnDestroy() {
    if (this.tabletLocationWatchId) {
      clearInterval(this.tabletLocationWatchId);
    }
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
    this.mapEvents.setIsMapInitialized(false);
  }

  override ngOnChanges(changes: SimpleChanges): void {}

  private fillStrategyMenuEntries() {
    this.strategyMenuEntries = Object.keys(this.strategyOptions).map((o) => {
      return {
        label: this.strategyOptions[o],
        command: (event) => {
          this.toggleStrategy(
            Object.keys(this.strategyOptions).filter((x) => {
              return this.strategyOptions[x] === event!.item!.label;
            })[0]
          );
        },
      } as MenuItem;
    });
  }

  private subscribeToRouteChanges() {
    // this.mapEvents.getIsMapInitialized().pipe(
    //   takeUntil(this.unsubscribe),
    //   filter(mapInit => {
    //     return mapInit;
    //   }),
    //   switchMap(_ => {
    //     return this.userContextService.getActivePageObservable();
    //   }),
    //   takeUntil(this.unsubscribe)
    // ).subscribe((pageContext: ActivePageContext) => {
    this.mapRendered
      .pipe(
        switchMap((_) => {
          return this.bvService.loadedObs();
        }),
        switchMap((_) => {
          return this.riRouteService.activePage$;
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe((pageContext: ActivePageContext) => {
        if (
          JSON.stringify(this.activePageContext) == JSON.stringify(pageContext)
        ) {
          return;
        }
        this.activePageContext = pageContext;

        // if (this.activePageContext.page != RoutesChunks.SETTLEMENTS || this.activePageContext.snId) {
        //   this.disableSettlementSelection();
        // }
        this.resetHighlight();

        if (this.activePageContext.hfId) {
          this.selectedHfId = this.activePageContext.hfId;
        } else if (this.activePageContext.snId) {
          this.selectedSettlementId = this.activePageContext.snId;
        }
        this.selectCurrentHFOrSettlement();
        this.changeDisableSinglePropertyIfNeeded();
      });
  }

  public formatPopulation(pop: PropertyValue) {
    return formatPopulation(pop);
  }

  private selectCurrentHFOrSettlement() {
    if (this.selectedHfId) {
      this.selectHfOnMap();
      this.changeDisableSinglePropertyIfNeeded();
    } else if (this.selectedSettlementId) {
      this.selectSettlementOnMap();
    }
    if (this.singleCatchment) {
      this.updateCatchmentLineVisualizationPattern().then();
    }
  }
  private resetHighlight() {
    this.selectedSettlementId = null;
    this.selectedHfId = null;
    this.clearSelection(true); // remove previous highlights
  }

  private subscribeToDetailsPopupTrigger() {
    this.mapEvents
      .detailsPopupObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        (event: { layerId: MapVectorLayerName; featureId: string }) => {
          this.selectedHfId = null;
          if (event.layerId !== HF_LAYER) {
            return;
          }
          this.selectedHfId = event.featureId;
          this.changeDisableSinglePropertyIfNeeded();
          if (this.singleCatchment) {
            this.updateCatchmentLineVisualizationPattern([
              this.selectedHfId,
            ]).then();
            this.disableSingleCatchment = false;
            // this.microplanMapEvents.setDisableSingleCatchment(false);
          }
        }
      );
  }
  private subscribeToMapEventsForCatchmentRedraw() {
    // // 2. Show single catchment was selected
    // this.microplanMapEvents.showSingleCatchmentObs().pipe(
    //   takeUntil(this.unsubscribe)).subscribe(showSingleCatchment => {
    //     if (this.singleCatchment == showSingleCatchment) {
    //       return;
    //     }
    //     this.singleCatchment = showSingleCatchment;
    //     this.updateCatchmentLineVisualizationPattern([this.selectedHfId? this.selectedHfId: this.activePageContext.hfId]).then();
    //   });

    // 3. any component can trigger that catchment should be re-rendered (some data has changed that is related to the
    // catchment)
    this.microplanMapEvents
      .redrawCatchmentObs()
      .pipe(
        switchMap((_ok) => {
          return this.crudLayerService.suppressUserInterfaceUpdates.asObservable();
        }),
        filter((suppressUi) => !suppressUi),
        takeUntil(this.unsubscribe)
      )
      .subscribe((_) => {
        this.logger.debug(
          'triggerCatchmentRendering / microplan-boundary-map redraw catchment obs'
        );
        this.updateRasterSquaresVisualizationPattern(true).then();
        this.updateCatchmentLineVisualizationPattern().then();
      });

    // 4. any component can trigger that everything related HF/outreaches/catchment should be re-rendered (some data has changed)
    this.microplanMapEvents
      .hfMovedObs()
      .pipe(
        withLatestFrom(
          this.crudLayerService.suppressUserInterfaceUpdates.asObservable()
        ),
        filter(([_hfId, suppressUi]) => !suppressUi),
        takeUntil(this.unsubscribe)
      )
      .subscribe(([hfId, _suppressUi]) => {
        this.logger.debug(
          'microplan-boundary-map redraw HF blue lines and catchment buffer as needed'
        );
        //this.updateHfRelatedVisualizatio();

        //to force a redraw
        this.mapEvents.hfToOutreachDrawnLines.clear();

        this.visualizeHfOutreachRelation();

        //And the distance buffers
        this.baselineService.visualizeHFBuffers(
          this.bvService.data,
          this.mapEvents,
          hfId
        );
      });
    this.extentChange.pipe(takeUntil(this.unsubscribe)).subscribe((extent) => {
      //We want to ignore extent changes if suppress ui is true, it's ok
      //if some extent notifications get lost, so we don't need a complex
      //observable mechanism or anything here
      if (this.crudLayerService.suppressUserInterfaceUpdates.getValue()) {
        this.logger.debug(
          'microplan-boundary-map extent change ignored',
          extent,
          this.extent
        );
        return;
      }

      if (this.rasterSquaresVisualizationSubscription) {
        this.logger.debug('Visualization underway, skiping extent change');
        return;
      }

      // this.logger.debug("microplan-boundary-map extent change", extent, this.extent);
      //For perf reasons seems better to render everything up front
      //this.updateRasterSquaresVisualizationPattern(false).then();
    });
  }

  private createMapLayers() {
    this.layers.forEach((l) => {
      let layer = this.createNewLayerFromConfig(l);
      let layerId = l.id;
      if (layerId.endsWith('_icon')) {
        layerId = layerId.replace('_icon', '') as MapVectorLayerName;
      }
      this.vectorSourceService
        .get_observable(layerId)
        .pipe(takeUntil(this.unsubscribe))
        .subscribe((source) => {
          this.logger.debug(
            `Boundary map vector source observable ${l.mapLayerId} ${
              source.getFeatures().length
            }`
          );
          // TODO - looks like something that could be optimized
          if (l.id === LAYER_BOUNDARY_ID && source.getFeatures().length > 0) {
            if (this.mapState.getState().focus) {
              this.addBoundaryMask(source);
            } else {
              this.mapState.state
                .pipe(
                  takeWhile((state) => state.focus === undefined),
                  takeUntil(this.unsubscribe)
                )
                .subscribe(() => {
                  this.mapState.state.pipe(first()).subscribe((state) => {
                    setTimeout(() => {
                      if (state.focus) {
                        this.addBoundaryMask(source);
                      }
                    }, 50);
                  });
                });
            }
          }

          // Set layer source if not yet done
          if (layer.getSource() != source) {
            layer.setSource(source);
          }

          // reset HF/st focus lists
          if (l.id === HF_LAYER) {
            this.focusedHfs = false;
          } else if (l.id === ST_NAME_LAYER) {
            this.focusedSettlements = false;
          }
        });
      this.addOverlayLayers(layer, l.index);
    });
    this.locationLayer.set('id', LayerIds.LOCATION);
    this.locationLayer.set('name', 'UserLocation');
    this.addOverlayLayers(this.locationLayer, OverlayLayer.GNSS_LOCATION);
    this.addEditBoundaryLayer();
  }

  private createNewLayerFromConfig(layerConfig: MapLayer) {
    const layer = new VectorLayer({
      style: layerConfig.style,
      declutter:
        layerConfig.mapLayerId == ST_NAME_LAYER ||
        layerConfig.mapLayerId == HF_LAYER,
    });
    layer.set('id', layerConfig.mapLayerId);
    if (layerConfig.name) {
      layer.set('name', layerConfig.name);
    }
    if (layerConfig.legendGroup) {
      layer.set('legendGroup', layerConfig.legendGroup);
    }

    if (layerConfig.visible === false) {
      layer.setVisible(false);
    }
    return layer;
  }
  private addEditBoundaryLayer() {
    const layerConfig = {
      id: BOUNDARY_EDITED_LAYER,
      mapLayerId: BOUNDARY_EDITED_LAYER,
      name: 'Edited boundary',
      visible: false,
      index: OverlayLayer.EDITD_BOUNDARIES,
      style: (feature, resolution) => {
        return editedBoundariesStyleFunction(this.bvService.data.boundaryId)(
          feature,
          resolution
        );
      },
    } as MapLayer;
    let layer = this.createNewLayerFromConfig(layerConfig);
    this.vectorSourceService
      .get_observable(layerConfig.id)
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((source) => {
        // Set layer source if not yet done
        if (layer.getSource() != source) {
          layer.setSource(source);
        }
        this.addOverlayLayers(layer, layerConfig.index);
      });
  }

  private addCatchmentRelatedLayers() {
    this.populationRasterGeneric.set('id', LayerIds.POP_RASTER_GENERIC);
    this.populationRasterGeneric.set('name', 'Population');
    this.populationRasterGeneric.set('legendGroup', 'SETTLEMENTS');
    this.addOverlayLayers(
      this.populationRasterGeneric,
      OverlayLayer.POP_RASTER_GENERIC
    );

    this.populationRasterProblematic.set('id', LayerIds.POP_RASTER_PROBLEMATIC);
    this.populationRasterProblematic.set('name', 'Problematic');
    this.populationRasterProblematic.set('legendGroup', 'POPULATION');
    this.addOverlayLayers(
      this.populationRasterProblematic,
      OverlayLayer.POP_RASTER_PROBLEMATIC
    );

    // this.populationRasterValues.set('id', LayerIds.POP_RASTER_VALUES);
    // this.populationRasterValues.set('name', 'Population raster values');
    // this.populationRasterValues.set('legendGroup', 'POPULATION');
    // this.addOverlayLayers(this.populationRasterValues, 4);

    this.hfBufferLayer.set('id', LayerIds.HF_BUFFERS);
    this.hfBufferLayer.set('name', 'Distance');
    this.hfBufferLayer.set('legendGroup', 'GUIDES');
    this.hfBufferLayer.setVisible(this.distanceGuidesAreEnabled);
    this.addOverlayLayers(this.hfBufferLayer, OverlayLayer.HF_BUFFERS);

    this.hfVoronoiLayer.set('id', LayerIds.HF_VORONOI);
    this.hfVoronoiLayer.set('name', 'Voronoi');
    this.hfVoronoiLayer.set('legendGroup', 'GUIDES');
    this.addOverlayLayers(this.hfVoronoiLayer, OverlayLayer.HF_VORONOI);

    this.catchmentLayer.set('id', LayerIds.CATCHMENT);
    this.catchmentLayer.set('name', 'Catchment');
    this.catchmentLayer.set('legendGroup', 'HEALTH FACILITIES');
    this.catchmentLayer.setVisible(true);
    this.addOverlayLayers(this.catchmentLayer, OverlayLayer.CATCHMENT);

    // Listen to the service API for new highlight features
    // Note the HF and settlement highlighting is handled by subscribeFeatureHighlights
    this.mapEvents
      .getOverlayFeaturesObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((overlayFeatures) => {
        this.addOverlayFeatures(
          overlayFeatures[OverlayLayer.NORMAL],
          this._featureOverlayLayer,
          true
        );
        this.addOverlayFeatures(
          overlayFeatures[OverlayLayer.DRAWN_POLYGONS],
          this._featureOverlayLayer,
          false
        );
        //Outreach lines are not in the selectable layer list, so we add them to the regular feature overlayr
        this.addOverlayFeatures(
          overlayFeatures[OverlayLayer.OUTREACH_LINES],
          this._featureOverlayLayer,
          false
        );
        // this.addSelectedOverlayFeatures(overlayFeatures[OverlayLayer.NORMAL_SELECTED], this._selectedFeatureOverlayLayer);
        this.addOverlayFeatures(
          overlayFeatures[OverlayLayer.CATCHMENT],
          this.catchmentLayer
        );
        this.addOverlayFeatures(
          overlayFeatures[OverlayLayer.POP_RASTER_VALUES],
          this.populationRasterValues
        );
        this.addOverlayFeatures(
          overlayFeatures[OverlayLayer.POP_RASTER_GENERIC],
          this.populationRasterGeneric
        );
        this.addOverlayFeatures(
          overlayFeatures[OverlayLayer.POP_RASTER_PROBLEMATIC],
          this.populationRasterProblematic
        );
        this.addOverlayFeatures(
          overlayFeatures[OverlayLayer.HF_VORONOI],
          this.hfVoronoiLayer
        );
        this.addOverlayFeatures(
          overlayFeatures[OverlayLayer.HF_BUFFERS],
          this.hfBufferLayer
        );
        // this.addOverlayFeatures(overlayFeatures[OverlayLayer.GNSS_LOCATION], this.locationLayer);
      });

    // draw layers that are not page specific
    this.microplanMapEvents
      .distanceSliderValueChangeObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((_) => {
        this.baselineService.visualizeHFBuffers(
          this.bvService.data,
          this.mapEvents,
          this.activePageContext.hfId
        );
      });
  }

  private subscribeToMapMovementChange() {
    this.mapEvents.getMapMovementObs().subscribe((mapMovementArg) => {
      this.logger.debug('Map event movement', mapMovementArg);
      switch (mapMovementArg.movementType) {
        case 'Pan':
          this.handlePan(mapMovementArg);
          break;
        case 'Center': {
          this.panToLocation(mapMovementArg.center).then();
          break;
        }
      }
    });
  }

  subscribeToInteractions() {
    this.mapEvents
      .getInteractionsObservable()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((enable) => {
        this.enableRouting = enable;
      });
  }

  subscribeToWizardEnabled() {
    this.mapEvents
      .getIsWizardEnabled()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((enable) => {
        this.wizardEnabled = enable;
      });
  }

  private ngAfterViewInitAfterRestrictFocus(s: MapState) {
    // Let's wait until we init the map until the map focus was set
    super.ngAfterViewInit();

    // Do an initial zoom
    this.zoomToExtent(
      s.extent as Extent,
      BOUNDARY_ZOOM_ADJUSTMENT,
      false
    ).then();

    // Make sure we update te selection mode to allow multiple selections
    this.selectionMode.single = false;

    // Set the view on the shared map state (shares state with baseline map)
    this.mapState.setView(this.map?.getView() as View);
    this.mapEvents.setIsMapInitialized(true);

    // Mat drawer can adjust size, make sure it's correct
    this.map!.updateSize();
  }

  private subscribeClearFocus() {
    this.mapEvents
      .clearFocusObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((event) => {
        this.selectedHfId = null;
        this.clearSelection(true);

        // make sure we reset focused HF afterwards
        this.selectedHfId = this.activePageContext.hfId;
        this.selectedSettlementId = this.activePageContext.snId;
        if (this.selectedHfId != null) {
          this.selectHfOnMap();
        } else if (this.selectedSettlementId != null) {
          this.selectSettlementOnMap();
        }
        this.changeDisableSinglePropertyIfNeeded();
        if (this.singleCatchment) {
          this.updateCatchmentLineVisualizationPattern([
            this.selectedHfId!,
          ]).then();
        }
      });
  }

  // private subscribeCreatingEditableLayer() {
  //   this.microplanMapEvents.editFirstFeatureInLayerObs().pipe(takeUntil(this.unsubscribe))
  //     .subscribe(layerName => {
  //       //_featureOverlayLayer _drawOverlayLayer boundary__polygon
  //       let features = (this.getMapLayerById(layerName) as VectorLayer).getSource().getFeatures() as Array<Feature<Geometry>>;
  //       this.microplanMapEvents.editPolygonConfig.next({
  //         active: true,
  //         features: features
  //       });
  //     });
  // }

  private subscribeMapSingleClick() {
    // Subscribe to map
    this.mapEvents
      .getIsMapInitialized()
      .pipe(
        filter((mapInit) => {
          return mapInit;
        }),
        switchMap((_) => {
          return this.mapSingleclick;
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe((event) => {
        const selectedObject = this.getSelectedObject(event.pixel)!;
        // Notify via mapEvents
        this.mapEvents.emitClicked(selectedObject);
        this.selectedHfId = null;
        if (
          selectedObject &&
          (selectedObject.selectedLayer === HF_LAYER ||
            selectedObject.selectedLayer === HF_LAYER_ICON)
        ) {
          this.selectedHfId = selectedObject.selectedGlobalId;
          if (this.singleCatchment) {
            this.updateCatchmentLineVisualizationPattern([
              this.selectedHfId!,
            ]).then();
            // this.microplanMapEvents.setDisableSingleCatchment(false);
            this.disableSingleCatchment = false;
          }
        } else {
          this.changeDisableSinglePropertyIfNeeded();
        }
      });
  }

  private subscribeMapSelectionChange() {
    // Subscribe to map selection changes and update the settlement selection accordingly
    this.mapEvents
      .getIsMapInitialized()
      .pipe(
        filter((mapInit) => {
          return mapInit;
        }),
        switchMap((_) => {
          return this.selectionChange;
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe((selection) => {
        if (
          Object.keys(selection).length === 0 &&
          this.microplanMapEvents.getSelectedSettlementParts().length !== 0
        ) {
          this.microplanMapEvents.setSelectedSettlementParts([]);
        } else {
          this.microplanMapEvents.setSelectedSettlementParts(
            Object.values(selection).map((s) => {
              return s.feature.get('global_id');
            })
          );
        }
      });
  }

  private subscribeSelectedPartsChanged() {
    if (this.selectable === false) {
      return;
    }
    // Subscribe to changes of the settlement selections
    // We want the map to be initialized, if ever the map is not initialized, once it switches back to true
    // the obseravble will refire with the latest from the settlement parts observable
    const combinedObs = combineLatest([
      this.mapEvents.getIsMapInitialized(),
      this.microplanMapEvents.getSelectedSettlementPartsObservable(),
    ]);
    combinedObs
      .pipe(
        filter(([isInitialized, _]) => {
          return isInitialized;
        }),
        takeUntil(this.unsubscribe)
      )
      .subscribe(([_, settlement_parts]) => {
        // Clear all selected
        if (settlement_parts.length === 0) {
          this.clearSelection(true);
        }
        // Select and unselect based on selection
        else {
          // Update the tool flags

          // Make sure the toggle button is active by enabling map selection
          if (this.selectable === false) {
            this.selectable = [ST_GEOMETRY_LAYER];
            this.selectableChange.emit(true);
          }

          const to_select: Feature[] = [];
          const to_unselect: Feature[] = [];
          const settlementPartLayer: VectorLayer = this.getMapLayerById(
            ST_GEOMETRY_LAYER
          ) as VectorLayer;
          if (!settlementPartLayer) {
            this.logger.error(
              `Map should be initialized and ${ST_GEOMETRY_LAYER} should exist`
            );
            return;
          }
          settlementPartLayer
            .getSource()!
            .getFeatures()
            .forEach((f) => {
              if (settlement_parts.includes(f.get('global_id'))) {
                to_select.push(f);
              } else {
                to_unselect.push(f);
              }
            });

          // Add new settlements to map selection
          this.highlightFeatures(
            to_select,
            undefined,
            true,
            undefined,
            undefined,
            false,
            true
          ).then();

          // Remove previously selected from the map selection
          this.unhighlightFeatures(to_unselect, true);
        }
      });
  }

  private subscribeFeatureHighlights() {
    this.microplanMapEvents
      .settlementHighlightEventObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((stId) => {
        this.resetHighlight();
        if (stId != null) {
          this.selectedSettlementId = stId;
          this.selectSettlementOnMap();
        }
      });
    this.microplanMapEvents
      .hfHighlightEventObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((hfId) => {
        this.resetHighlight();
        // this.microplanMapEvents.setDisableSingleCatchment(false);
        this.disableSingleCatchment = false;
        this.selectedHfId = hfId;
        if (hfId != null) {
          this.selectHfOnMap();
        }
        this.changeDisableSinglePropertyIfNeeded();
        if (this.singleCatchment) {
          this.updateCatchmentLineVisualizationPattern([
            this.selectedHfId!,
          ]).then();
        }
      });
    this.microplanMapEvents
      .poiHighlightEventObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((poiId) => {
        this.resetHighlight();
        this.highlightPoi(poiId);
      });
  }

  override ngAfterViewInit() {
    // Bind map state to map state service
    this.mapState.state.pipe(takeUntil(this.unsubscribe)).subscribe((s) => {
      if (
        (this.focus == undefined && s.focus) ||
        (this.focus && s.focus && !equalExtents(s.focus, this.focus))
      ) {
        this.restrictFocus(s.focus || false, true).then(() => {
          this.ngAfterViewInitAfterRestrictFocus(s);
        });
      } else if (s.baselayer && s.baselayer != this.baselayer?.get('id')) {
        this.toggleBaseLayer(
          this.getMapLayerById(s.baselayer, true) as BaseLayer
        );
      }
    });
    this.baselayerChange.pipe(takeUntil(this.unsubscribe)).subscribe((l) => {
      //FYI Andres
      //Note !  On basemap layer change we want to redraw everything because we may have styles dependent on the basemap
      this.map?.getLayers().forEach((layer) => {
        if (!(layer instanceof VectorLayer)) {
          //continue
          return true;
        }
        layer.changed();
        return true;
      });

      if (!l) {
        this.mapState.setBaselayer(null);
        return;
      }
      if (l.get('id') !== this.mapState.getState().baselayer) {
        this.mapState.setBaselayer(l.get('id'));
      }
    });
    if (this.baselayer) {
      this.mapState.setBaselayer(this.baselayer.get('id'));
    }
  }

  private setComponentPermissions(): void {
    const boundaryId = this.bvService.data.boundaryId;
    if (boundaryId) {
      // this.userHasPermissionsCreateSettlement = this.userContextService.userHasPermissions(VectorLayerForPermissions.settlement, "create", this.boundaryID);
      this.userHasPermissionsUpdateSettlement =
        this.userContextService.userHasPermissions(
          VectorLayerForPermissions.settlement,
          'update',
          boundaryId
        );
    }
  }

  // public async recomputeAll() {
  //   await this.bvService.ensureBoundaryLoaded(this.boundaryID).pipe(first()).toPromise();
  //
  //   await this.bvService.computeAllCatchmentAssignments(null, null);
  // }

  private getClickedObjects(
    pixel: [number, number]
  ): Array<[Feature, VectorLayer]> {
    const clickedObjects: [Feature, VectorLayer][] = [];

    if (!this.map) {
      return [];
    }

    this.map!.forEachFeatureAtPixel(
      pixel,
      (feature, layer) => {
        clickedObjects.push([feature as Feature, layer as VectorLayer]);
      },
      {
        layerFilter: (l) => {
          return [
            HF_LAYER,
            HF_LAYER_ICON,
            ST_NAME_LAYER,
            ST_NAME_LAYER_ICON,
            CHURCH_LAYER,
            MOSQUE_LAYER,
            MARKET_LAYER,
            SCHOOL_LAYER,
            ST_GEOMETRY_LAYER,
          ].includes(l.get('id'));
        },
        hitTolerance: 6,
      }
    );

    return clickedObjects;
  }

  private getSelectedObject(
    pixel: [number, number]
  ): null | MicroplanMapClicked {
    if (!this.enableRouting) {
      return null;
    }

    //In 4326
    const projectedCoordinates = this.map?.getCoordinateFromPixel(pixel)!;
    const coordinates = this.projectFromMap(projectedCoordinates);
    const clickedObjects = this.getClickedObjects(pixel);
    if (clickedObjects.length <= 0) {
      //In this case, let's check for settlement parts
      const clickedSettlementPart = this.bvService.data.spList.find((sp) => {
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

      if (clickedSettlementPart) {
        return {
          selectedGlobalId: clickedSettlementPart.properties.global_id,
          selectedLayer: ST_GEOMETRY_LAYER,
          coordinates,
        };
      }

      this.logger.debug(`Nothing clicked`, coordinates);

      return null;
    }

    //We are in selection mode, for settlement part manipulation, so we don't want to route
    if (this.selectable === true) {
      return null;
    }

    clickedObjects.sort((a, b) => {
      if (a[1].getZIndex()! < b[1].getZIndex()!) {
        return 1;
      } else if (a[1].getZIndex()! > b[1].getZIndex()!) {
        return -1;
      } else {
        return 0;
      }
    });

    return {
      selectedGlobalId: clickedObjects[0][0].get('global_id'),
      selectedLayer: clickedObjects[0][1].get('id'),
      coordinates,
    };
  }

  protected override onFeatureSelection(feature: Feature): boolean {
    return true;
  }

  protected override onFeatureDeselection(feature: Feature): boolean {
    return true;
  }

  protected override onFeatureHighlight(feature: Feature): boolean {
    return false;
  }

  protected override onFeatureUnhighlight(feature: Feature): boolean {
    //this.clearOverlayFeatures();
    return false;
  }

  protected override allowFeatureSelection(
    feature: Feature,
    layer: VectorLayer
  ): boolean {
    if (layer.get('id') != ST_GEOMETRY_LAYER) {
      return true;
    }

    const spId = feature.get('global_id');
    const sp = this.bvService.data.spMap.get(spId);
    if (!sp) {
      return false;
    }

    //Only allow settlement parts inside this boundary to be selected
    return sp.properties.boundary_polygon == this.bvService.data.boundaryId;
  }

  toggleStrategy(version?: string) {
    version = version
      ? version
      : Object.keys(this.strategyOptions).filter((x) => {
          return x !== this.selectedStrategy;
        })[0];
    if (version !== this.selectedStrategy) {
      this.selectedStrategy = version;
      this.logger.info('Toggle Strategy!', version);
    }
  }

  private addBoundaryMask(source: VectorSource) {
    if (AppConfigService.ENABLE_BOUNDARY_CHOICES) {
      return;
    }

    const boundaryId = this.bvService.data.boundaryId;

    this.logger.info(
      `addBoundaryMask boundaryId ${boundaryId} ${
        this.mapState?.getState()?.focus
      }`
    );

    const boundary_feature = source
      .getFeatures()
      .find((f) => f.getProperties().global_id === boundaryId);

    if (!boundary_feature) {
      this.logger.info(
        `addBoundaryMask boundaryId ${boundaryId} boundary feature not found`
      );
      return;
    }

    const mask_feature = source
      .getFeatures()
      .find((f) => f.get('id') === 'mask');

    if (mask_feature) {
      this.logger.info(
        `addBoundaryMask boundaryId ${boundaryId} mask feature already exists`
      );
      return;
    }

    const focusExtent = this.projectToMap(
      this.mapState.getState().focus as Extent
    );

    if (!focusExtent) {
      this.logger.info(
        `addBoundaryMask boundaryId ${boundaryId} focus extent does not exist`
      );
      return;
    }
    // We want to add a mask to cover blank areas (Use a buffered extent)
    const mapExtent: TurfFeature<TurfPolygon> = bboxPolygon(
      bufferExtent(focusExtent as Extent, 3) as TurfBBox
    );

    let mask: TurfFeature<TurfPolygon | TurfMultiPolygon> | undefined =
      undefined;
    source.getFeatures().forEach((f) => {
      if (f.get('level') === boundary_feature.get('level')) {
        mask = difference(
          (mask as TurfFeature<TurfPolygon | TurfMultiPolygon>) || mapExtent,
          multiPolygon((f.getGeometry()! as SimpleGeometry).getCoordinates()!)
        ) as TurfFeature<TurfPolygon | TurfMultiPolygon>;
      }
    });

    if (!mask) {
      this.logger.info(`addBoundaryMask boundaryId ${boundaryId} no mask`);
      return;
    }

    let mask_geometry;
    if (
      (mask as TurfFeature<TurfPolygon | TurfMultiPolygon>).geometry.type ===
      'Polygon'
    ) {
      mask_geometry = new Polygon(
        (mask as TurfFeature<TurfPolygon>).geometry.coordinates
      );
    } else {
      mask_geometry = new MultiPolygon(
        (mask as TurfFeature<TurfMultiPolygon>).geometry.coordinates
      );
    }
    const newMaskFeature = new Feature({
      geometry: mask_geometry,
    });
    newMaskFeature.set('id', 'mask');
    source.addFeature(newMaskFeature);
  }

  getSettlementFeature(settlement_id: string): Feature {
    return (this.getMapLayerById(ST_GEOMETRY_LAYER) as VectorLayer)
      .getSource()!
      .getFeatures()
      .find((f) => f.get('global_id') === settlement_id) as Feature;
  }

  // zoomToBoundary() {
  //   const boundary = this.bvService.data.getCurrentBoundary();
  //   if (boundary) {
  //     this.zoomToFeatures(
  //       [this.projectGeometryToMap(new MultiPolygon(boundary.geometry.coordinates))],
  //       undefined,
  //       BOUNDARY_ZOOM_ADJUSTMENT,
  //       true
  //     ).then();
  //   }
  // }

  public handleDistanceMetersSliderChange(distanceMeters: [number, number]) {
    // for guids calculation in BaselineService
    this.baselineService.setDistanceValues(distanceMeters);
    // for consistent UI when switching between the pages
    this.distanceMetersInput = distanceMeters;
    // for UI to trigger guides recalculation (could be deleted when this is calculated somewhere globally)
    this.microplanMapEvents.distanceSliderValueChangeEvent(distanceMeters);
  }

  /**
   * When user clicks on checkbox emit event that has layer id and visible or not information as MapLayerSelection
   * object
   * @param layerSelection
   */
  public handleLayerVisibilityChange(layerSelection: MapLayerSelection) {
    this.logger.info(
      'handleLayerVisibilityChange',
      layerSelection.id,
      'layerSelection.id',
      layerSelection.visible,
      'layerSelection.visible'
    );

    if (
      layerSelection.id == LayerIds.HF_VORONOI.toString() &&
      layerSelection.visible
    ) {
      this.mapEvents.removeAllFeatures(OverlayLayer.HF_VORONOI);
      this.baselineService.visualizeHFVoronoi(
        this.bvService.data,
        this.mapEvents
      );
    }

    //Tie outreach---fixed post dashed line visibility to the HF/Outreach layer
    if (layerSelection.id == HF_LAYER || layerSelection.id == HF_LAYER_ICON) {
      if (layerSelection.visible) {
        //put them back
        this.visualizeHfOutreachRelation();
      } else {
        this.mapEvents.removeAllFeatures(OverlayLayer.OUTREACH_LINES);
      }
    }

    if (
      layerSelection.id == LayerIds.POP_RASTER_VALUES.toString() ||
      layerSelection.id == LayerIds.POP_RASTER.toString()
    ) {
      //regardless of visibility, we want to clear & redraw
      //These layers show the same thing, so we don't want to keep both, except the pop raster values shows the text
      this.removeAllRasterSquareLayers();
    }

    // this.mapEvents.triggerLayerVisibilityChange(layerSelection.id, layerSelection.visible);
    let layer = this.getMapLayerById(layerSelection.id)!;
    if (layer.getVisible() != layerSelection.visible) {
      layer.setVisible(layerSelection.visible);
      // HF and ST layer has additional layers for their icons so let's change their visibility here as well
      if (layerSelection.id == HF_LAYER) {
        this.getMapLayerById(HF_LAYER_ICON)!.setVisible(layerSelection.visible);
      } else if (layerSelection.id == ST_NAME_LAYER) {
        this.getMapLayerById(ST_NAME_LAYER_ICON)!.setVisible(
          layerSelection.visible
        );
      }
    }

    if (layerSelection.id == LayerIds.HF_BUFFERS.toString()) {
      this.distanceGuidesAreEnabled = layerSelection.visible;
      this.renderHfBuffers();
    }

    // layer selection shortcuts state
    if (layerSelection.visible) {
      this.visibleLayers.push(layerSelection.id);
    } else {
      this.visibleLayers = this.visibleLayers.filter(
        (layerId) => layerId != layerSelection.id
      );
    }
  }

  public changePopLayersVisibility() {
    let visible = !this.visibleLayers.includes(LayerIds.POP_RASTER_GENERIC);
    this.handleLayerVisibilityChange({
      id: LayerIds.POP_RASTER_GENERIC,
      visible: visible,
    });
    this.handleLayerVisibilityChange({
      id: LayerIds.POP_RASTER_PROBLEMATIC,
      visible: visible,
    });
  }

  /**
   * @private
   */
  private selectHfOnMap(): void {
    this.logger.debug(`drawHfFeatures - hf hfId: ${this.selectedHfId}`);

    if (!this.selectedHfId) {
      return;
    }
    this.clearSelection(true); // remove previous highlights
    // this.mapEvents.removeAllFeatures(OverlayLayer.NORMAL_SELECTED);
    const selectedFeaturesIcon = this.findFeaturesById(
      [HF_LAYER_ICON],
      [this.selectedHfId]
    );
    if (this.bvService.data.hfMap) {
      this.highlightFeatures(
        selectedFeaturesIcon,
        (feature, resolution) => {
          return healthFacilitiesStyleFunction(
            true,
            false,
            this.isSatelliteBasemapEnabled()
          )(feature, resolution);
        },
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        HF_LAYER_ICON
      );
    }
  }

  /**
   * @private
   */
  public selectSettlementOnMap(): void {
    // this.logger.debug(`symbology: drawSettlementFeatures - settlementId: ${this.selectedSettlementId}`);

    if (!this.selectedSettlementId) {
      return;
    }
    this.clearSelection(true); // remove previous highlights
    // get icon features because they are not decluttered (text is decluttered)
    const selectedFeaturesIcon = this.findFeaturesById(
      [ST_NAME_LAYER_ICON],
      [this.selectedSettlementId]
    );

    if (this.bvService.data.snMap) {
      // this.logger.debug(`symbology: highlightFeatures - settlementId: ${this.selectedSettlementId}`);
      this.highlightFeatures(
        selectedFeaturesIcon,
        (feature, resolution) => {
          // this.logger.log('symbology: selectedFeatures', selectedFeatures, this.selectedSettlementId);
          return settlementsStyleFunction(
            true,
            false,
            null,
            this.isSatelliteBasemapEnabled()
          )(feature, resolution);
        },
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        ST_NAME_LAYER
      );
    }
  }
  private highlightPoi(poiId: string): void {
    if (!poiId) {
      return;
    }
    this.clearSelection(true); // remove previous highlights
    const selectedFeatures = this.findFeaturesById(MAP_POI_LAYERS, [poiId]);
    this.highlightFeatures(
      selectedFeatures,
      (feature, resolution) => {
        return poiStyleFunction(true)(feature, resolution);
      },
      true
    );
  }
  private async updateCatchmentLineVisualizationPattern(
    hfIds?: string[]
  ): Promise<void> {
    this.logger.info('updateCatchmentLineVisualizationPattern');
    //debugger;
    this.mapEvents.removeAllFeatures(OverlayLayer.HF_VORONOI);
    this.mapEvents.removeAllFeatures(OverlayLayer.CATCHMENT);
    if (this.hfVoronoiLayer.getVisible()) {
      //Voronoi are always the same
      this.baselineService.visualizeHFVoronoi(
        this.bvService.data,
        this.mapEvents
      );
    }

    this.renderHfBuffers();
    this.visualizeHfOutreachRelation();
    return this.updateCatchmentLineVisualization(hfIds);
  }

  private removeAllRasterSquareLayers() {
    this.mapEvents.removeAllFeatures(OverlayLayer.POP_RASTER_GENERIC);
    this.mapEvents.removeAllFeatures(OverlayLayer.POP_RASTER_PROBLEMATIC);
    this.mapEvents.removeAllFeatures(OverlayLayer.POP_RASTER_VALUES);
  }
  private renderHfBuffers() {
    if (!this.hfBufferLayer.getVisible()) {
      return;
    }

    let hf: GeoJsonHealthFacility | null = null;
    if (this.singleCatchment) {
      const hfId = this.activePageContext.hfId;
      if (hfId) {
        hf = this.bvService.data.hfMap.get(hfId)!;
      }
    }

    this.baselineService.visualizeHFBuffers(
      this.bvService.data,
      this.mapEvents,
      hf ? hf.properties.global_id : null
    );
  }

  /*
    Draws the line / polygon around the health facilities indicating which
    pop squares are in their catchment.
    */
  private async updateCatchmentLineVisualization(
    hfIdsParam: string[] | undefined
  ): Promise<void> {
    //debugger;
    if (!this.activePageContext) {
      this.logger.warn(
        'updateRasterSquaresVisualizationPattern activePageContext is not truthy'
      );
      return;
    }

    if (!this.catchmentLayer.getVisible()) {
      this.logger.debug('Catchment layer not visible, not drawing');
      return;
    }

    //If this method was already underway, this will cancel the drawing being done
    if (this.catchmentLineVisualizationSubscription) {
      this.catchmentLineVisualizationSubscription.unsubscribe();
      this.catchmentLineVisualizationSubscription = null;
    }

    //Based on our current page, see if we need to limit the catchment to a health facility
    const hfFilter = this.getHfFilter(hfIdsParam);

    this.catchmentLineVisualizationSubscription = this.baselineService
      .refreshCatchmentLineVisualization(
        this.mapEvents,
        this.bvService.data,
        hfFilter
      )
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        (_) => {},
        (err) => {
          this.logger.error(
            'Error with refreshCatchmentLineVisualization',
            err
          );
        },
        () => {
          this.catchmentLineVisualizationSubscription = null;
        }
      );
  }

  /*
    During catchment polygon/line drawing, if we are drawing a single catchment
    like when only 1 hf is selected (hf details), this returns which hf ids to draw
    otherwise null to draw the current boundaries hf catchments (like in hf list)
    */
  private getHfFilter(hfIdsParam: string[] | undefined): Set<string> | null {
    const hfIds: Array<string> =
      _.isArray(hfIdsParam) && hfIdsParam.length > 0
        ? hfIdsParam
        : [this.activePageContext.hfId!];

    if (!this.singleCatchment) {
      return null;
    }

    const hfFilter = new Set<string>();
    if (!_.isArray(hfIds) || hfIds.length == 0) {
      this.logger.warn('Expected some hfids in single catchment mode');
      //draw them all
      return null;
    }

    for (const hfId of hfIds) {
      const hf = this.bvService.data.hfMap.get(hfId)!;
      if (_.isNil(hf)) {
        continue;
      }
      const hfWithOutreach = [hf].concat(
        this.bvService.data.hfChildMap.get(hf.properties.global_id) || []
      );
      for (const hfIter of hfWithOutreach) {
        hfFilter.add(hfIter.properties.global_id);
      }
    }

    return hfFilter;
  }

  /**
   * Updates visualization - TODO test on tablets and we should make the
   * case more specific to not recalculate all the styles
   *
   */
  private async updateRasterSquaresVisualizationPattern(
    isInitial: boolean
  ): Promise<void> {
    this.removeAllRasterSquareLayers();

    //If none of the layers that display raster squares / catchment lines are visible, we have nothing to do
    //When one is enabled again, initCatchmentVisualizationPattern will be called
    if (
      !this.populationRasterGeneric.getVisible() &&
      !this.populationRasterProblematic.getVisible()
    ) {
      return;
    }
    this.logger.debug(
      `updateRasterSquaresVisualizationPattern - is initial: ${isInitial}`
    );
    //If this method was already underway, this will cancel the drawing being done
    if (this.rasterSquaresVisualizationSubscription) {
      this.logger.debug(
        'rasterSquaresVisualizationSubscription unsubscribe updateRasterSquaresVisualizationPattern'
      );
      this.rasterSquaresVisualizationSubscription.unsubscribe();
      this.rasterSquaresVisualizationSubscription = null;
    }

    this.rasterSquaresVisualizationSubscription = this.baselineService
      .visualizeBoundaryRasterSquares(
        this.mapEvents,
        this.bvService.data,
        isInitial
      )
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(
        (_) => {
          this.logger.debug(
            'Performance test (map component load): ',
            window.performance.now()
          );
        },
        (err) => {
          this.logger.error('Error with visualizeBoundaryRasterSquares', err);
        },
        () => {
          this.logger.info(
            'rasterSquaresVisualizationSubscription / visualizeBoundary complete'
          );
          this.rasterSquaresVisualizationSubscription = null;
        }
      );
  }
  handleZoomToTableLocation() {
    if (
      !this.locationFeature ||
      this.locationFeature.geo_json.geometry.coordinates[0] == -1 ||
      !this.locationService.isGPSSupported()
    ) {
      this.messageService.add(this.locationService.gpsErrorMessage());
      return;
    }
    this.locationService.queryInstantLocation();
    let bufferMeters = buffer(this.bvService.data.getCurrentBoundary(), 100, {
      units: 'kilometers',
    });
    this.logger.info(
      'tabletLocation',
      this.locationFeature!.geo_json.geometry.coordinates
    );
    let booleanPointIsInPolygon = booleanPointInPolygon(
      this.locationFeature.geo_json.geometry.coordinates as Position,
      bufferMeters
    );
    if (!booleanPointIsInPolygon) {
      this.messageService.add({
        summary: 'Outside the map',
        detail: 'You are currently located outside the map.',
        severity: 'error',
      });
      this.logger.info('Your are outside the map.');
    } else {
      this.mapEvents.center({
        movementType: 'Center',
        center: this.locationFeature!.geo_json.geometry.coordinates as Position,
      });
    }
  }

  public handleSingleCatchmentChange() {
    if (this.disableSingleCatchment) {
      return;
    }
    this.singleCatchment = !this.singleCatchment;
    this.updateCatchmentLineVisualizationPattern([
      this.selectedHfId ? this.selectedHfId : this.activePageContext.hfId!,
    ]).then();
  }

  private subscribeToLocationChange() {
    // if(!this.locationService.isGPSSupported()){
    //   this.messageService.add(this.locationService.gpsErrorMessage());
    //   return;
    // }
    this.locationService
      .getLocation()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((position: GeolocationCoordinatesInterfaceFix | null) => {
        if (_.isNil(position)) {
          return;
        }
        if (_.isNil(this.locationFeature)) {
          return;
        }
        if (position?.longitude) {
          this.tabletPosition = {
            ...position,
            speed: Math.round(position.speed!),
            accuracy: Math.round(position.accuracy),
          };
          this.locationFeature!.geo_json.geometry.coordinates = [
            position.longitude,
            position.latitude,
          ];
          const accuracy = circular(
            [position.longitude, position.latitude],
            position.accuracy
          );
          // show circle with different color if accuracy is less than 10m
          this.locationFeature.style = activeLocationStyle;
          this.locationAccuracyFeature.style =
            position.accuracy <=
            AppConfigService.conf.generic.suggested_location_accuracy_m
              ? goodAccuracyStyle
              : badAccuracyStyle;
          this.locationAccuracyFeature.geo_json.geometry.coordinates =
            accuracy.getCoordinates() as Position[][];
          // redrawing feature every time... We should have a way in basemap to update feature
          this.addOverlayFeatures(
            [this.locationFeature, this.locationAccuracyFeature],
            this.locationLayer,
            true
          );
        } else if (!this.locationService.isLocationActive()) {
          this.locationFeature!.style = notActiveLocationStyle;
          this.addOverlayFeatures(
            [this.locationFeature],
            this.locationLayer,
            true
          );
        }
      });
  }

  /**
   * For each HF draw blue lines towards outreaches
   * @private
   */
  private visualizeHfOutreachRelation() {
    const currentOutreachSet = this.getCurrentHfOutreachSet();

    //https://stackoverflow.com/questions/31128855/comparing-ecma6-sets-for-equality
    if (_.isEqual(currentOutreachSet, this.mapEvents.hfToOutreachDrawnLines)) {
      this.logger.debug('No need to redraw outreach lines');
      return;
    }

    this.logger.info('Drawing lines between HF and Outreach');

    this.mapEvents.removeAllFeatures(OverlayLayer.OUTREACH_LINES);

    for (const [_hfGuid, hf] of this.bvService.data.hfMap) {
      if (_.isNil(hf)) {
        continue;
      }
      const outreaches =
        this.bvService.data.hfChildMap.get(hf.properties.global_id) || [];
      for (const outreach of outreaches) {
        this.drawLineBetweenHfAndOutreach(hf, outreach);
      }
    }

    this.mapEvents.hfToOutreachDrawnLines = currentOutreachSet;
  }

  private getCurrentHfOutreachSet(): Set<string> {
    const hfOutreachIdSet = new Set<string>();
    for (const [_hfGuid, hf] of this.bvService.data.hfMap) {
      if (_.isNil(hf)) {
        continue;
      }
      const outreaches =
        this.bvService.data.hfChildMap.get(hf.properties.global_id) || [];
      for (const outreach of outreaches) {
        hfOutreachIdSet.add(
          hf.properties.global_id + outreach.properties.global_id
        );
      }
    }

    return hfOutreachIdSet;
  }

  private drawLineBetweenHfAndOutreach(
    hf: GeoJsonHealthFacility,
    feature: GeoJsonSettlementName | GeoJsonHealthFacility
  ) {
    //Draw a line connecting them
    const line = lineString([
      hf.geometry.coordinates,
      feature.geometry.coordinates,
    ]);

    const lineJson: GeoJsonBase = {
      geometry: {
        type: 'LineString',
        coordinates: line.geometry.coordinates as Position[],
      },
      properties: {
        boundary_polygon: hf.properties.boundary_polygon,
        global_id: uuidv4(),
        version_id: null,
      },
      type: 'Feature',
    };
    this.mapEvents.addFeature({
      geo_json: lineJson,
      layer: OverlayLayer.OUTREACH_LINES,
      style: mapStyles.HF.connectToPoint,
    });
  }

  private subscribeToHfFocus() {
    this.microplanMapEvents
      .focusHfObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((focusedHfs) => {
        this.focusedHfs = focusedHfs;
        this.triggerLayerUpdate(HF_LAYER);
        if (this.singleCatchment) {
          this.updateCatchmentLineVisualizationPattern(focusedHfs).then();
        }
      });
    this.microplanMapEvents
      .removeHfFocusObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((_) => {
        const features = this.getAllFeaturesByLayerId([HF_LAYER]);
        this.unhighlightFeatures(features, false, [HF_LAYER, HF_LAYER_ICON]);
      });
  }

  private subscribeToSettlementFocus() {
    this.microplanMapEvents
      .focusSettlementObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((focusedSettlements) => {
        this.focusedSettlements = focusedSettlements;
        this.triggerLayerUpdate(ST_NAME_LAYER);
      });
    this.microplanMapEvents
      .removeSettlementFocusObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((_) => {
        const features = this.getAllFeaturesByLayerId([ST_NAME_LAYER]);
        this.unhighlightFeatures(features, false, [
          ST_NAME_LAYER,
          ST_NAME_LAYER_ICON,
        ]);
      });
  }

  private subscribeToSettlementPartsSelection() {
    this.microplanMapEvents
      .settlementPartsSelectionObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((enable: boolean) => {
        let layer = this.getMapLayerById(ST_GEOMETRY_LAYER)!;
        if (enable) {
          if (!layer.getVisible()) {
            layer.setVisible(true);
          }
          this.enableSelection([ST_GEOMETRY_LAYER], {
            single: false,
            mixed: false,
          });
        } else {
          if (layer.getVisible()) {
            layer.setVisible(false);
          }
          // this.mapEvents.triggerLayerVisibilityChange(ST_GEOMETRY_LAYER, false);
          this.enableSelection(false, { single: false, mixed: false });
        }
        // disable or enable details panel when settlement parts selection is enabled or disabled
        this.enableRouting = !enable;
      });
  }

  private getAllFeaturesByLayerId(layerIds) {
    let allFeatures: Feature[] = [];
    layerIds
      .map((l) =>
        (this.getMapLayerById(l) as VectorLayer)?.getSource()!.getFeatures()
      )
      ?.forEach((features) => {
        if (features) {
          allFeatures = features;
        }
      });
    return allFeatures;
  }
  private findFeaturesThatDoNotMatchId(layerIds, featureIds) {
    let selectedFeatures: Feature[] = [];
    let notSelectedFeatures: Feature[] = [];
    // const layers = layerIds.map(l => (this.getMapLayerById(l) as VectorLayer));
    layerIds
      .map((layerId) => this.getMapLayerById(layerId) as VectorLayer)
      .forEach((l) => {
        const features = l?.getSource().getFeatures();
        if (features) {
          if (l.getVisible() === true) {
            selectedFeatures = selectedFeatures.concat(
              ...features.filter(
                (feature) =>
                  featureIds.includes(feature.get('global_id')) ||
                  featureIds.includes(feature.get('parent'))
              )
            );

            notSelectedFeatures = notSelectedFeatures.concat(
              ...features.filter(
                (feature) =>
                  !featureIds.includes(feature.get('global_id')) &&
                  !featureIds.includes(feature.get('parent'))
              )
            );
          }
        }
      });
    return { selectedFeatures, notSelectedFeatures };
  }

  private listenToLayerVisibilityChange() {
    this.mapEvents
      .layerVisibilityObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((layerVisibility: { layerId: string; visible: boolean }) => {
        this.handleLayerVisibilityChange({
          id: layerVisibility.layerId,
          visible: layerVisibility.visible,
        });
      });
  }

  private changeDisableSinglePropertyIfNeeded() {
    this.disableSingleCatchment = !this.selectedHfId;
  }

  private isSatelliteBasemapEnabled(): boolean {
    const baseMap = this.getBaseLayerName();
    return baseMap == SATELLITE_MAP;
  }
}
