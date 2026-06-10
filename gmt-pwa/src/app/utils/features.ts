import {
  Point,
  MultiPoint,
  LineString,
  MultiLineString,
  Polygon,
  MultiPolygon,
} from 'ol/geom';
import {
  Feature as TurfFeature,
  point,
  multiPoint,
  lineString,
  multiPolygon,
  polygon,
  multiLineString,
  Geometries,
} from '@turf/turf';
import Feature, { FeatureLike } from 'ol/Feature';
import { SimpleGeometry } from 'ol/geom';
import { isNil } from 'lodash';

export function convertToTurf(
  feature: Feature | FeatureLike
): TurfFeature | null {
  const feature_coordinates = (
    feature.getGeometry() as SimpleGeometry
  ).getCoordinates();
  if (isNil(feature_coordinates)) {
    return null;
  }
  const geometry_type: string | undefined = feature
    .getGeometry()
    ?.getType()
    .toLowerCase();
  switch (geometry_type) {
    case 'point':
      return point(feature_coordinates);
      break;
    case 'multipoint':
      return multiPoint(feature_coordinates);
      break;
    case 'polygon':
      return polygon(feature_coordinates);
      break;
    case 'multipolygon':
      return multiPolygon(feature_coordinates);
      break;
    case 'linestring':
      return lineString(feature_coordinates);
      break;
    case 'multilinestring':
      return multiLineString(feature_coordinates);
      break;
    default:
      return null;
      break;
  }
}

export function convertToOpenlayers(feature: TurfFeature): FeatureLike | null {
  const feature_coordinates = (feature.geometry as Geometries).coordinates;
  const geometry_type: string | undefined = feature.geometry.type.toLowerCase();
  switch (geometry_type) {
    case 'point':
      return new Feature({
        geometry: new Point(feature_coordinates as number[]),
      });
      break;
    case 'multipoint':
      return new Feature({
        geometry: new MultiPoint(feature_coordinates as number[]),
      });
      break;
    case 'polygon':
      return new Feature({
        geometry: new Polygon(feature_coordinates as number[]),
      });
      break;
    case 'multipolygon':
      return new Feature({
        geometry: new MultiPolygon(feature_coordinates as number[]),
      });
      break;
    case 'linestring':
      return new Feature({
        geometry: new LineString(feature_coordinates as number[]),
      });
      break;
    case 'multilinestring':
      return new Feature({
        geometry: new MultiLineString(feature_coordinates as number[]),
      });
      break;
    default:
      return null;
      break;
  }
}
