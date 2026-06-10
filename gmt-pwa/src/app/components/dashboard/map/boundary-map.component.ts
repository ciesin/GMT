import { Component, OnInit } from '@angular/core';
import {
  LayerIds,
  MapEventsService,
  OverlayLayer,
  ServiceApiFeature,
} from '@services/map/base/map-events.service';
import { BoundaryMapEventsService } from '@services/map/boundary/boundary-map-events.service';
import {GeolocationCoordinatesInterfaceFix, UserLocationService} from '@services/map/user-location.service';
import { MessageService } from '@services/shared/notifications/message.service';
import { VectorLayerService } from '@services/vector_layer/vector-layers.service';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { Feature } from 'ol';
import { Coordinate } from 'ol/coordinate';
import { FeatureLike } from 'ol/Feature';
import { GeoJSON } from 'ol/format';
import { circular } from 'ol/geom/Polygon';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { StyleLike } from 'ol/style/Style';
import { Subject, take } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { mpProgressLabel } from 'src/app/constants/indicators.constants';
import {
  BoundaryNameAndParent,
  BreadcrumbService,
} from 'src/app/services/breadcrumb.service';
import { IsLoadingService } from 'src/app/services/is-loading.service';
import { BoundaryFocusService } from 'src/app/services/map/DashboardBoundaryService';
import { BoundaryLayerService } from 'src/app/services/vector_layer/boundary-layer.service';
import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  GeoJsonBoundary,
  Polygon as PolygonGMT,
  Position,
} from 'src/app/utils/server-interfaces/GeoJson';
import { BOUNDARY_LAYER } from 'src/app/utils/server-interfaces/VectorLayerName';
import {
  BaseMapComponent,
  ClickEvent,
} from 'src/app/_shared/map/panel/base-map.component';
import {
  activeLocationStyle,
  badAccuracyStyle,
  goodAccuracyStyle,
  notActiveLocationStyle,
} from 'src/app/_shared/map/styles/gnss-styles';
import {
  BoundaryLevel,
  BOUNDARY_LEVEL_MAP_DATA,
  getBoundaryOverviewSelectedStyle,
  getBoundaryStyle,
  highlightedBoundaryStyle,
  intermediateSelectionBoundaryStyle,
} from 'src/app/_shared/map/styles/map-dashboard-styles';

@Component({
  selector: 'boundary-map',
  templateUrl: './boundary-map.component.html',
  styleUrls: ['./boundary-map.component.less'],
  standalone: false
})
export class BoundaryMapComponent extends BaseMapComponent implements OnInit {
  public selectedIndicator: string = mpProgressLabel;
  private boundaryLevelData: Array<Array<GeoJsonBoundary>> = [];
  private layerIdPrefix = 'boundary-level-';
  private boundaryLevelMapData: Array<BoundaryLevel> = BOUNDARY_LEVEL_MAP_DATA;

  private boundarySelected: string | undefined;
  private boundaryParent: string | null;

  // Map zoom behaviour
  private zoomAdjustment = 1.1;

  // GeoJSON reader with reprojecion
  private geojsonReader = new GeoJSON({
    dataProjection: `EPSG:${AppConfigService.map.data_projection}`,
    featureProjection: `EPSG:${AppConfigService.map.map_projection}`,
  });
  private layers: Map<number, VectorLayer> = new Map();
  private selectedLayer: VectorLayer;

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
  private locationLayer: VectorLayer = new VectorLayer({
    source: new VectorSource(),
    visible: true,
  });
  private unsubscribe = new Subject();

  constructor(
    private boundaryLayerService: BoundaryLayerService,
    private boundaryFocusService: BoundaryFocusService,
    private boundaryMapEvents: BoundaryMapEventsService,
    private breadcrumbService: BreadcrumbService,
    private isLoadingService: IsLoadingService,
    private locationService: UserLocationService,
    private mapEvents: MapEventsService,
    private messageService: MessageService,
    logger: NGXLogger,
    private vectorLayerService: VectorLayerService
  ) {
    super(logger);
    this.isLoadingService.setLoading(true);
    this.isLoadingService.setMapLoading(true);
  }

  override async ngOnInit() {
    super.ngOnInit();

    // Update map
    this.setInteractive(true);

    this.vectorLayerService
      .isInitialized()
      .pipe(take(2))
      .subscribe(async (isInitialized) => {
        if (isInitialized) {
          await this.initializeMapLayers();
          this.subscribeToMapMovementChange();
          this.subscribeToLocationChange();
          this.subscribeToHighlight();
        }
      });
  }

  override ngOnDestroy() {
    this.unsubscribe.next(undefined);
    this.unsubscribe.complete();
    this.boundarySelected = undefined;
  }

  public changeIndicator(indicator: string) {
    this.selectedIndicator = indicator;
    this.updateStyle();
  }

  public handleZoomToTableLocation() {
    if (
      !this.locationFeature ||
      this.locationFeature.geo_json.geometry.coordinates[0] == -1 ||
      !this.locationService.isGPSSupported()
    ) {
      this.messageService.add(this.locationService.gpsErrorMessage());
      return;
    }
    this.locationService.queryInstantLocation();
    this.mapEvents.center({
      movementType: 'Center',
      center: this.locationFeature!.geo_json.geometry.coordinates as Position,
    });
  }

  /**
   * Aggregate boundary data per level after we loaded its data from the backend
   * @private
   */
  private async initializeMapLayers() {
    await this.prepareBoundaryData();
    // Add boundaries to the map as individual layers per level
    for (
      let level = 0;
      level <= AppConfigService.conf.generic.operational_boundary_level;
      ++level
    ) {
      this.logger.debug(`Adding boundary layer for level: ${level}`);

      const levelData = this.boundaryLevelMapData[level];
      const features = this.boundaryLevelData[level];
      this.logger.info(`Level data ${level} length ${features.length}`);
      /*
            This is what creates the boundary styles for the non selected
            boundaries.  The selected one is in addSelectedBoundaryLayer

            The boundary style function does send the currently selected boundary
            so that the style can change based on the current selection
            */
      this.layers.set(
        level,
        new VectorLayer({
          source: levelData['visible']
            ? new VectorSource({
                features: this.geojsonReader.readFeatures({
                  type: 'FeatureCollection',
                  features,
                }),
              })
            : new VectorSource(),
          minResolution: levelData.minResolution,
          maxResolution: levelData.maxResolution,
          style: this.boundaryStyleFunction(levelData),
          declutter: true,
        })
      );
      this.layers
        .get(level)!
        .set('id', `${this.layerIdPrefix}${levelData['level']}`);
      this.layers.get(level)!.set('name', levelData['name']);
      this.addOverlayLayers(this.layers.get(level)!);
    }

    // Distinguish the current lowest and highest level
    const lowestLevel = Math.min(...this.boundaryLevelData.keys());

    this.isLoadingService.setMapLoading(false);
    this.isLoadingService.setLoading(false);

    //After map is loaded and data is present before listening for boundary changes
    this.initSubscriptions(lowestLevel);
  }

  private async prepareBoundaryData() {
    const allBoundaryData = await this.boundaryLayerService.getBoundaryData();
    this.logger.info(`boundary map data fetched: ${allBoundaryData.length}`);

    this.boundaryLevelData = [];
    for (let i = 0; i < this.boundaryLevelMapData.length; ++i) {
      this.boundaryLevelData.push([]);
    }

    for (const f of allBoundaryData) {
      const level = f.properties.level;
      if (level >= this.boundaryLevelData.length) {
        this.logger.info('Unexpected level', level);
        continue;
      }
      this.boundaryLevelData[level].push(f);
    }
  }

  /**
   * Creates a StyleFunction for a boundary level
   * @param level
   */
  private boundaryStyleFunction(
    level: BoundaryLevel,
    returnUpdated: boolean = false
  ): StyleLike {
    if (level.style && !returnUpdated) {
      return level.style;
    } else {
      return (feature: FeatureLike, resolution: number) => {
        return getBoundaryStyle(
          feature,
          resolution,
          level.level,
          // this.boundaryFocusService.getFocus().level,
          AppConfigService.conf.generic.operational_boundary_level,
          level.color!,
          level.borderColor!,
          level.thickness!,
          level.text,
          level.textColor,
          this.boundaryFocusService.getFocus().boundaryId,
          this.boundaryFocusService.getFocus().parentBoundaryId,
          this.selectedIndicator
        );
      };
    }
  }

  private initSubscriptions(lowestLevel: number) {
    this.logger.info(`Boundary map init subscriptions ${lowestLevel}`);

    this.subscribeToFocus(lowestLevel);
    this.subscribeToSelectLayer();
    this.makeBoundaryLayersSelectable();
    this.subscribeToDoubleClickOnMap();
  }

  private focusBoundary(focus: BoundaryNameAndParent) {
    this.boundarySelected = focus.boundaryId;
    this.boundaryParent = focus.parentBoundaryId;
    const layerName = this.boundaryLevelMapData[focus.level]['name'];
    const layer = this.getLayerByName(layerName) as VectorLayer;

    if (!layer) {
      this.logger.error(`Unable to find layer [${layerName}]`);
      return;
    }

    this.addSelectedBoundaryLayer(this.boundarySelected, focus.level);
    // Get the map to which we need to focus
    const feature = layer
      .getSource()!
      .getFeatures()
      .find(
        (f) => f.getProperties()['global_id'] === focus.boundaryId
      ) as Feature;
    // && feature.get('level') != AppConfigService.conf.generic.operational_boundary_level
    if (feature) {
      this.zoomToFeatures([feature], undefined, this.zoomAdjustment).then();
    }
  }

  private focusHandler(focus: BoundaryNameAndParent, lowestLevel: number) {
    // Ignore initial focus
    if (focus.level < 0) {
      return;
    }
    // Focus to a specific selected boundary
    if (focus.boundaryId) {
      this.focusBoundary(focus);
    }
  }

  /*
    Lazily creates the open layers layer that draws the selected boundary (the one in the breadcrumb & url)
    */
  private addSelectedBoundaryLayer(boundaryId: string, level: number) {
    if (
      level < 0 ||
      level > AppConfigService.conf.generic.operational_boundary_level
    ) {
      return;
    }
    const features = this.boundaryLevelData[level].filter(
      (b) => b.properties.global_id == boundaryId
    );
    if (!features || features.length == 0) {
      return;
    }
    if (!this.selectedLayer) {
      this.selectedLayer = new VectorLayer({
        source: new VectorSource({
          features: this.geojsonReader.readFeatures({
            type: 'FeatureCollection',
            features,
          }),
        }),
        style: getBoundaryOverviewSelectedStyle('black', 6, level),
      });
      this.selectedLayer.set('id', 'selected-boundary');
      this.selectedLayer.set('name', 'selected-boundary');
      this.addOverlayLayers(this.selectedLayer);
    } else {
      //Need to set the style again because the level could have changed
      this.selectedLayer.setStyle(
        getBoundaryOverviewSelectedStyle('black', 6, level)
      );
      this.selectedLayer.getSource()!.clear();
      this.selectedLayer.getSource()!.addFeatures(
        this.geojsonReader.readFeatures({
          type: 'FeatureCollection',
          features,
        })
      );
      this.selectedLayer.getSource()!.changed();
    }
  }

  private updateStyle() {
    for (let level = 0; level < this.boundaryLevelMapData.length; level++) {
      const newStyle = this.boundaryStyleFunction(
        this.boundaryLevelMapData[level]
      );
      if (!this.layers.get(level)) {
        continue;
      }
      this.layers.get(level)!.setStyle(newStyle);
      if (level == this.boundaryFocusService.getFocus().level) {
        // this.layers.get(level).getSource().refresh();
      }
    }
    // highlighted boundary style uses indicators fill
    this.setSelectionStyle(
      intermediateSelectionBoundaryStyle(this.selectedIndicator)
    );
    this.setHighlightStyle(highlightedBoundaryStyle);
    let selectedFeatureKeys = Object.getOwnPropertyNames(
      this._selectedFeatures
    );
    // make sure style is applied the same moment to the selected feature
    if (selectedFeatureKeys.length > 0) {
      (
        this._selectedFeatures[selectedFeatureKeys[0]].feature as Feature
      ).setStyle(intermediateSelectionBoundaryStyle(this.selectedIndicator));
    }
  }

  private subscribeToLocationChange() {
    this.locationLayer.set('id', LayerIds.LOCATION);
    this.locationLayer.set('name', 'UserLocation');
    this.addOverlayLayers(this.locationLayer, OverlayLayer.GNSS_LOCATION);
    this.locationService
      .getLocation()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((position: GeolocationCoordinatesInterfaceFix | null) => {
        if (_.isNil(this.locationFeature)) {
          return;
        }
        if (position?.longitude) {
          this.locationFeature.geo_json.geometry.coordinates = [
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
          this.locationFeature.style = notActiveLocationStyle;
          this.addOverlayFeatures(
            [this.locationFeature],
            this.locationLayer,
            true
          );
        }
      });
  }

  private subscribeToMapMovementChange() {
    this.mapEvents.getMapMovementObs().subscribe((mapMovementArg) => {
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

  private subscribeToFocus(lowestLevel: number) {
    // Subscribe to the boundary focus service to interact with the hierarchy tree (left panel)
    this.boundaryFocusService.focus
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((focus) => {
        this.focusHandler(focus, lowestLevel);
      });
  }
  private subscribeToSelectLayer() {
    // React on selection changes in the map
    this.selectionChange
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async (selection) => {
        if (Object.values(selection).length == 0) {
          return;
        }
        const boundary = Object.values(selection)[0].feature;
        this.mapEvents.emitClicked({
          coordinates: [] as Coordinate,
          selectedLayer: BOUNDARY_LAYER,
          selectedGlobalId: boundary.get('global_id'),
        });
      });
  }
  private makeBoundaryLayersSelectable() {
    let layerNames: string[] = this.boundaryLevelMapData.map(
      (levelData) => `${this.layerIdPrefix}${levelData.level}`
    );
    layerNames.shift(); // remove country as selectable layer
    this.enableSelection(layerNames);
    this.setSelectionStyle(
      intermediateSelectionBoundaryStyle(this.selectedIndicator)
    );
    this.setHighlightStyle(highlightedBoundaryStyle);
  }

  private subscribeToHighlight() {
    this.boundaryMapEvents
      .boundaryHighlightEventObs()
      .pipe(takeUntil(this.unsubscribe))
      .subscribe((highlightedBoundary: string | null) => {
        this.clearSelection(true);
        if (highlightedBoundary != null) {
          this.highlightBoundary(highlightedBoundary);
        }
      });
  }

  private highlightBoundary(boundaryId: string | null): void {
    if (!boundaryId) {
      return;
    }
    let layerIds: string[] = [];
    for (
      let level = 0;
      level <= AppConfigService.conf.generic.operational_boundary_level;
      ++level
    ) {
      layerIds.push(`${this.layerIdPrefix}${level}`);
    }
    const selectedFeatures = this.findFeaturesById(layerIds, [boundaryId]);
    this.highlightFeatures(
      selectedFeatures,
      (feature, resolution) => {
        return intermediateSelectionBoundaryStyle(this.selectedIndicator)(
          feature,
          resolution
        );
      },
      true
    );
  }

  private subscribeToDoubleClickOnMap() {
    this.mapDoubleclick
      .pipe(takeUntil(this.unsubscribe))
      .subscribe(async (clickEvent: ClickEvent) => {
        const newSelection =
          this.handleMapEventSingleClickGetNewSelection(clickEvent);
        if (
          newSelection &&
          newSelection.length > 0 &&
          newSelection[0].length > 0
        ) {
          await this.breadcrumbService.routeToBoundary(
            -1, // we will not redirect to offline boundary so level is not necessary
            newSelection[0][0].get('global_id'),
            false
          );
        }
      });
  }
}
