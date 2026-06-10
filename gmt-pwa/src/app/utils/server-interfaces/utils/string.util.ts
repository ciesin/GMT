import {PropertyValue} from "../GeoJson";


/**
 * @deprecated Use lodash _.isString
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * @deprecated Use lodash _.isFinite
 */
export function isFloat(value: unknown): value is number {
  //https://stackoverflow.com/questions/22489966/why-does-isfinitenull-true/22490055
  return Number.isFinite(value) && !isNaN(parseFloat(value as string));
}

export function getPopulationNumberOrDefault(n: string, defaultNumber: number) {
  //a number will get passed through
  n = n.replace(',', '');
  const parsedNumber = parseFloat(n as string);

  if (!isFloat(parsedNumber)) {
    return defaultNumber;
  } else {
    return parsedNumber;
  }
}

export function getNumberOrDefault(n: PropertyValue, defaultNumber: number) {
  //a number will get passed through
  const parsedNumber = parseFloat(n as string);

  if (!isFloat(parsedNumber)) {
    return defaultNumber;
  } else {
    return parsedNumber;
  }
}

/*
This is used with either pop % or population values
 */
export function isPopFloatDifferent(n1: PropertyValue, n2: PropertyValue) : boolean {
  const rn1 = getNumberOrDefault(n1,-1);
  const rn2 = getNumberOrDefault(n2, -1);

  //For a % or a population, any diff smaller than 0.01 is not significant
  return Math.abs(rn1-rn2) > 0.01;
}

export const GENERATED_PREFIX = "Generated name";

export function isMachineGenerated(name: string): boolean {
  if (!isString(name)) {
    return false;
  }

  return (name.startsWith("HA_") ||
    name.startsWith("SSA_") ||
    name.startsWith("BUA_") ||
    name.startsWith(GENERATED_PREFIX)
  );
}
