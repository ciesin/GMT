// https://stackoverflow.com/questions/8572826/generic-deep-diff-between-two-objects

import { booleanEqual } from '@turf/turf';
import {
  GeoJsonBase,
  PropertyValue,
} from '../../utils/server-interfaces/GeoJson';
import { isEmpty } from '../../utils/server-interfaces/utils/geom.util';

export type DiffArg = {
  [key: string]: PropertyValue;
};

//we can't remove or add fields when changing an item, so this assumes the keys in obj1 and 2 are ==
export function changedProperties(obj1: DiffArg, obj2: DiffArg): Array<string> {
  const changedProps: Array<string> = [];
  for (const key in obj1) {
    const v1 = obj1[key];
    const v2 = obj2[key];

    if (Array.isArray(v1) && Array.isArray(v2)) {
      if (arrayDifferent(v1, v2)) {
        changedProps.push(key);
      }
    } else if (obj1[key] !== obj2[key]) {
      changedProps.push(key);
    }
  }

  return changedProps;
}

export function getChangedFields(g1: GeoJsonBase, g2: GeoJsonBase) {
  const changedFields = changedProperties(g1.properties, g2.properties);

  if (!safeEquals(g1, g2)) {
    changedFields.push('geometry');
  }

  return changedFields;
}

function safeEquals(g1: GeoJsonBase, g2: GeoJsonBase): boolean {
  try {
    const isEmptyG1 = isEmpty(g1);
    const isEmptyG2 = isEmpty(g2);

    if (isEmptyG1 != isEmptyG2) {
      return false;
    }

    if (isEmptyG1 && isEmptyG2) {
      return true;
    }

    //need guards for booleanEqual, both should be non empty
    return booleanEqual(g1.geometry, g2.geometry);
  } catch (e) {
    console.error(`Error ${e} when comparing geometries`);
    return false;
  }
}

function arrayDifferent(
  v1: Array<PropertyValue>,
  v2: Array<PropertyValue>
): boolean {
  if (v1.length != v2.length) {
    return true;
  }

  for (let i = 0; i < v1.length; ++i) {
    if (v1[i] !== v2[i]) {
      return true;
    }
  }

  return false;
}
