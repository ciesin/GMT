import {
  Feature as TurfFeature,
  MultiPolygon as TurfMultiPolygon,
  Point as TurfPoint,
  Polygon as TurfPolygon,
} from '@turf/helpers/dist/js/lib/geojson';
import {
  bbox,
  bboxPolygon,
  buffer,
  distance,
  featureCollection,
  intersect,
  voronoi,
} from '@turf/turf';
import { ColorLike } from 'ol/colorlike';
import { Coordinate } from 'ol/coordinate';
import { Extent } from 'ol/extent';
import { Size } from 'ol/size';
import {
  GeoJsonBase,
  GeoJsonBoundary,
  GeoJsonHealthFacility,
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
  Point,
  Polygon,
  Position,
  StrategyPatterns,
} from './server-interfaces/GeoJson';
import { isEmpty } from './server-interfaces/utils/geom.util';
// import { NGXLogger } from "ngx-logger"; // if uncommented has compile errors

export function roundDown(coords: Position): Position {
  return [Math.floor(coords[0]), Math.floor(coords[1])];
}

export function roundUp(coords: Position): Position {
  return [Math.ceil(coords[0]), Math.ceil(coords[1])];
}

export function roundPosition(coords: Position): Position {
  return [Math.round(coords[0]), Math.round(coords[1])];
}

export function calculateWidthHeight(extent: Extent): Size {
  return [
    //width
    extent[2] - extent[0],
    //height
    extent[3] - extent[1],
  ];
}

export function calculateCenter(extent: Extent): Coordinate {
  return [
    //x
    (extent[2] + extent[0]) / 2,
    //y
    (extent[3] + extent[1]) / 2,
  ];
}

//Returns a %, between 0 and 1, of where numToCheck falls
export function calcPerc(
  dimMin: number,
  dimMax: number,
  numToCheck: number
): number {
  console.assert(dimMax > dimMin);
  const length = dimMax - dimMin;
  const perc = (numToCheck - dimMin) / length;
  if (perc < 0) {
    return 0;
  }
  if (perc > 1) {
    return 1;
  }
  return perc;
}

const equator = 40075016.68557849;

export function getLargestZoomLevel(
  projectedExtent: Extent,
  pixelWidthHeight: Size
): number {
  const extentMetersWidthHeight = calculateWidthHeight(projectedExtent);

  //find first zoom level that is good enough
  let largestZoomLevel = 28;
  let metersWidthHeight = [-1, -1];
  for (; largestZoomLevel >= 0; largestZoomLevel -= 1) {
    metersWidthHeight = calculateMetersWidthHeight(
      pixelWidthHeight,
      largestZoomLevel
    );

    if (
      metersWidthHeight[1] >= extentMetersWidthHeight[1] &&
      metersWidthHeight[0] >= extentMetersWidthHeight[0]
    ) {
      break;
    }
  }

  return largestZoomLevel;
}

/*
Given width and height in pixels, will return
the 3857 width and height in meters for the given zoomlevel
 */
export function calculateMetersWidthHeight(
  pixelSize: Size,
  zoomLevel: number
): Size {
  const meters_per_pixel = equator / 256.0 / Math.pow(2, zoomLevel);

  return [pixelSize[0] * meters_per_pixel, pixelSize[1] * meters_per_pixel];
}

/**
 Returns the bounding box around given features
 @param bufferSizeMeters How much to buffer the bbox
 @param features the features
 */
export function getExtentedBoundingBoxForFeatures(
  bufferSizeMeters: number,
  ...features: Array<GeoJsonBase>
): Extent {
  const fcCollection = featureCollection(features.filter((f) => !isEmpty(f)));

  const bounding_box = bbox(fcCollection);
  const extentPolygon = bboxPolygon(bounding_box);

  const bufferedExtent = buffer(extentPolygon, bufferSizeMeters, {
    units: 'meters',
  });

  return bbox(bufferedExtent) as Extent;
}

export function getCenterOfExtent(extent: Extent): Position {
  return [(extent[2] + extent[0]) / 2, (extent[3] + extent[1]) / 2];
}

export interface HealthFacilityVisualizationInput {
  //each health facility has a colour
  color: ColorLike;
  json: GeoJsonHealthFacility;
  //All the primary names in this health facility catchment
  pnGuids: Set<string>;
}

export interface PrimaryNameVisualizationInput {
  json: GeoJsonSettlementName;
  hfGuids: Set<string>;
}

export interface SettlementPartVisualizationInput {
  // fill should represent association with HF/catchment
  color: ColorLike | null;
  fillPattern: StrategyPatterns | null;
  json: GeoJsonSettlementPart;
  pnGuids: Set<string>;
}

export interface VisualizationInput {
  //keys are guids

  //health facilities in the current boundary
  healthFacilities: Map<string, HealthFacilityVisualizationInput>;

  //Potentially includes PNs in surrounding boundaries when they are in this boundaries HF catchment items
  //Can also point to health facilities in surrounding wards (which would not be in this.healthFacilities)
  primaryNames: Map<string, PrimaryNameVisualizationInput>;
  settlementParts: Map<string, SettlementPartVisualizationInput>;

  //contains only primary names that are connected by an in boundary health facility
  outOfBoundaryHealthFacilities: Map<string, HealthFacilityVisualizationInput>;
}

export function visualizationInputToPointList(
  voronoiInput: VisualizationInput
): Array<TurfFeature<TurfPoint>> {
  //collect all the points, note we may have duplicates, indicating either hf or pn that belong to many catchments
  const allPoints: Array<TurfFeature<TurfPoint>> = [];

  voronoiInput.healthFacilities.forEach((hfInput) => {
    allPoints.push(hfInput.json as TurfFeature<TurfPoint>);
  });
  voronoiInput.primaryNames.forEach((pnInput) => {
    allPoints.push(pnInput.json as TurfFeature<TurfPoint>);
  });

  return allPoints;
}

export function createVPolygonsClippedToBoundary(
  allPoints: Array<TurfFeature<TurfPoint>>,
  boundary: GeoJsonBoundary,
  logger
): Array<TurfPolygon | TurfMultiPolygon> {
  //logger: NGXLogger

  //Create the V polygons for all the input points
  const bbox_boundary = bbox(boundary);
  const vFeatureCollection = voronoi(featureCollection(allPoints), {
    bbox: bbox_boundary,
  });

  //Filter out any empty v polygons
  const features = vFeatureCollection.features;
  const nonEmptyFeatures = features.filter((f) => !isEmpty(f));

  if (features.length != nonEmptyFeatures.length) {
    logger.warn(
      `Not all HFs and Primary names have a unique voronoi polygon ${features.length} vs ${nonEmptyFeatures.length}`,
      features
    );
  }

  return nonEmptyFeatures
    .map((f) => intersect(f, boundary as TurfFeature<TurfMultiPolygon>)!)
    .filter((f) => f) //filter if intersect is empty
    .map((f) => f.geometry);
}

function addPoints(points: Array<Position>, feature: GeoJsonBase) {
  const geo = feature.geometry;

  if (geo.type == 'Point') {
    points.push(geo.coordinates);
  } else if (geo.type == 'Polygon') {
    //add the exterior ring only
    points.push(...geo.coordinates[0]);
  } else if (geo.type == 'MultiPolygon') {
    for (const p of geo.coordinates) {
      //add first ring
      points.push(...p[0]);
    }
  }
}

declare function hull(
  points: Array<Position>,
  concavity: number
): Array<Position>;

export function createConcaveHull(...features: Array<GeoJsonBase>): Polygon {
  const points: Array<Position> = [];
  features.forEach((f) => {
    addPoints(points, f);
  });

  const h = hull(points, 20);

  return {
    coordinates: [h],
    type: 'Polygon',
  };
}

export function safeDistance(
  p1: GeoJsonBase,
  p2: GeoJsonBase,
  defaultDistance: number = -1
): number {
  if (isEmpty(p1) || isEmpty(p2)) {
    return defaultDistance;
  }

  return Math.round(
    distance(
      (p1.geometry as Point).coordinates,
      (p2.geometry as Point).coordinates,
      {
        units: 'meters',
      }
    )
  );
}

export function catchmentDistanceMeters(
  settlementPart: GeoJsonSettlementPart,
  healthFacility: GeoJsonHealthFacility
): number {
  //https://stackoverflow.com/a/18157551/679123
  let bbox = settlementPart.properties.bbox;
  let healthFacilityPoint = healthFacility.geometry.coordinates;

  //Where is the closest point with the settlements bounding box
  var intersectionX =
    bbox[0] +
    Math.max(
      bbox[0] - healthFacilityPoint[0],
      0,
      healthFacilityPoint[0] - bbox[2]
    );
  var intersectionY =
    bbox[1] +
    Math.max(
      bbox[1] - healthFacilityPoint[1],
      0,
      healthFacilityPoint[1] - bbox[3]
    );

  return Math.round(
    distance(healthFacilityPoint, [intersectionX, intersectionY], {
      units: 'meters',
    })
  );
}

export function distanceOrNull(
  p1: GeoJsonBase,
  p2: GeoJsonBase
): number | null {
  if (isEmpty(p1) || isEmpty(p2)) {
    return null;
  }
  if (
    p1.geometry.coordinates.length === 0 ||
    p2.geometry.coordinates.length === 0
  ) {
    return null;
  }

  return Math.round(
    distance(
      (p1.geometry as Point).coordinates,
      (p2.geometry as Point).coordinates,
      {
        units: 'meters',
      }
    )
  );
}
