import {Feature, Geometry} from "@turf/helpers";
import {Extent, MultiPolygon, Point, Position} from "../GeoJson";

import {bbox, booleanDisjoint} from "@turf/turf";
import {BBox2d} from "@turf/helpers/dist/js/lib/geojson";

// NOTE this file cannot have any imports from the web, so no open layers, nor angular !
// Otherwise there will be dom errors about not finding window/document/etc.
// The reason is service workers have no UI, nor access to UI objects

export function isEmpty(p_g1: Feature<any> | Geometry | null): boolean {

  if (!p_g1) {
    return true;
  }

  let g1: Geometry = ("geometry" in p_g1) ? p_g1.geometry : p_g1;

  if (!g1) {
    return true;
  }

  if (!("coordinates" in g1)) {
    return true;
  }

  if (g1.coordinates.length == 0) {
    return true;
  }

  return g1.coordinates.length == 1 && (g1.coordinates as Position[][])[0].length == 0;


}

//Hf must be within 2 km of a raster square, we add a bit for projection issues
export const METERS_TO_PAD = 2100;

/**
 * Bounding box >2000 meters larger
 * @param geometry
 */
export function bbox_padded(geometry: Point | MultiPolygon, meters=METERS_TO_PAD) : Extent {
  const bGeom = bbox(geometry) as BBox2d;

  return bbox2d_padded(bGeom, meters);
}

export function bbox2d_padded(bGeom: BBox2d, meters=METERS_TO_PAD) : Extent {

  const metersPerDegree = 111139;
  //2000 m using  111,139 per degree
  const bufferValue = meters / metersPerDegree;
  //0.017995483

  return bufferExtentAdditive(bGeom, bufferValue);
}


export function bufferExtentAdditive(
  extent: Extent | [number, number, number, number],
  //Adjustment is number to add, in same units
  adjustment: number
): Extent {

  return [
    extent[0] - adjustment ,
    extent[1] - adjustment,
    extent[2] + adjustment,
    extent[3] + adjustment,
  ] as Extent;

}


/**
 * Check for empty geometries

 */
export function geometryIntersects(g1: Feature<any> | Geometry, g2: Feature<any> | Geometry): boolean {

  if (isEmpty(g1) || isEmpty(g2)) {
    return false;
  }

  return !booleanDisjoint(g1, g2);
}

export function isExtent(ext: Extent) : boolean {
  return Array.isArray(ext) && ext.length == 4
}
