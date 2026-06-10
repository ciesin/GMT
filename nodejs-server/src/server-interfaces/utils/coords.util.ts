import {bbox, bboxPolygon, buffer, distance, featureCollection, intersect, voronoi} from "@turf/turf";
import {
  GeoJsonBase,
  GeoJsonBoundary,
  Point,
  Polygon,
  Position,
} from "./../GeoJson";
import {
  Feature as TurfFeature,
  MultiPolygon as TurfMultiPolygon,
  Point as TurfPoint,
  Polygon as TurfPolygon
} from "@turf/helpers/dist/js/lib/geojson";
import {isEmpty} from "./../utils/geom.util";
import hull from "hull.js";

// declare function hull(points: Array<Position>, concavity: number): Array<Position>;

export function roundDown(coords: Position): Position {
  return [
    Math.floor(coords[0]),
    Math.floor(coords[1]),
  ];
}

export function roundUp(coords: Position): Position {
  return [
    Math.ceil(coords[0]),
    Math.ceil(coords[1]),
  ];
}

export function roundPosition(coords: Position): Position {
  return [
    Math.round(coords[0]),
    Math.round(coords[1]),
  ];
}

//Returns a %, between 0 and 1, of where numToCheck falls
export function calcPerc(dimMin: number, dimMax: number, numToCheck: number): number {
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


export function createVPolygonsClippedToBoundary(allPoints: Array<TurfFeature<TurfPoint>>, boundary: GeoJsonBoundary): Array<TurfPolygon | TurfMultiPolygon> {


  //Create the V polygons for all the input points
  const bbox_boundary = bbox(boundary);
  const vFeatureCollection = voronoi(featureCollection(allPoints), {bbox: bbox_boundary});

  //Filter out any empty v polygons
  const features = vFeatureCollection.features;
  const nonEmptyFeatures = features.filter(f => !isEmpty(f));

  if (features.length != nonEmptyFeatures.length) {
    console.warn(`Not all HFs and Primary names have a unique voronoi polygon ${features.length} vs ${nonEmptyFeatures.length}`, features);
  }

  return nonEmptyFeatures
    .map(f => intersect(f, boundary as TurfFeature<TurfMultiPolygon>)!)
    .filter(f => f) //filter if intersect is empty
    .map(f => f.geometry);
}

function addPoints(points: Array<Position>, feature: GeoJsonBase) {
  const geo = feature.geometry;
  if (!geo) {
    return;
  }

  if (geo.type == "Point") {
    points.push(geo.coordinates);
  } else if (geo.type == "Polygon") {
    //add the exterior ring only
    points.push(...geo.coordinates[0]);
  } else if (geo.type == "MultiPolygon") {
    for (const p of geo.coordinates) {
      //add first ring
      points.push(...p[0]);
    }
  }
}


export function createConcaveHull(...features: Array<GeoJsonBase>): Polygon {
  const points: Array<Position> = [];
  features.forEach(f => {
    addPoints(points, f);
  });

  const h = hull(points, 20);

  return {
    coordinates: [
      h
    ], type: "Polygon"
  };
}

export function safeDistance(p1: GeoJsonBase, p2: GeoJsonBase,
                             defaultDistance: number = -1): number {
  if (isEmpty(p1) || isEmpty(p2)) {
    return defaultDistance;
  }

  return Math.round(distance((p1.geometry as Point).coordinates,
    (p2.geometry as Point).coordinates, {
      units: "meters"
    }));
}

export function distanceOrNull(p1: GeoJsonBase, p2: GeoJsonBase): number | null {
  if (isEmpty(p1) || isEmpty(p2)) {
    return null;
  }
  if (p1.geometry.coordinates.length === 0
    || p2.geometry.coordinates.length === 0) {
    return null;
  }

  return Math.round(distance((p1.geometry as Point).coordinates,
    (p2.geometry as Point).coordinates, {
      units: "meters"
    }));
}

