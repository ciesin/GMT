import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  //DestroyRef,
  NgZone,
  OnDestroy,
  OnInit,
} from '@angular/core';
//import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute } from '@angular/router';
import { JsonTableComponent } from '@components/catchment-tech-view/json-table/json-table.component';
import {
  BoundaryVectorLayersService,
  fetchAllPopRasters,
} from '@services/boundary-vector-layers.service';
import { VectorSourceService } from '@services/map/vector-source.service';
import { RasterDataService } from '@services/raster-data.service';
import { UserContextService } from '@services/user-context.service';
import { buildRasterStatsFromTiff } from '@services/vector_layer/RasterDatabase';
import _, { isNil } from 'lodash';
import { NGXLogger } from 'ngx-logger';
import {
  Feature,
  MapBrowserEvent,
  Feature as OLFeature,
  Map as OLMap,
  View,
} from 'ol';
import {
  defaults as controlDefaults,
  MousePosition,
  ScaleLine,
} from 'ol/control';
import { Coordinate, createStringXY } from 'ol/coordinate';
import { EventsKey } from 'ol/events';
import { FeatureLike } from 'ol/Feature';
import { GeoJSON } from 'ol/format';
import { Geometry, Polygon as OLPolygon } from 'ol/geom';
import Point from 'ol/geom/Point';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import { unByKey } from 'ol/Observable';
import {
  //Projection,
  get as getProjection,
  toLonLat,
  transform,
  transformExtent,
} from 'ol/proj';
import Projection from 'ol/proj/Projection';
import { OSM } from 'ol/source';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style, Text } from 'ol/style';
import CircleStyle from 'ol/style/Circle';
import { firstValueFrom } from 'rxjs';
import { boundariesScoped } from 'src/app/_shared/map/styles/map-boundary-styles';
import { mapStyles } from 'src/app/_shared/map/styles/map-design';
import { healthFacilitiesIconScoped } from 'src/app/_shared/map/styles/map-hf-styles';
import { settlementsStyleFunction } from 'src/app/_shared/map/styles/map-settlement-styles';
import {
  GeoJsonBoundary,
  GeoJsonCatchmentProperties,
  Extent as GeojsonExtent,
  GeoJsonHealthFacility,
  GeoJsonSettlementName,
  GeoJsonSettlementPartProperties,
} from 'src/app/utils/server-interfaces/GeoJson';
import {
  bufferExtentAdditive,
  geometryIntersects,
  METERS_TO_PAD,
} from 'src/app/utils/server-interfaces/utils/geom.util';
import {
  ST_GEOMETRY_LAYER,
  VectorLayerName,
} from 'src/app/utils/server-interfaces/VectorLayerName';
import { v4 as uuidv4 } from 'uuid';

interface SelectLayerChoice {
  label: string;
  value: VectorLayerName;
}

interface HfCatchmentItem {
  spGuid: string;
  ciGuid: string;
  snName: string;
  ciType: GeoJsonCatchmentProperties['type'];
  ciPerc: number;
  spComputedPop: number;
  snEstimatedPop: number;
}

interface SpCatchmentItem {
  hfGuid: string;
  ciGuid: string;
  hfName: string;
  isOutreach: boolean;
  ciType: GeoJsonCatchmentProperties['type'];
  ciPerc: number;
}

interface Settlement {
  spGuid: string;
  //snGuid: string;
  label: string;
}

const LS_SELECTED_LAYER = 'catchment-tech-selected-layer';
const LS_MAP_EXTENT = 'catchment-tech-map-extent';

@Component({
  selector: 'able-catchment-tech-view',
  templateUrl: './catchment-tech-view.component.html',
  styleUrls: ['./catchment-tech-view.component.less'],
  standalone: true,
  imports: [
    MatSelectModule,
    MatFormFieldModule,
    ReactiveFormsModule,
    CommonModule,
    JsonTableComponent,
    FormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatchmentTechViewComponent implements OnInit, OnDestroy {
  public map_html_id = 'map';
  public map_lat_lon_html_id = 'map_lat_lon_html_id';
  public map_scalebar_html_id = 'map_scalebar_html_id';

  private map: OLMap | null = null;

  public boundaryGuid!: string;
  private spGuid: string | null = null;
  public hf: GeoJsonHealthFacility | null = null;
  public spProps: GeoJsonSettlementPartProperties | null = null;
  public sn: GeoJsonSettlementName | null = null;

  private highlightedFeature: OLFeature | null = null;

  private boundaryLayer!: VectorLayer;
  private hfLayer!: VectorLayer;
  private spLayer!: VectorLayer;
  private snLayer!: VectorLayer;

  private spRasterLayer!: VectorLayer;
  private hfRasterLayer!: VectorLayer;

  private olKeys: Array<EventsKey> = [];

  public fcSelectLayer = new FormControl<VectorLayerName>(ST_GEOMETRY_LAYER);
  public selLayers: Array<SelectLayerChoice> = [
    {
      label: 'Settlement Parts',
      value: ST_GEOMETRY_LAYER,
    },
    {
      label: 'Health Facilities (FP + Outreach)',
      value: 'health_facility__point',
    },
  ];

  public selectSpParent = false;

  public hfCatchmentItems: Array<HfCatchmentItem> = [];
  public spCatchmentItems: Array<SpCatchmentItem> = [];

  public settlementList: Array<Settlement> = [];

  public message = 'No message';

  public hfCatchmentItemsColList = [
    'snName',
    'ciType',
    'spComputedPop',
    'snEstimatedPop',
    'ciPerc',
  ];
  public spCatchmentItemsColList = ['hfName', 'isOutreach', 'ciType', 'ciPerc'];

  constructor(
    private ngZone: NgZone,
    private logger: NGXLogger,
    private route: ActivatedRoute,
    private bvService: BoundaryVectorLayersService,
    private vectorSourceService: VectorSourceService,
    private userContextService: UserContextService,
    //private destroyRef: DestroyRef,
    private rasterDataService: RasterDataService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    this.boundaryGuid = this.route.snapshot.paramMap.get('boundary')!;

    this.selLayerSaveLoad();

    this.logger.debug(`Loading boundary [${this.boundaryGuid}]`);

    await firstValueFrom(
      this.bvService.ensureBoundaryLoaded(this.boundaryGuid)
    );
    this.logger.debug(`Finished loading boundary [${this.boundaryGuid}]`);
    this.callSetCurrentBoundary();

    await this.loadMap();

    this.loadSettlementList();
  }

  private async loadMap() {
    await this.ngZone.runOutsideAngular(async () => {
      await this.buildMap();
    });

    //this.listenToUserState();
  }

  private async buildMap(): Promise<void> {
    const success = this.setOpenLayersMap();

    if (!success) {
      this.logger.warn(
        `Map could not be built, likely because user navigated away`
      );
      return;
    }

    if (_.isNil(this.map)) {
      this.logger.warn(
        `Map could not be built, likely because user navigated away`
      );
      return;
    }

    const boundary = this.bvService.data.bMap.get(this.boundaryGuid)!;

    this.mapExtentSaveLoad(boundary);

    this.boundaryLayer = new VectorLayer({
      style: boundariesScoped(boundary.properties.global_id),
    });
    this.hfLayer = new VectorLayer({
      style: healthFacilitiesIconScoped(boundary.properties.global_id, []),
    });
    this.snLayer = new VectorLayer({
      style: settlementsStyleFunction(
        //boundary.properties.global_id,
        false,
        false,
        false,
        false
      ),
    });
    this.spLayer = new VectorLayer({
      style: mapStyles.STL.polygon,
    });
    this.spRasterLayer = new VectorLayer({
      style: gridStyleFunction(),
    });
    this.hfRasterLayer = new VectorLayer({
      style: gridStyleFunction(),
    });
    const osmLayer = new TileLayer({
      source: new OSM(),
    });

    /*this.map.setLayers([
      osmLayer,
      this.boundaryLayer,
      this.spLayer,
      this.spRasterLayer,
      this.hfRasterLayer,
      this.hfLayer,
      this.snLayer,
    ]);*/
    for (const lyr of [
      osmLayer,
      this.boundaryLayer,
      this.spLayer,
      this.spRasterLayer,
      this.hfRasterLayer,
      this.hfLayer,
      this.snLayer,
    ]) {
      this.map.addLayer(lyr);
    }

    this.map.on('singleclick', (evt) =>
      this.handleMapClick(evt as MapBrowserEvent<PointerEvent>)
    );

    this.listenVectorSourceService();
  }

  private listenVectorSourceService() {
    this.vectorSourceService
      .get_observable('boundary__polygon')
      //.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((source) => {
        /*
        this.logger.debug(
          `Boundary source received [${source.getFeatures().length}]`
        );*/
        this.boundaryLayer.setSource(source);
      });

    this.vectorSourceService
      .get_observable('health_facility__point')
      //.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((source) => {
        /*
        this.logger.debug(
          `Hf source received [${source.getFeatures().length}]`
        );*/
        this.hfLayer.setSource(source);
      });

    this.vectorSourceService
      .get_observable('settlement__name')
      //.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((source) => {
        /*
        this.logger.debug(
          `Sn source received [${source.getFeatures().length}]`
        );*/
        this.snLayer.setSource(source);
      });

    this.vectorSourceService
      .get_observable('settlement__part')
      // .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((source) => {
        /*
        this.logger.debug(
          `sp source received [${source.getFeatures().length}]`
        );*/
        this.spLayer.setSource(source);
      });
  }

  public onSelectSettlement(event: Event) {
    const selectedSpGuid = (event.target as HTMLSelectElement).value;
    this.logger.info(`Selected ${selectedSpGuid}`);
    //s: Settlement;
    //this.logger.info(`Selected ${s.label}`);
    const spSource = this.spLayer.getSource()!;

    const fList = spSource
      .getFeatures()
      .filter((f) => f.get('global_id') == selectedSpGuid);
    this.logger.info(`Found ${fList.length}`);
    if (fList.length == 0) {
      return;
    }
    if (fList.length > 1) {
      this.message = 'More than 1 feature found with attributed global id!';
    }
    this.highlightFeature(fList[0], false);

    this.loadSpCatchItems(selectedSpGuid);
  }

  private loadSettlementList() {
    this.settlementList = this.bvService.data.spList
      .filter((sp) => sp.properties.boundary_polygon == this.boundaryGuid)
      .map((sp) => {
        const snList = this.bvService.data.getPrimaryNamesForSettlementPart(
          sp.properties.global_id,
          false
        );
        let label = '';
        if (snList.length == 1) {
          label = `${sp.properties.global_id} - ${snList[0].properties.name}`;
        } else if (snList.length <= 0) {
          label = `${sp.properties.global_id} - No primary name !`;
        } else {
          label =
            `${sp.properties.global_id} - ` +
            snList.map((s) => s.properties.name).join(', ');
        }
        const s: Settlement = {
          spGuid: sp.properties.global_id,
          label,
        };
        return s;
      });

    this.settlementList.sort((a, b) => {
      return a.label.localeCompare(b.label);
    });

    this.logger.debug(`Set list length ${this.settlementList.length}`);
    this.cdr.detectChanges();
  }

  private setOpenLayersMap(): boolean {
    const projection = new Projection({
      code: 'EPSG:3857',
      units: 'm',
    });

    const mouseControls = this.buildMousePositionControls();

    //Double check we have the id, angular needs to have updated the template 1st
    const mapElement = document.getElementById(this.map_html_id);

    if (!mapElement) {
      //Seen this locally and on dev or test; map was not open
      this.logger.warn(
        `MapComponent: for ${this.map_html_id} mapElement is null`
      );
      return false;
    }

    this.map = new OLMap({
      target: this.map_html_id,
      controls: [...controlDefaults().getArray(), ...mouseControls],
      //controls: [...defaults().getArray()],
      view: new View({
        projection,
      }),
    });

    this.addScaleLine();
    return true;
  }

  private buildMousePositionControls(): Array<MousePosition> {
    const mousePositionControl4326 = new MousePosition({
      coordinateFormat: createStringXY(4),
      projection: getProjection('EPSG:4326')!,
      className: 'custom-mouse-position',
      target: document.getElementById(this.map_lat_lon_html_id)!,
      //undefinedHTML: '&nbsp;',
    });

    return [mousePositionControl4326];
  }

  private addScaleLine() {
    if (_.isNil(this.map)) {
      this.logger.error('Map is null');
      return;
    }

    const scalebar: ScaleLine = new ScaleLine({
      units: 'metric',
      target: this.map_scalebar_html_id,
    });

    this.map.addControl(scalebar);
  }

  private callSetCurrentBoundary() {
    const boundaryInfo = this.bvService.boundaryInfo;

    const boundingBox = this.bvService.boundaryInfo.boundary.properties.bbox;
    const boundingBox3857 = transformExtent(
      boundingBox,
      'EPSG:4326',
      'EPSG:3857'
    ) as GeojsonExtent;
    const expandingBoundingBox3857 = bufferExtentAdditive(
      boundingBox3857,
      METERS_TO_PAD
    );
    const surroundingBoundingBox = transformExtent(
      expandingBoundingBox3857,
      'EPSG:3857',
      'EPSG:4326'
    ) as GeojsonExtent;

    // Make sure the current boundary is set properly
    this.userContextService.setCurrentBoundary({
      boundaryId: boundaryInfo.boundary.properties.global_id,
      level: boundaryInfo.boundary.properties.level as number,
      surroundingBoundaryIds: boundaryInfo.surroundingBoundaryIds,
      boundingBox,
      surroundingBoundingBox,
    });
  }

  private handleMapClick(evt: MapBrowserEvent<PointerEvent>) {
    if (!this.map) {
      return;
    }

    // Get the currently selected layer name
    const selectedLayerName = this.fcSelectLayer.value;

    // Get the clicked coordinate in EPSG:3857
    const [x, y] = evt.coordinate;
    this.logger.debug(`Clicked at EPSG:3857 coords: x=${x}, y=${y}`);

    let clickedFeature: OLFeature | null = null;

    let isPoint = false;
    // Map the selected layer name to the actual VectorLayer instance
    if (selectedLayerName === 'health_facility__point') {
      clickedFeature = getPointFeature(this.hfLayer, evt);
      if (clickedFeature) {
        this.logger.debug('clicked hf', clickedFeature.getProperties());
        const hfGuid = clickedFeature.get('global_id');
        this.logger.debug(`hf guid [${hfGuid}]`);
        this.loadHfCatchItems(hfGuid);
        this.drawHfRaster(hfGuid, true);
      }
      isPoint = true;
    }

    //fall back to sp
    if (selectedLayerName === ST_GEOMETRY_LAYER || isNil(clickedFeature)) {
      if (this.selectSpParent) {
        clickedFeature = this.selectSpParentFeature(x, y);
      } else {
        const features = getSettlementFeatures(this.map, this.spLayer, evt);
        if (features.length > 0) {
          clickedFeature = features[0];
        }
        if (features.length > 1) {
          this.message =
            '>1 rest: ' +
            features
              .slice(1)
              .map((f) => f.get('global_id'))
              .join(', ');
        }
      }
      if (clickedFeature) {
        this.logger.debug('Clicked sp', clickedFeature.getProperties());
        const spGuid = clickedFeature.get('global_id');
        this.spGuid = spGuid;
        this.logger.debug(`Sp guid [${spGuid}]`);
        this.loadSpCatchItems(spGuid);
        this.drawSpRaster(spGuid, true);
      }
      isPoint = false;
    } else {
      return;
    }

    // Find the feature at the clicked pixel in the selected layer

    // Highlight the clicked feature
    if (isNil(clickedFeature)) {
      return;
    }

    this.highlightFeature(clickedFeature, isPoint);
  }

  private highlightFeature(clickedFeature: OLFeature, isPoint: boolean) {
    // Remove highlight from previous feature
    if (this.highlightedFeature) {
      this.highlightedFeature.setStyle(undefined);
      this.highlightedFeature = null;
    }
    if (isPoint) {
      clickedFeature.setStyle(
        new Style({
          image: new CircleStyle({
            radius: 10,
            fill: new Fill({ color: 'rgba(255,0,0,0.7)' }),
            stroke: new Stroke({ color: '#fff', width: 3 }),
          }),
        })
      );
    } else {
      clickedFeature.setStyle(
        new Style({
          stroke: new Stroke({
            color: '#ff0000',
            width: 4,
          }),
          fill: new Fill({
            color: 'rgba(255,0,0,0.1)',
          }),
        })
      );
    }
    this.highlightedFeature = clickedFeature;
  }

  private selectSpParentFeature(x: number, y: number): OLFeature | null {
    const xyLatLon = toLonLat([x, y]);
    //we don't draw parents so we need to get this by hand
    const matches = this.bvService.data.spList.filter((sp) => {
      if (sp.properties.split_type != 'auto_split_parent') {
        return false;
      }
      return geometryIntersects(
        {
          type: 'Point',
          coordinates: xyLatLon,
        },
        sp
      );
    });
    this.logger.debug(
      `auto split parent matches for coords ${x}, ${y} ; ${xyLatLon} = ${matches
        .map((m) => m.properties.global_id)
        .join(', ')}`
    );
    if (matches.length > 1) {
      this.logger.warn(
        `Too many auto split parent matches for coords ${x}, ${y} ; ${xyLatLon} = ${matches
          .map((m) => m.properties.global_id)
          .join(', ')}`
      );
    }

    if (matches.length <= 0) {
      return null;
    }
    const geojsonFormat = new GeoJSON();

    const parentFeature = geojsonFormat.readFeature(matches[0], {
      featureProjection: 'EPSG:3857', // projection for display
      dataProjection: 'EPSG:4326', // projection of input GeoJSON
    }) as Feature<Geometry>;
    this.spLayer.getSource()!.addFeature(parentFeature);
    return parentFeature;
  }

  public async handleCalculateSpCatchment() {
    if (isNil(this.spGuid)) {
      this.logger.info('sp nil');
      return;
    }

    this.userContextService.isAutoCatchmentMode$.next(true);

    const pActionId = uuidv4();
    const sp = this.bvService.data.spMap.get(this.spGuid);
    if (isNil(sp)) {
      this.logger.warn('sp null');
      return;
    }
    const start = performance.now();
    await this.bvService.computeAllCatchmentAssignments(
      [sp],
      pActionId,
      new Set()
    );
    const end = performance.now();
    const elapsedSeconds = (end - start) / 1000;
    this.logger.info(`Elapsed time: ${elapsedSeconds.toFixed(3)} seconds`);
  }

  private selLayerSaveLoad() {
    // Restore selected layer from localStorage
    const savedLayer = localStorage.getItem(LS_SELECTED_LAYER);
    if (savedLayer && this.selLayers.some((l) => l.value === savedLayer)) {
      this.fcSelectLayer.setValue(savedLayer as VectorLayerName);
    }

    // Listen for layer selection changes and save to localStorage
    this.fcSelectLayer.valueChanges
      //.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => {
        if (val) {
          localStorage.setItem(LS_SELECTED_LAYER, val);
        }
      });
  }

  private mapExtentSaveLoad(boundary: GeoJsonBoundary) {
    if (isNil(this.map)) {
      return;
    }
    const savedExtent = localStorage.getItem(LS_MAP_EXTENT);
    if (savedExtent) {
      try {
        const extent = JSON.parse(savedExtent);
        this.map.getView().fit(extent);
      } catch (e) {
        this.logger.warn('Failed to parse saved map extent', e);
      }
    } else {
      const boundaryExtent4326 = boundary.properties.bbox;
      const boundaryExtent3857 = transformExtent(
        boundaryExtent4326,
        `EPSG:4326`,
        `EPSG:3857`
      );
      this.logger.info(
        `Using extent from params ${boundaryExtent4326} ${boundaryExtent3857}`
      );
      this.map.getView().fit(boundaryExtent3857);
    }

    // Save map extent on moveend
    this.olKeys.push(
      this.map.on('moveend', () => {
        const extent = this.map!.getView().calculateExtent();
        localStorage.setItem(LS_MAP_EXTENT, JSON.stringify(extent));
      })
    );
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.setTarget(null as unknown as HTMLElement);
    }
    for (const k of this.olKeys) {
      unByKey(k);
    }
  }

  private async drawSpRaster(spGuid: string, clearExisting: boolean) {
    const sp = this.bvService.data.spMap.get(spGuid);

    if (isNil(sp)) {
      this.logger.warn(`sp not found [${spGuid}]`);
      return;
    }

    const boundaryRasters = await fetchAllPopRasters(
      [sp],
      this.rasterDataService,
      this.bvService.data
    );

    if (boundaryRasters.size != 1) {
      this.logger.warn(
        `Expected 1 boundary raster, not ${boundaryRasters.size}`
      );
    }
    const boundaryRaster = boundaryRasters.values().next().value;

    const origin_x = sp.properties.origin_x;
    const origin_y = sp.properties.origin_y;
    const width = sp.properties.raster_width;
    const height = sp.properties.raster_height;

    //01 strings for rasterized settlement part
    const rasterSP = sp.properties.raster;
    const rasterIsFixedPost = sp.properties.is_fixed_post;
    const rasterIsOutreach = sp.properties.is_outreach;

    /*this.logger.debug(
      `Raster strings: ${rasterSP} Fixed Post: ${rasterIsFixedPost} Outreach: ${rasterIsOutreach}`
    );*/

    const popRasterStats = buildRasterStatsFromTiff(boundaryRaster);

    let vectorSource = this.spRasterLayer.getSource();

    if (isNil(vectorSource)) {
      vectorSource = new VectorSource();
      this.spRasterLayer.setSource(vectorSource);
    }

    if (clearExisting) {
      vectorSource.clear();
      this.hfRasterLayer.getSource()?.clear();
    }

    const features: Array<OLFeature> = [];

    for (let x = 0; x < width; ++x) {
      for (let y = 0; y < height; ++y) {
        const x4326 = origin_x + x * popRasterStats.xPixelWidth;
        const y4326 = origin_y + y * popRasterStats.yPixelHeight;

        //Create an ol feature for this square
        // Calculate the corners of the square
        const square4326 = [
          [x4326, y4326],
          [x4326 + popRasterStats.xPixelWidth, y4326],
          [
            x4326 + popRasterStats.xPixelWidth,
            y4326 + popRasterStats.yPixelHeight,
          ],
          [x4326, y4326 + popRasterStats.yPixelHeight],
          [x4326, y4326], // close the polygon
        ];

        const square3857: Array<Coordinate> = [];

        for (const xy of square4326) {
          square3857.push(transform(xy, 'EPSG:4326', 'EPSG:3857'));
        }

        const rasterStrIndex = y * width + x;

        const sp01 = rasterSP.charAt(rasterStrIndex);
        const fp01 = rasterIsFixedPost.charAt(rasterStrIndex);
        const out01 = rasterIsOutreach.charAt(rasterStrIndex);

        let label = sp01;

        if (fp01 == '1' && out01 == '1') {
          label = sp01 + '_FO';
        } else if (fp01 == '1') {
          label = sp01 + '_F';
        } else if (out01 == '1') {
          label = sp01 + '_O';
        }

        if (label == '0') {
          label = '';
        }

        // Create the feature
        const feature = new OLFeature({
          geometry: new OLPolygon([square3857]),
          xIndex: x,
          yIndex: y,
          label,
          isSP: true,
          isOutreach: out01 == '1',
          isFixedPost: fp01 == '1',
        });

        features.push(feature);
      }
    }

    //this.logger.debug(`Adding sp square features [${features.length}]`);

    vectorSource.addFeatures(features);
  }

  private async drawHfRaster(hfGuid: string, clearExisting: boolean) {
    const hf = this.bvService.data.hfMap.get(hfGuid);

    if (isNil(hf)) {
      this.logger.warn(`sp not found [${hfGuid}]`);
      return;
    }

    const boundaryRasters = await fetchAllPopRasters(
      [hf],
      this.rasterDataService,
      this.bvService.data
    );

    if (boundaryRasters.size != 1) {
      this.logger.warn(
        `Expected 1 boundary raster, not ${boundaryRasters.size}`
      );
    }
    const boundaryRaster = boundaryRasters.values().next().value;

    const origin_x = hf.properties.origin_x;
    const origin_y = hf.properties.origin_y;
    const width = hf.properties.raster_width;
    const height = hf.properties.raster_height;

    //01 strings for rasterized settlement part
    const rasterHF = hf.properties.catchment_raster;

    this.logger.debug(`Raster strings: ${rasterHF}`);

    const popRasterStats = buildRasterStatsFromTiff(boundaryRaster);

    let vectorSource = this.hfRasterLayer.getSource();

    if (isNil(vectorSource)) {
      vectorSource = new VectorSource();
      this.hfRasterLayer.setSource(vectorSource);
    }

    if (clearExisting) {
      vectorSource.clear();
      this.spRasterLayer.getSource()?.clear();
    }

    const features: Array<OLFeature> = [];

    for (let x = 0; x < width; ++x) {
      for (let y = 0; y < height; ++y) {
        const x4326 = origin_x + x * popRasterStats.xPixelWidth;
        const y4326 = origin_y + y * popRasterStats.yPixelHeight;

        //Create an ol feature for this square
        // Calculate the corners of the square
        const square4326 = [
          [x4326, y4326],
          [x4326 + popRasterStats.xPixelWidth, y4326],
          [
            x4326 + popRasterStats.xPixelWidth,
            y4326 + popRasterStats.yPixelHeight,
          ],
          [x4326, y4326 + popRasterStats.yPixelHeight],
          [x4326, y4326], // close the polygon
        ];

        const square3857: Array<Coordinate> = [];

        for (const xy of square4326) {
          square3857.push(transform(xy, 'EPSG:4326', 'EPSG:3857'));
        }

        const rasterStrIndex = y * width + x;

        const hf01 = rasterHF.charAt(rasterStrIndex);

        let label = hf01;

        if (label == '0') {
          label = '';
        }

        // Create the feature
        const feature = new OLFeature({
          geometry: new OLPolygon([square3857]),
          xIndex: x,
          yIndex: y,
          label,
          isOutreach: hf.properties.type == 'outreach',
          isCatchment: hf01 == '1',
        });

        features.push(feature);
      }
    }

    this.logger.debug(`Adding sp square features [${features.length}]`);

    vectorSource.addFeatures(features);
  }

  private loadHfCatchItems(hfGuid: string) {
    this.hf = this.bvService.data.hfMap.get(hfGuid) || null;

    if (isNil(this.hf)) {
      this.logger.warn(`Could not find hf for [${hfGuid}]`);
    } else {
      this.logger.debug(`Loaded hf for [${hfGuid}]`);
    }

    const catchItems = this.bvService.data.getCatchmentForHf(
      hfGuid,
      false,
      false
    );
    const validCatchItems = this.bvService.data.getCatchmentForHf(
      hfGuid,
      true,
      false
    );
    this.logger.debug(
      `Catchment items: [${catchItems.length}] Valid: [${validCatchItems.length}]`
    );
    this.hfCatchmentItems = [];
    this.spCatchmentItems = [];
    this.sn = null;
    this.spProps = null;

    for (const ci of validCatchItems) {
      const sp = this.bvService.data.spMap.get(ci.properties.settlement_part);
      if (isNil(sp)) {
        continue;
      }
      const sn = this.bvService.data.getPrimaryNamesForSettlementPart(
        sp.properties.global_id
      )[0];

      if (isNil(sn)) {
        continue;
      }

      this.hfCatchmentItems.push({
        snName: sn.properties.name,
        snEstimatedPop: sn.properties.estimated_pop || -1,
        spGuid: ci.properties.settlement_part,
        ciType: ci.properties.type,
        ciGuid: ci.properties.global_id,
        ciPerc: ci.properties.population_perc,
        spComputedPop: sp.properties.computed_pop || -1,
      });
    }

    this.cdr.detectChanges();
  }

  private loadSpCatchItems(spGuid: string) {
    const sp = this.bvService.data.spMap.get(spGuid) || null;

    if (isNil(sp)) {
      this.logger.warn(`Could not find hf for [${spGuid}]`);
      return;
    }

    this.spProps = sp.properties;

    this.sn = this.bvService.data.getPrimaryNamesForSettlementPart(
      sp.properties.global_id,
      false
    )[0];

    const catchItems = this.bvService.data.getCatchmentForSp(
      spGuid,
      false,
      false
    );
    const validCatchItems = this.bvService.data.getCatchmentForSp(
      spGuid,
      true,
      false
    );
    this.logger.debug(
      `Catchment items: [${catchItems.length}] Valid: [${validCatchItems.length}]`
    );
    this.spCatchmentItems = [];
    this.hfCatchmentItems = [];
    this.hf = null;

    for (const ci of validCatchItems) {
      const sp = this.bvService.data.spMap.get(ci.properties.settlement_part);
      if (isNil(sp)) {
        continue;
      }
      const sn = this.bvService.data.getPrimaryNamesForSettlementPart(
        sp.properties.global_id
      )[0];

      if (isNil(sn)) {
        continue;
      }

      const hf = this.bvService.data.hfMap.get(
        ci.properties.health_facility_point
      );

      if (isNil(hf)) {
        continue;
      }

      this.spCatchmentItems.push({
        hfName: hf.properties.name,
        isOutreach: hf.properties.type == 'outreach',

        hfGuid: hf.properties.global_id,
        ciType: ci.properties.type,
        ciGuid: ci.properties.global_id,
        ciPerc: ci.properties.population_perc,
      });
    }

    this.cdr.detectChanges();
  }
}

function getPointFeature(
  layer: VectorLayer,
  evt: MapBrowserEvent<PointerEvent>
): null | OLFeature {
  // For point layers, manually search for the closest feature
  const source = layer.getSource();
  if (isNil(source)) {
    return null;
  }
  const [x, y] = evt.coordinate;
  let clickedFeature: null | OLFeature = null;
  let minDist = Infinity;

  const tolerance = 100; // meters
  const extent: [number, number, number, number] = [
    x - tolerance,
    y - tolerance,
    x + tolerance,
    y + tolerance,
  ];

  source.forEachFeatureInExtent(extent, (feature) => {
    const geom = feature.getGeometry();
    if (geom && geom.getType() === 'Point' && geom instanceof Point) {
      const coords = geom.getCoordinates();

      const dx = coords[0] - x;
      const dy = coords[1] - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist && dist < 100) {
        // 100 meters threshold, adjust as needed
        minDist = dist;
        clickedFeature = feature;
      }
    }
  });

  return clickedFeature;
}

function getSettlementFeatures(
  map: OLMap,
  spLayer: VectorLayer,
  evt: MapBrowserEvent<PointerEvent>
): Array<OLFeature> {
  const setFeatures = map.getFeaturesAtPixel(evt.pixel, {
    hitTolerance: 10,
    layerFilter: (lyrCand) => {
      if (lyrCand == spLayer) {
        return true;
      } else {
        return false;
      }
    },
  });

  return setFeatures as Array<OLFeature>;
}

function gridStyleFunction(): (feature: FeatureLike) => Style {
  return (feature: FeatureLike) => {
    const style = new Style({
      stroke: new Stroke({
        color: '#1976d2', // blue grid lines
        width: 2,
        lineDash: [4, 4], // dashed grid
      }),
      fill: new Fill({
        color: 'rgba(25, 118, 210, 0.05)', // very light blue fill
      }),
      text: new Text({
        text: feature.get('label'),
      }),
    });

    if (feature.get('isSP')) {
      if (feature.get('isOutreach')) {
        style.setFill(
          new Fill({
            color: 'rgba(0, 255, 0, 0.25',
          })
        );
      }
      if (feature.get('isFixedPost')) {
        style.setFill(
          new Fill({
            color: 'rgba(0, 0, 255, 0.25',
          })
        );
      }
    } else {
      //hf

      if (feature.get('isCatchment')) {
        const isOutreach = feature.get('isOutreach');
        if (isOutreach) {
          style.setFill(
            new Fill({
              color: 'rgba(0, 255, 0, 0.25',
            })
          );
        } else {
          style.setFill(
            new Fill({
              color: 'rgba(0, 0, 255, 0.25',
            })
          );
        }
      }
    }
    return style;
  };
}
