//Google satellite
export const SATELLITE_MAP = "Satellite Map";
//These are the OSM tiles that work without internet, its cached in the browser indexdb
export const OSM_CACHED = "OpenStreetMap";
export const OSM_ONLINE = "OSM (Online)";
export const NO_BASEMAP = "None";

export const ALL_BASEMAP_NAMES = [
  SATELLITE_MAP, OSM_CACHED, OSM_ONLINE, NO_BASEMAP
] as const;
type AllBaseMapNames = typeof ALL_BASEMAP_NAMES;

export type BaseMapName = AllBaseMapNames[number];  // union type
