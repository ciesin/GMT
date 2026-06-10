import { Injectable } from '@angular/core';
import {
  GeoJsonBase,
  GeoJsonBoundary,
  GeoJsonHealthFacility,
  GeoJsonSettlementPart,
  MultiPolygon,
  Point,
  Position,
} from 'src/app/utils/server-interfaces/GeoJson';
import { hfBufferStyle } from 'src/app/_shared/map/styles/map-catchment-styles';
import {
  colorWithAlpha,
  polygonStyle,
  vPolygonStyle,
} from 'src/app/_shared/map/styles/service-api-styles';
import { v4 as uuidv4 } from 'uuid';
import { VectorLayerService } from '../vector_layer/vector-layers.service';
// import { OverlayLayer } from "./MicroplanMapEventsService";
import { BBox2d } from '@turf/helpers/dist/js/lib/geojson';
import {
  bbox,
  buffer,
  difference,
  distance,
  Feature as TurfFeature,
  MultiPolygon as TurfMultiPolygon,
  Point as TurfPoint,
  Polygon as TurfPolygon,
  union,
} from '@turf/turf';
import { containsXY, intersects } from 'ol/extent';
import {
  createConcaveHull,
  createVPolygonsClippedToBoundary,
  roundPosition,
} from 'src/app/utils/coords';
import {
  bbox_padded,
  geometryIntersects,
  isEmpty,
} from '../../utils/server-interfaces/utils/geom.util';
import { BoundaryDataClass } from '../geo/BoundaryDataClass';

import { Units } from '@turf/helpers';
import { NGXLogger } from 'ngx-logger';
import { Style } from 'ol/style';
import { Observable } from 'rxjs';
import { fetchAllPopRasters } from 'src/app/services/boundary-vector-layers.service';
import {
  isHfFixedPostForGeoJson,
  snIsProblematicForGeoJson,
  snIsUninhabitedForGeoJson,
} from 'src/app/utils/data/data-filter.util';
import {
  RasterSquareParams,
  rasterSquareStyleFunction,
} from 'src/app/_shared/map/styles/map-raster-squares';
import { getHexColorFromCSS } from 'src/app/_shared/map/styles/map-styles';
import { WeightConfig } from '../../../environments/WeightConfig';
import { RI_SERVICE } from '../../constants/hf.constants';
import { AppConfigService } from '../../utils/app-config.service';
import { fromSpOrHf, RasterStats } from '../geo/RasterStats';
import { computePopSquareValue } from '../geo/ZonalStats';
import { CancelableState } from '../interfaces/cancelable-state.interface';
import { IsLoadingService } from '../is-loading.service';
import { RasterDataService } from '../raster-data.service';
import {
  buildRasterStatsFromTiff,
  OriginResolutionData,
} from '../vector_layer/RasterDatabase';
import { MapFeaturePublisher, OverlayLayer } from './base/map-events.service';

const LOCAL_STORAGE_PREFIX = 'baseline_';

export const GUIDES_COLOR = '#de036b';

@Injectable({
  providedIn: 'root',
})
export class BaselineService {
  private distanceSliderValues: [number, number] = [0, 0];

  constructor(
    private vectorLayerService: VectorLayerService,
    private rasterDataService: RasterDataService,
    private isLoadingService: IsLoadingService,
    private logger: NGXLogger
  ) {
    this.distanceSliderValues = [
      0,
      AppConfigService.conf.catchment.min_fixed_post_buffer_m,
    ];
  }

  public setDistanceValues(sliderValues: [number, number]) {
    this.distanceSliderValues = sliderValues;
  }

  removeLocalStorageKeys() {
    const lsKeys = Object.keys(localStorage);

    for (const key of lsKeys) {
      if (key.startsWith(LOCAL_STORAGE_PREFIX)) {
        console.log(`Removing local storage key for baseline of ${key}`);
        localStorage.removeItem(key);
      }
    }
  }

  //Given a list of health facilities, return a mapping to a color and an index
  //This will be stable
  static colorWheel = [
    '#24a0ff',
    '#8cce0c',
    '#352b2b',
    '#ff6baa',
    '#9d00c2',
    '#008b03',
    '#f0894b',
    '#ca9cc4',
    '#ffe119',
    '#6edab5',
    '#787ad4',
    '#c8943b',
    '#cad5a0',
    '#4363d8',
    '#904229',
    '#52648b',
    '#cb927b',
    '#434928',
    '#703846',
    '#5d8977',
    // '#3cb44b', '#ffe119', '#4363d8','#911eb4',
    // '#46f0f0', '#f032e6', '#f58231', '#800000',
    // '#bcf60c', '#fabebe', '#008080', '#e6beff',
    // '#9a6324', '#fffac8', '#aaffc7', '#a6cee3',
    // '#808000', '#ffd8b1', '#000075', '#808080',
  ];

  public visualizeHFBuffers(
    bvService: BoundaryDataClass,
    visualizer: MapFeaturePublisher,
    hfId: string | null = null,
    fillColor: string = GUIDES_COLOR
  ) {
    visualizer.removeAllFeatures(OverlayLayer.HF_BUFFERS);
    const boundaryBuffer = bbox_padded(bvService.getCurrentBoundary().geometry);

    let hfsPerformingRi: Array<GeoJsonHealthFacility> = bvService
      .getHfsPerformingRI(false)
      .filter((h) => {
        if (hfId != null) {
          return h.properties.global_id == hfId;
        }

        return intersects(boundaryBuffer, bbox(h.geometry) as BBox2d);
      });

    if (hfsPerformingRi.length <= 0) {
      return;
    }
    //We want to create 1 unioned shapes, <=2km for HFs that are within 2km of the ward

    let allBufferMeters: TurfFeature | null = null;
    const boundary = bvService.getCurrentBoundary();

    for (const h of hfsPerformingRi) {
      let bufferMeters: null | TurfFeature = null;
      if (this.distanceSliderValues[0] == 0) {
        bufferMeters = buffer(h.geometry, this.distanceSliderValues[1], {
          units: 'meters',
        });
        if (!geometryIntersects(boundary, bufferMeters)) {
          continue;
        }
      } else {
        // get difference between 2 buffers
        let innerBuffer = (bufferMeters = buffer(
          h.geometry,
          this.distanceSliderValues[0],
          { units: 'meters' }
        ));
        let outerBuffer = (bufferMeters = buffer(
          h.geometry,
          this.distanceSliderValues[1],
          { units: 'meters' }
        ));
        let diff = difference(outerBuffer, innerBuffer);
        if (diff) {
          bufferMeters = diff;
        }
      }

      if (!allBufferMeters) {
        allBufferMeters = bufferMeters;
      } else {
        //@ts-ignore (union works with a variety of turf objects)
        allBufferMeters = union(allBufferMeters, bufferMeters)!;
      }
    }
    if (!allBufferMeters) {
      return;
    }

    const color = fillColor ? fillColor : GUIDES_COLOR;
    const fixedPostJson: GeoJsonBase = {
      geometry: allBufferMeters.geometry as MultiPolygon,
      properties: {
        boundary_polygon: bvService.boundaryId,
        global_id: uuidv4(),
        version_id: 1,
      },
      type: 'Feature',
    };
    visualizer.addFeature(
      {
        layer: OverlayLayer.HF_BUFFERS,
        style: polygonStyle(color, 'fixed_post'),
        geo_json: fixedPostJson,
      },
      false
    );

    visualizer.emitOverlayFeatureUpdate();
  }

  public visualizeHFVoronoi(
    bvService: BoundaryDataClass,
    visualizer: MapFeaturePublisher
  ) {
    visualizer.removeAllFeatures(OverlayLayer.HF_VORONOI);

    //This will filter out empty hfs
    let hfsPerformingRi: Array<GeoJsonHealthFacility> =
      bvService.getHfsPerformingRI();

    const polygons = createVPolygonsClippedToBoundary(
      hfsPerformingRi as Array<TurfFeature<TurfPoint>>,
      bvService.getCurrentBoundary(),
      this.logger
    );

    //We need to find the vPolygon for all the health facility points and primary name points
    const hfToVPolygon = new Map<string, TurfPolygon | TurfMultiPolygon>();

    //Loop through each of the V Polygons
    for (const vPolygon of polygons) {
      //For each polygon, we need to know which point it belongs to
      //console.log(`Polygon #${pIndex}`, vPolygon);

      let found = false;
      for (const hf of hfsPerformingRi) {
        if (geometryIntersects(vPolygon, hf)) {
          found = true;

          hfToVPolygon.set(hf.properties.global_id, vPolygon);

          break;
        }
      }

      if (!found) {
        this.logger.error(`HF not found for v polygon`, vPolygon);
      }
    }

    //console.log(`v polys ${hfToVPolygon.size} hf ${hfsPerformingRi.length}`);

    for (const [hfGuid, vPolygon] of hfToVPolygon.entries()) {
      const hf = bvService.hfMap.get(hfGuid)!;
      const color = hf.properties.color!;

      const geo_json: GeoJsonBase = {
        geometry: vPolygon as unknown as MultiPolygon,
        properties: {
          boundary_polygon: bvService.boundaryId,
          global_id: uuidv4(),
          version_id: 1,
        },
        type: 'Feature',
      };

      visualizer.addFeature(
        {
          layer: OverlayLayer.HF_VORONOI,
          style: hfBufferStyle(color),
          geo_json,
        },
        false
      );
    }

    visualizer.emitOverlayFeatureUpdate();
  }

  /**
   * Return an observable just to be able
   * to cancel it if needed
   * @param visualizer
   * @param data
   * @param clearExisting
   */
  public visualizeBoundaryRasterSquares(
    visualizer: MapFeaturePublisher,
    data: BoundaryDataClass,
    clearExisting = true
  ): Observable<boolean> {
    // console.log(`visualizeBoundaryRasterSquares is hf ${isHfCatchment} clear existing ${clearExisting}`, idFilterSet);
    return new Observable<boolean>((observer) => {
      //use an object so the async helper can be notified of a cancellation
      const state = { isSubscribed: true };

      // console.log(`visualizeBoundaryRasterSquares is hf catchment ${isHfCatchment} id set size ${idFilterSet ? idFilterSet.size : "empty"} includePopText ${includePopText}`);

      const asyncWrapper = async () => {
        await this.visualizeCatchmentHelperSettlementParts(
          visualizer,
          data,
          false,
          state,
          null
        );
        // await this.visualizeCatchmentHelperHealthFacilities(visualizer, data, false, state);
        // if (isHfCatchment) {
        //   await this.visualizeCatchmentHelperHealthFacilities(visualizer, data, includePopText, state, idFilterSet!);
        // } else {
        //   await this.visualizeCatchmentHelperSettlementParts(visualizer, data, includePopText, state, idFilterSet);
        // }

        observer.next(true);
        observer.complete();
      };

      asyncWrapper().then();

      return {
        unsubscribe() {
          //console.log(`${LOG_PREFIX} unsubscribe from settlement problems`);
          state.isSubscribed = false;
        },
      };
    });
  }

  /**
   * Return an observable just to be able to cancel it if needed
   * Note it is important that it comes after visualizeCatchmentHelper because it does not check if the raster
   * exists for the settlement part
   * @param visualizer
   * @param data
   * @param idFilterSet for HF, set of health facility guids
   */
  public refreshCatchmentLineVisualization(
    visualizer: MapFeaturePublisher,
    data: BoundaryDataClass,
    idFilterSet: Set<string> | null = null
  ): Observable<boolean> {
    return new Observable<boolean>((observer) => {
      //use an object so the async helper can be notified of a cancellation
      const state = { isSubscribed: true };
      visualizer.removeAllFeatures(OverlayLayer.CATCHMENT);

      const asyncWrapper = async () => {
        await this.visualizeCatchmentLineHelper(
          visualizer,
          data,
          state,
          idFilterSet ? idFilterSet : null
        );

        observer.next(true);
        observer.complete();
      };

      asyncWrapper().then();

      return {
        unsubscribe() {
          //console.log(`${LOG_PREFIX} unsubscribe from settlement problems`);
          state.isSubscribed = false;
        },
      };
    });
  }

  /**
   * Visualizes raster squares for the given health facilities.
   *
   * This means we are only drawing the raster squares which are covered
   * by the hf ids passed in the hfFilterSet
   *
   * This is only used when drawing single catchments, otherwise we'd be rendering
   * all settlement parts in a given boundary with visualizeCatchmentHelperSettlementParts
   */
  private async visualizeCatchmentHelperHealthFacilities(
    visualizer: MapFeaturePublisher,
    data: BoundaryDataClass,
    includePopText: boolean,
    state: CancelableState
    // hfFilterSet: Set<string>,
  ) {
    this.isLoadingService.setProgressBarInfo(
      'Visualizing catchment...',
      5,
      true
    );

    const hfMap = new Map<string, GeoJsonHealthFacility>();

    for (const hf of data.hfList) {
      if (hf.properties.boundary_polygon != data.boundaryId) {
        continue;
      }
      //Filter if needed
      // if (hfFilterSet != null && !hfFilterSet.has(hf.properties.global_id)) {
      //   continue;
      // }

      hfMap.set(hf.properties.global_id, hf);
    }
    let progressPercentage = 20;
    this.isLoadingService.setProgressBarInfo(
      'Visualizing health facility catchments',
      progressPercentage - 5,
      true
    );

    const hfList = Array.from(hfMap.values());
    const progressStep = (90 - progressPercentage) / hfList.length;

    let lastUpdate = Date.now();
    this.isLoadingService.setProgressBarInfo(null, progressPercentage, true);

    for (const [hfIdx, hf] of hfList.entries()) {
      if (!state.isSubscribed) {
        break;
      }

      const boundariesForHf = bboxFilter(
        hf.geometry,
        data.bList.filter(
          (b) =>
            b.properties.level ==
            AppConfigService.conf.generic.operational_boundary_level
        )
      );
      const boundaryRasters: Array<OriginResolutionData> = [];
      // const boundaryRasters = await this.rasterDataService.bulkFetchRasters(boundariesForHf.map(b => b.properties.global_id));
      // console.debug(`Performance test (DONE fetching pop rasters ${boundariesForHf.length}): `, window.performance.now());

      for (const boundary of boundariesForHf) {
        if (
          boundary.properties.level !=
          AppConfigService.conf.generic.operational_boundary_level
        ) {
          continue;
        }
        boundaryRasters.push(
          await this.rasterDataService.fetchPopRasterIfNeeded(boundary)
        );
      }

      visualizeCachedHealthFacility(
        hf,
        visualizer,
        includePopText,
        boundariesForHf,
        boundaryRasters
      );

      progressPercentage += progressStep;
      if (hfIdx % 10 == 0) {
        this.isLoadingService.setProgressBarInfo(
          `Visualizing catchment (finished ${hfIdx + 1} of ${
            hfList.length
          })...`,
          progressPercentage,
          true
        );
      }
      //To let the user see the partially rendered settlement coverage, we emit updates
      //every X seconds
      let updateCheck = Date.now();

      if (updateCheck - lastUpdate > 4000) {
        lastUpdate = updateCheck;
        visualizer.emitOverlayFeatureUpdate();
      }
    }
    console.debug(
      'Performance test (Done with visualizeCatchmentHelperHealthFacilities): ',
      window.performance.now()
    );
    if (state.isSubscribed) {
      visualizer.emitOverlayFeatureUpdate();
    }
    this.isLoadingService.setProgressBarInfo(null, progressPercentage, false);
    return {
      unsubscribe() {
        //console.log(`${LOG_PREFIX} unsubscribe from settlement problems`);
        state.isSubscribed = false;
      },
    };
  }

  /**
   * Draws the raster squares for the given settlement parts, or all of them in the current boundary
   */
  private async visualizeCatchmentHelperSettlementParts(
    visualizer: MapFeaturePublisher,
    data: BoundaryDataClass,
    includePopText: boolean,
    state: CancelableState,
    spFilter: Set<string> | null = null
  ) {
    this.isLoadingService.setProgressBarInfo(
      'Visualizing catchment...',
      5,
      true
    );

    const spMap = new Map<string, GeoJsonSettlementPart>();

    //Include all settlement parts that are in the boundaries catchment, this can include settlement parts
    //outside the boundary

    //If spFilter is defined, we still won't draw a settlement part this is either connected to a hf in this
    //boundary or in this boundary

    for (const ci of data.getCatchmentForTheBoundary(true, true)) {
      if (spFilter != null && !spFilter.has(ci.properties.settlement_part)) {
        continue;
      }
      spMap.set(
        ci.properties.settlement_part,
        data.spMap.get(ci.properties.settlement_part)!
      );
    }

    //Also include non covered settlement parts in this boundary
    for (const sp of data.spList) {
      if (sp.properties.boundary_polygon != data.boundaryId) {
        continue;
      }

      if (spFilter != null && !spFilter.has(sp.properties.global_id)) {
        continue;
      }

      spMap.set(sp.properties.global_id, sp);
    }

    let progressPercentage = 20;
    this.isLoadingService.setProgressBarInfo(
      'Calculating population statistics',
      progressPercentage - 5,
      true
    );

    const spList = Array.from(spMap.values());
    const progressStep = (90 - progressPercentage) / spList.length;

    let lastUpdate = Date.now();
    this.isLoadingService.setProgressBarInfo(null, progressPercentage, true);

    const boundaryRasters = await fetchAllPopRasters(
      spList,
      this.rasterDataService,
      data
    );

    for (const [spIdx, sp] of spList.entries()) {
      //   if (sp.properties.global_id == '44308914-ba2a-4cb9-83cc-74ba72513550') {
      //     debugger;
      //   }

      if (!state.isSubscribed) {
        break;
      }

      //console.log(`visualizeSpCatchment ${settlementPart.properties.settlement_name}`);

      //Check if we already have the visualization cached

      //console.log(`Using cached for ${settlementPart.properties.global_id}`);
      const popRaster = boundaryRasters.get(sp.properties.boundary_polygon)!;
      const boundary = data.bMap.get(sp.properties.boundary_polygon)!;
      if (!boundary) {
        throw new Error(
          `Could not find boundary ${sp.properties.boundary_polygon}`
        );
        return;
      }
      const popMean =
        (boundary.properties.computed_pop || 0) /
        (boundary.properties.num_pop_squares || 1);

      if (sp.properties.split_type == 'auto_split_parent') {
        this.logger.debug(
          `Settlement part id ${sp.properties.global_id} is an auto split parent, not drawing`
        );
        continue;
      }

      const names = data.getPrimaryNamesForSettlementPart(
        sp.properties.global_id,
        false
      );

      if (names.length == 0) {
        this.logger.warn(
          `Settlement part id ${sp.properties.global_id} has no settlement names`
        );
      }

      const isProblematic = snIsProblematicForGeoJson(names);
      const isUninhabited = snIsUninhabitedForGeoJson(names);
      // console.log(popMean,'popMean');
      //   if (sp.properties.global_id == '44308914-ba2a-4cb9-83cc-74ba72513550') {
      //     debugger;
      //   }
      visualizeCachedSettlementPart(
        sp,
        visualizer,
        includePopText,
        popRaster,
        popMean,
        isProblematic,
        isUninhabited
      );

      progressPercentage += progressStep;
      if (spIdx % 10 == 0) {
        this.isLoadingService.setProgressBarInfo(
          `Visualizing catchment (finished ${spIdx + 1} of ${
            spList.length
          })...`,
          progressPercentage,
          true
        );
      }
      //To let the user see the partially rendered settlement coverage, we emit updates
      //every X seconds
      let updateCheck = Date.now();

      if (updateCheck - lastUpdate > 4000) {
        lastUpdate = updateCheck;
        visualizer.emitOverlayFeatureUpdate();
      }
    }
    if (state.isSubscribed) {
      visualizer.emitOverlayFeatureUpdate();
    }
    this.isLoadingService.setProgressBarInfo(null, progressPercentage, false);
    return {
      unsubscribe() {
        //console.log(`${LOG_PREFIX} unsubscribe from settlement problems`);
        state.isSubscribed = false;
      },
    };
  }

  /**
   * Create catchment line around each hf
   */
  public async visualizeCatchmentLineHelper(
    visualizer: MapFeaturePublisher,
    data: BoundaryDataClass,
    state: CancelableState,
    hfFilter: Set<string> | null = null
  ) {
    //use an object so the async helper can be notified of a cancellation
    this.isLoadingService.setProgressBarInfo(
      'Visualizing catchment line...',
      5,
      true
    );
    // form hf -> settlement parts mapping
    let hfSet = hfFilter;

    if (hfSet == null || hfSet.size == 0) {
      //find all HFs in this boundary (or related ones) OR specified ones (for show single catchment functionality)
      const hfList = data
        .getHfsPerformingRI()
        .map((hf) => hf.properties.global_id);
      hfSet = new Set<string>(hfList);
    }

    this.logger.info(`Drawing catchment lines/polygons for ${hfSet.size} hfs`);

    // visualize catchments
    for (const hfId of hfSet) {
      //this.logger.info(`Drawing catchment lines/polygon for ${hfId}`);
      if (!state.isSubscribed) {
        this.logger.info(`No longer subscribed, break`);
        break;
      }
      const hf = data.hfMap.get(hfId)!;
      /*if (hf.properties.global_id == 'e7a7f6e6-14a8-4332-ac73-739436334823') {
        //debugger;
        this.logger.info(
          `EEE raster height @ draw time: ${hf.properties.raster_height}`
        );
      }*/
      await visualizeHfCatchment(visualizer, hf);
    }
    this.isLoadingService.setProgressBarInfo(null, 100, false);
    if (state.isSubscribed) {
      visualizer.emitOverlayFeatureUpdate();
    }
  }
}

export interface NearestReturnItem {
  index: number;
  //more is higher weight
  weight: number;
}

export interface NearestReturn {
  hits: Array<NearestReturnItem>;
  totalWeight: number;
}

export function computeNearestHf(
  list: Array<GeoJsonHealthFacility>,
  point: Position,
  settlementPart: GeoJsonSettlementPart,
  weightConfig: WeightConfig,
  containsIncluded: boolean,
  debug: boolean = false
): NearestReturn {
  console.assert(list.length > 0);

  //If we have any explicitly included hf, then we weight them equally
  if (containsIncluded) {
    return {
      hits: list.map((_, index) => {
        return { index, weight: 1.0 };
      }),
      totalWeight: list.length,
    };
  }

  const distOptions: { units: Units } = { units: 'meters' };

  let totalWeight = 0;
  let numInBoundaryHf = 0;
  const hits: Array<NearestReturnItem> = [];

  for (const [itemIndex, item] of list.entries()) {
    const distanceMeters = distance(item.geometry, point, distOptions);

    if (distanceMeters > weightConfig.maxDistance) {
      continue;
    }

    const weight = weightConfig.calculateWeight(
      item,
      distanceMeters,
      settlementPart,
      debug
    );

    if (
      settlementPart.properties.boundary_polygon ==
      item.properties.boundary_polygon
    ) {
      numInBoundaryHf += 1;
    }
    totalWeight += weight;
    hits.push({
      index: itemIndex,
      weight,
    });
  }

  //most weight is earlier in the list
  hits.sort((lhs, rhs) => {
    return rhs.weight > lhs.weight ? 1 : lhs.weight > rhs.weight ? -1 : 0;
  });

  //Check smallest weight, prune if too low.  The %s of the rest are recalculated on the fly
  for (let hitIndex = hits.length - 1; hitIndex >= 0; --hitIndex) {
    const hit = hits[hitIndex];
    const perc = hit.weight / totalWeight;

    if (perc >= weightConfig.getMinSquarePerc()) {
      break;
    }

    //Don't prune the last in boundary health facility
    if (
      list[hit.index].properties.boundary_polygon ==
      settlementPart.properties.boundary_polygon
    ) {
      numInBoundaryHf -= 1;
      if (numInBoundaryHf <= 0) {
        break;
      }
    }

    console.assert(hitIndex == hits.length - 1);

    totalWeight -= hit.weight;
    hits.pop();
  }

  //console.log(`Square at [${point[0]}, ${point[1]}]`);

  return {
    hits,
    totalWeight,
  };
}

export interface HfListForSpReturn {
  hfList: Array<GeoJsonHealthFacility>;
  containsIncluded: boolean;
}
/**
 * Gets candidate list for given sp
 */
export function getHfListForSp(
  settlementPart: GeoJsonSettlementPart,
  data: BoundaryDataClass,
  customCatchmentHealthFacilityIds: Set<string>
): HfListForSpReturn {
  const includeList = data
    .getCatchmentForSp(settlementPart.properties.global_id, true, false)
    .filter((ci) => ci.properties.type == 'include')
    .map((ci) => ci.properties.health_facility_point)
    .map((gid) => data.hfMap.get(gid)!);

  let includeListFiltered = includeList.filter((hf) => {
    if (!hf.properties.services.includes(RI_SERVICE)) {
      return false;
    }

    return !isEmpty(hf);
  });

  if (includeListFiltered.length > 0) {
    return {
      hfList: includeListFiltered,
      containsIncluded: true,
    };
  }

  const excludeList = data
    .getCatchmentForSp(settlementPart.properties.global_id, true, false)
    .filter((ci) => ci.properties.type == 'exclude')
    .map((ci) => ci.properties.health_facility_point);

  const hfList = data.hfList.filter((hf) => {
    if (!hf.properties.services.includes(RI_SERVICE)) {
      return false;
    }

    if (customCatchmentHealthFacilityIds.has(hf.properties.global_id)) {
      return false;
    }

    if (excludeList.includes(hf.properties.global_id)) {
      return false;
    }

    return !isEmpty(hf);
  });

  return {
    hfList,
    containsIncluded: false,
  };
}

/**
 * Returns anything that intersects a padded extent of the given geometry
 * @param geometry
 * @param spList
 */
export function bboxFilter<T extends GeoJsonSettlementPart | GeoJsonBoundary>(
  geometry: Point | MultiPolygon,
  spList: Array<T>
): Array<T> {
  const bufferedBGeom = bbox_padded(geometry);

  return spList.filter((sp) =>
    intersects(bufferedBGeom, bbox(sp.geometry) as BBox2d)
  );
}

function visualizeCachedSettlementPart(
  settlementPart: GeoJsonSettlementPart,
  visualizer: MapFeaturePublisher,
  includePopText: boolean,
  popRaster: OriginResolutionData,
  popMean: number,
  isProblematic: boolean,
  isUninhabited: boolean
) {
  //don't visualize this as it would be incorrectly painted as problematic
  if (settlementPart.properties.split_type == 'auto_split_parent') {
    return;
  }

  const popRasterStats = buildRasterStatsFromTiff(popRaster);
  const subRasterStats = fromSpOrHf(settlementPart);

  let numberSquares =
    settlementPart.properties.raster_height *
    settlementPart.properties.raster_width;

  const offset = roundPosition(popRasterStats.toIndex(subRasterStats.origin));
  for (let idx = 0; idx < numberSquares; ++idx) {
    if (settlementPart.properties.raster.charAt(idx) != '1') {
      continue;
    }

    const [rasterX, rasterY] = subRasterStats.to2dIndex(idx);
    const popValue = computePopSquareValue(
      rasterX,
      rasterY,
      subRasterStats,
      popRasterStats,
      offset,
      popRaster
    );

    const isFixedPost =
      settlementPart.properties.is_fixed_post.charAt(idx) == '1';
    const isOutreach = settlementPart.properties.is_outreach.charAt(idx) == '1';
    const params = {
      popValue,
      includePopText,
      isFixedPost,
      isOutreach,
      isProblematic,
      isUninhabited,
      popMean,
    } as RasterSquareParams;
    visualizeSquareNoCalc(visualizer, subRasterStats, idx, params);
  }
}

function visualizeCachedHealthFacility(
  healthFacility: GeoJsonHealthFacility,
  visualizer: MapFeaturePublisher,
  includePopText: boolean,
  boundaries: Array<GeoJsonBoundary>,
  popRasters: Array<OriginResolutionData>
) {
  const popRasterStats = popRasters.map((popRaster) =>
    buildRasterStatsFromTiff(popRaster)
  );

  const subRasterStats = fromSpOrHf(healthFacility);

  let numberSquares =
    healthFacility.properties.raster_height *
    healthFacility.properties.raster_width;

  const isFixedPost = isHfFixedPostForGeoJson(healthFacility);
  const isOutreach = !isFixedPost;

  for (let idx = 0; idx < numberSquares; ++idx) {
    if (healthFacility.properties.catchment_raster.charAt(idx) != '1') {
      continue;
    }

    const [rasterX, rasterY] = subRasterStats.to2dIndex(idx);
    const xy4326 = subRasterStats.calcTopLeftCoords([rasterX, rasterY]);
    //We need to figure out which boundary we are in
    for (const [bIdx, boundary] of boundaries.entries()) {
      if (!containsXY(boundary.properties.bbox, xy4326[0], xy4326[1])) {
        continue;
      }
      const offset = roundPosition(
        popRasterStats[bIdx].toIndex(subRasterStats.origin)
      );
      const popValue = computePopSquareValue(
        rasterX,
        rasterY,
        subRasterStats,
        popRasterStats[bIdx],
        offset,
        popRasters[bIdx]
      );

      const popMean =
        (boundary.properties.computed_pop || 0) /
        (boundary.properties.num_pop_squares || 1);
      // TODO ask eric about problematic property
      const params = {
        popValue,
        includePopText,
        isFixedPost,
        isOutreach,
        isProblematic: false,
        isUninhabited: false,
        popMean,
      } as RasterSquareParams;
      visualizeSquareNoCalc(visualizer, subRasterStats, idx, params);
      break;
    }
  }
}

/*
  This is to draw the convex hull around the health facility
  Also known as the catchment polygon/line
*/
async function visualizeHfCatchment(
  visualizer: MapFeaturePublisher,
  hf: GeoJsonHealthFacility
) {
  //If this hf is fixed post and doesn't provide ri services, we draw nothing
  if (
    hf.properties.type == 'fixed_post' &&
    !hf.properties.services.includes(RI_SERVICE)
  ) {
    return;
  }

  let squaresForCatchment = new Array<GeoJsonBase>();
  let hfRasterStats = fromSpOrHf(hf);
  let numberSquares = hf.properties.raster_height * hf.properties.raster_width;
  let catchmentStyle: Style;

  for (let idx = 0; idx < numberSquares; ++idx) {
    if (hf.properties.catchment_raster.charAt(idx) != '1') {
      continue;
    }
    let coordinates = hfRasterStats.polyCoords(hfRasterStats.to2dIndex(idx));
    let geoJson: GeoJsonBase = {
      geometry: {
        coordinates: [coordinates],
        type: 'Polygon',
      },
      type: 'Feature',
    } as GeoJsonBase;
    squaresForCatchment.push(geoJson);
  }

  // add hf also to catchment line - without this part the catchment of 1 hamlet would look only as a dot
  if (hf) {
    squaresForCatchment.push(hf);

    // set color based on catchment type
    if (hf.properties.type === 'outreach') {
      catchmentStyle = vPolygonStyle(
        colorWithAlpha(getHexColorFromCSS('--catchment-outreach'), 0.2),
        colorWithAlpha(getHexColorFromCSS('--catchment-outreach'), 0.7)
      );
    } else if (hf.properties.type === 'fixed_post') {
      catchmentStyle = vPolygonStyle(
        colorWithAlpha(getHexColorFromCSS('--catchment-fixed'), 0.1),
        colorWithAlpha(getHexColorFromCSS('--catchment-fixed'), 0.5)
      );
    }
  }
  //console.log(`EEE visualizeHfCatchment ${hf.properties.name} ${hf.properties.type} ${hf.properties.global_id} len ${squaresForCatchment.length}`);
  visualizer.addFeature(
    {
      geo_json: {
        geometry: createConcaveHull(...squaresForCatchment),
        properties: {
          boundary_polygon: '',
          global_id: `hull ${hf.properties.global_id}`,
          version_id: null,
        },
        type: 'Feature',
      },
      style: catchmentStyle!,
      layer: OverlayLayer.CATCHMENT,
    },
    false
  );
}

function visualizeSquareNoCalc(
  visualizer: MapFeaturePublisher,
  subRasterStats: RasterStats,
  idx: number,
  params: RasterSquareParams
) {
  let coordinates = subRasterStats.polyCoords(subRasterStats.to2dIndex(idx));
  let geoJson: GeoJsonBase = {
    geometry: { coordinates: [coordinates], type: 'Polygon' },
    type: 'Feature',
    properties: { value: Math.ceil(params.popValue!), global_id: '' },
  } as unknown as GeoJsonBase;
  //isFixedPost, isOutreach, isProblematic, popMean, popValue, false
  const style = rasterSquareStyleFunction({ ...params, includePopText: false });

  //We still want to show when popValue is small as a smaller square
  // } else if (popValue <= 0) {
  //   style = notCoveredNoPopStyle;
  // }
  let layerName = OverlayLayer.POP_RASTER_VALUES;
  if (params.isUninhabited) {
    layerName = OverlayLayer.POP_RASTER_UNINHABITED;
  } else if (params.isProblematic) {
    layerName = OverlayLayer.POP_RASTER_PROBLEMATIC;
  } else if (params.isFixedPost) {
    layerName = OverlayLayer.POP_RASTER_GENERIC;
  } else if (params.isOutreach) {
    layerName = OverlayLayer.POP_RASTER_GENERIC;
  } else {
    layerName = OverlayLayer.POP_RASTER_GENERIC;
  }
  if (layerName != OverlayLayer.POP_RASTER_UNINHABITED) {
    visualizer.addFeature(
      { geo_json: geoJson, style, layer: layerName },
      false
    );
  }
}
