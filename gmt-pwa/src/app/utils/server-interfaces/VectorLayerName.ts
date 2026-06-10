export const CHURCH_LAYER = "Church";
export const MOSQUE_LAYER = "Mosque";
export const MARKET_LAYER = "Market";
export const SCHOOL_LAYER = "School";
export const OUTREACH = "Outreach";
export const HF_LAYER = "health_facility__point";
// layer only used for styling
export const HF_LAYER_ICON = HF_LAYER + "_icon";
export const ST_NAME_LAYER = "settlement__name";
// layer only used for styling
export const ST_NAME_LAYER_ICON = ST_NAME_LAYER + "_icon";
export const ST_GEOMETRY_LAYER = "settlement__part";
export const GENERIC_LINE_LAYER = "generic__line";
export const BOUNDARY_LAYER = "boundary__polygon";
export const BOUNDARY_EDITED_LAYER = "boundary__polygon_edited";

//https://stackoverflow.com/questions/44480644/string-union-to-string-array
export const ALL_VECTOR_LAYERS = [
  BOUNDARY_LAYER,
  BOUNDARY_EDITED_LAYER,
  //This is commented out because we are only using settlement parts currently
  //"settlement__polygon",
  ST_GEOMETRY_LAYER,
  ST_NAME_LAYER,
  HF_LAYER,
  "generic__point",
  GENERIC_LINE_LAYER,
  "generic__polygon",
  "ri__catchment_item"
] as const;
type AllVectorLayersTuple = typeof ALL_VECTOR_LAYERS; // readonly ['layer name 1', 'layer name 2', ...]

//This means if we index AllStoresTuple with 0,1,2, this returns the identifiers (from as const)
export type VectorLayerName = AllVectorLayersTuple[number];  // union type


export const MAP_POI_LAYERS = [
  CHURCH_LAYER, //These match exactly the generic point type field
  MOSQUE_LAYER,
  MARKET_LAYER,
  SCHOOL_LAYER,
] as const;
export const ALL_MAP_VECTOR_LAYERS = [
    "boundary__polygon",
    BOUNDARY_EDITED_LAYER,
    ST_GEOMETRY_LAYER,
    ST_NAME_LAYER,
    HF_LAYER,
    "generic__line",
    ...MAP_POI_LAYERS
  ] as const;
type AllMapVectorLayersTuple = typeof ALL_MAP_VECTOR_LAYERS; // readonly ['layer name 1', 'layer name 2', ...]
export const VISUALIZATION_MAP_VECTOR_LAYERS = [
    HF_LAYER_ICON,
    ST_NAME_LAYER_ICON
  ] as const;
type VisualizationMapVectorLayersTuple = typeof VISUALIZATION_MAP_VECTOR_LAYERS; // readonly ['layer name 1', 'layer name 2', ...]

//This means if we index AllStoresTuple with 0,1,2, this returns the identifiers (from as const)
export type MapVectorLayerName = AllMapVectorLayersTuple[number];  // union type
export type VisualizationMapVectorLayerName = VisualizationMapVectorLayersTuple[number];  // union type

export const UPDATABLE_VECTOR_LAYERS: Array<VectorLayerName> = [
  ST_GEOMETRY_LAYER,
  ST_NAME_LAYER,
  HF_LAYER,
  "ri__catchment_item",
  BOUNDARY_EDITED_LAYER,
]
export const UPDATABLE_VECTOR_LAYERS_WITHOUT_BOUNDARY: Array<VectorLayerName> = [
  ST_GEOMETRY_LAYER,
  ST_NAME_LAYER,
  HF_LAYER,
  "ri__catchment_item",
]
export const UPDATABLE_VECTOR_LAYERS_SPLIT: Array<[string,string]> = UPDATABLE_VECTOR_LAYERS_WITHOUT_BOUNDARY.map( s => {
  return s.split("__") as [string,string];
});


export enum VectorLayerForPermissions {
  boundary = "boundary.polygon",
  boundary_edited = "boundary.polygon_edited",
  settlement = "settlement.polygon",
  settlementPart = "settlement.part",
  settlementName = "settlement.name",
  healthFacility = "health_facility.point",
  generic = "generic",
  riCatchment = "ri.catchment_item"
}
// const verctorLayerNamesForPermissions: Array<string> = ALL_VECTOR_LAYERS.map(item => item.replace("__", "."));
// export type VectorLayerForPermissions = typeof (ALL_VECTOR_LAYERS.map(item => item.replace("__", ".")));

export const NO_MANS_LAND = "NO_MANS_LAND";
