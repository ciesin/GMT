export const DISTANCE_KM = "km";
export const DISTANCE_CAR = "car";
export const DISTANCE_WALK = "walk";

export const POP_ESTIMATED = "estimated";
export const POP_COMPUTED = "computed";
export const POP_PERCENT = "percent";

export type Position = [number, number];
export type Extent = [number, number, number, number];

export const UNKNOWN = "Unknown";

//https://blog.bam.tech/developer-news/should-you-use-enums-or-union-types-in-typescript
//So we avoid enum types (which transpile to code, not just a simple string)
export const UNKNOWN_HEALTH_FACILITY_TYPE = UNKNOWN;
export const FIXED_HEALTH_FACILITY_TYPE = 'fixed_post';
export const OUTREACH_HEALTH_FACILITY_TYPE = 'outreach';
export const MOBILE_HEALTH_FACILITY_TYPE = 'mobile';
export const ALL_HEALTH_FACILITY_TYPES = [
  UNKNOWN_HEALTH_FACILITY_TYPE, FIXED_HEALTH_FACILITY_TYPE, OUTREACH_HEALTH_FACILITY_TYPE, MOBILE_HEALTH_FACILITY_TYPE
] as const;

export const ALL_STRATEGY_ICONS = {
  [UNKNOWN_HEALTH_FACILITY_TYPE]: 'assets/images/unknown-strategy.png',
  [FIXED_HEALTH_FACILITY_TYPE]: 'assets/images/fixed-post-strategy.png',
  [OUTREACH_HEALTH_FACILITY_TYPE]: 'assets/images/outreach-strategy.png',
  [MOBILE_HEALTH_FACILITY_TYPE]: 'assets/images/mobile-strategy.png'
} as const;

const ALL_HEALTH_FACILITY_TYPES_WITH_MC = [
  UNKNOWN_HEALTH_FACILITY_TYPE, FIXED_HEALTH_FACILITY_TYPE, OUTREACH_HEALTH_FACILITY_TYPE, MOBILE_HEALTH_FACILITY_TYPE,
  'multiple_claimed'] as const; //as const is needed to get type checking
type AllHealthFacilityTypesTuple = typeof ALL_HEALTH_FACILITY_TYPES; // readonly ['layer name 1', 'layer name 2', ...]
type AllStrategyPatternsTuple = typeof ALL_HEALTH_FACILITY_TYPES_WITH_MC;

//This means if we index AllStoresTuple with 0,1,2, this returns the identifiers (from as const)
export type HealthFacilityType = AllHealthFacilityTypesTuple[number];  // union type
export type StrategyPatterns = AllStrategyPatternsTuple[number];  // union type


export const ALL_CI_TYPES = [
  'generated', 'include', 'exclude'
] as const;
type AllCiTypesTuple = typeof ALL_CI_TYPES; // readonly ['layer name 1', 'layer name 2', ...]

//This means if we index AllStoresTuple with 0,1,2, this returns the identifiers (from as const)
export type CiType = AllCiTypesTuple[number];  // union type


export const ALL_HEALTH_FACILITY_LEVEL_OF_CARE = [
  UNKNOWN,
  "Primary",
  "Secondary",
  "Tertiary",

  "Other",
  "Dispensary",
] as const;

type AllHealthFacilityLevelOfCare = typeof ALL_HEALTH_FACILITY_LEVEL_OF_CARE; // readonly ['layer name 1', 'layer name 2', ...]

export type HealthFacilityLevelOfCare = AllHealthFacilityLevelOfCare[number];

export const ALL_HEALTH_FACILITY_MATURITY_LEVEL = [
  UNKNOWN,
  //"Mature",
  "Old",
  "New",
] as const;

type AllHealthFacilityMaturityLevel = typeof ALL_HEALTH_FACILITY_MATURITY_LEVEL;

export type HealthFacilityMaturityLevel = AllHealthFacilityMaturityLevel[number];

export const USER_ID_PROPERTY = 'user_id';
export const USER_NAME_PROPERTY = 'user_name';
export const PARTICIPATING_PROPERTY = 'participating';
export const CATCHMENT_STATUS_NOT_STARTED = 'Not Started';
export const CATCHMENT_STATUS_IN_PROGRESS = 'In Progress';
//This is complete, NOT completed; matches an enum in the database
export const CATCHMENT_STATUS_COMPLETE = 'Complete';
export const ALL_HEALTH_FACILITY_CATCHMENT_STATUS = [
  UNKNOWN,
  CATCHMENT_STATUS_NOT_STARTED,
  CATCHMENT_STATUS_IN_PROGRESS,
  CATCHMENT_STATUS_COMPLETE
] as const;


type AllHealthFacilityCatchmentStatus = typeof ALL_HEALTH_FACILITY_CATCHMENT_STATUS;

export type HealthFacilityCatchmentStatus = AllHealthFacilityCatchmentStatus[number];

export const ALL_HEALTH_FACILITY_PRIMARY_TYPE = [
  UNKNOWN,
  'Health Post',
  'Primary Health Clinic',
  'Primary Health Centre'
] as const;


type AllHealthFacilityPrimaryType = typeof ALL_HEALTH_FACILITY_PRIMARY_TYPE;

export type HealthFacilityPrimaryType = AllHealthFacilityPrimaryType[number];

export const ALL_HEALTH_FACILITY_STAFF_POSITION = [
  UNKNOWN,
  'StaffPosition',
  'Medical Doctor',
  'Pharmacist',
  'Laboratory Scientist/Technician',
  'Nurse',
  'Midwife',
  'Nurse & Midwife',
  'Community Health Officer',
  'Senior CHEW',
  'Junior CHEW',
  'Environmental Health Officer',
  'Health Record/Info Management Officer',
  'Health Attendant/Assistant'
] as const;


type AllHealthFacilityStaffPosition = typeof ALL_HEALTH_FACILITY_STAFF_POSITION;

export type HealthFacilityStaffPosition = AllHealthFacilityStaffPosition[number];

export const ALL_HEALTH_FACILITY_STAFF_TYPE = [
  UNKNOWN,
  'Casual',
  'Part-time',
  'Full-time'
] as const;


type AllHealthFacilityStaffType = typeof ALL_HEALTH_FACILITY_STAFF_TYPE;

export type HealthFacilityStaffType = AllHealthFacilityStaffType[number];


export const ALL_HEALTH_FACILITY_MEANS_OF_TRANSPORT = [
  UNKNOWN,
  'Foot',
  'Bicycle',
  'Motorbike',
  'Vehicle',
  'Canoe',
  'Boat'
] as const;


type AllHealthFacilityMeansOfTransport = typeof ALL_HEALTH_FACILITY_MEANS_OF_TRANSPORT;

export type HealthFacilityMeansOfTransport = AllHealthFacilityMeansOfTransport[number];


export const ALL_HEALTH_FACILITY_SERVICES = [
  'Antenatal Care',
  'Postnatal Care',
  'Delivery',
  'Routine Immunization',
  'Family Planning',
  'HIV/AIDS Prevention',
  'Curative Care and OPD',
  'Newborn Care',
  'IMCI',
  'TB/Leprosy services',
  'Malaria control',
  'Growth Monitoring',
  'Eye Care',
  'Mental Care',
  'Oral Care',
  'Health Education',
  'Community Engagement',
  'Sanitation',
  'CMAM',
  'Referral',
  'IYCF'
] as const;

type AllHealthFacilityServices = typeof ALL_HEALTH_FACILITY_SERVICES;

export type HealthFacilityServices = AllHealthFacilityServices[number];


// This is a multiselect, so that's why there is no unknown reason
export const ALL_PROBLEMATIC_OPTIONS = [
  'Unknown',
  'Security Compromised',
  'Slum',
  'Densely Populated',
  'Hard To Reach',
  'Nomadic/Fulani',
  'Scattered',
  'Riverine',
  'Internally Displaced',
  'Non-compliant',
  'Zero-dose',
  'Uptake Issue',
  'Measles Outbreak',
  'cVDPV Outbreak',
  'Polio High-Risk',
  'Other'
] as const;
type AllProblematicOptions = typeof ALL_PROBLEMATIC_OPTIONS; // readonly ['layer name 1', 'layer name 2', ...]


export type ProblematicOption = AllProblematicOptions[number];

export const UNKNOW_UNINHABITED_OPTION = UNKNOWN;
export const OTHER_UNINHABITED_OPTIONS = "Other";
export const ALL_UNINHABITED_OPTIONS = [
  UNKNOW_UNINHABITED_OPTION,
  // OTHER_UNINHABITED_OPTIONS, no need for this option https://github.com/novelt/GMT/issues/1634#issuecomment-1419621414
  "Abandoned",
  "Destroyed",
  'No settlement',
] as const;
type AllUninhabitedOptions = typeof ALL_UNINHABITED_OPTIONS;

export type UninhabitedOption = AllUninhabitedOptions[number];


export const ALL_FREQUENCIES = [
  UNKNOWN,
  "oncePerMonth",
  "twicePerMonth",
  "threePerMonth",
  "oncePerWeek",
  "twicePerWeek",
  "threePerWeek",
  "fourPerWeek",
  "fivePerWeek",
  "sixPerWeek",
  "daily",
  "other",
] as const;
type AllFrequencyOptions = typeof ALL_FREQUENCIES;

export type Frequency = AllFrequencyOptions[number];


export interface LineString {
  type: "LineString";
  coordinates: Position[];
}

export interface MultiLineString {
  type: "MultiLineString";
  coordinates: Position[][];
}

/**
 * Polygon Geometry Object
 *
 * https://tools.ietf.org/html/rfc7946#section-3.1.6
 */
export interface Polygon {
  type: "Polygon";
  coordinates: Position[][];
}

/**
 * MultiPolygon Geometry Object
 *
 * https://tools.ietf.org/html/rfc7946#section-3.1.7
 */
export interface MultiPolygon {
  type: "MultiPolygon";
  coordinates: Position[][][];
}

export interface Point {
  type: "Point";
  coordinates: Position;
}

export type PropertyValue =
  number
  | string
  | boolean
  | null
  | Array<string>
  | undefined
  | Extent
  | Array<AllProblematicOptions>
  | AllProblematicOptions;

export interface GeoJsonBase {
  type: "Feature";
  properties: {
    global_id: string,
    boundary_polygon: string,
    user_id?: string | null,
    user_name?: string | null,
    modified_date?: string,
    created_date?: string,
    version_id: null | number,
    to_delete?: boolean,
    color?: string | null, // only used for visualization
    index?: string | null, // only used for visualization
  },
  geometry: MultiPolygon | MultiLineString | Point | Polygon | LineString
}

export type SettlementType = "bua" | "ha" | "ssa" | "gmt";

export type SplitType = "none" | "merged_by_hand" | "split_by_hand" | "auto_split_parent" | "auto_split_child"

interface GeoJsonSettlementPartProperties {

  global_id: string,
  boundary_polygon: string,
  //GMT is used when a settlement name is created outside of an existing settlement part
  type: SettlementType,
  split_type: SplitType,

  //This is the original settlement name of the originating settlement
  //used to sort settlement parts
  //after updates, should be the single primary name
  settlement_name: string,
  computed_pop: number | null,
  //defined if imported server side, null otherwise
  version_id: null | number,
  //Filled in if the server doesn't have a value
  // [x_min, y_min, x_max, y_max]
  bbox: Extent,
  original_guids: Array<string>,
  split_parent: null | string,

  origin_x: number,
  origin_y: number,
  raster_width: number,
  raster_height: number,
  raster: string,
  //string containing only 0s and 1s
  is_fixed_post: string,
  is_outreach: string

}

export const DefaultGeoJSonSettlementPartProperties: GeoJsonSettlementPartProperties = {
  raster_height: 0,
  raster_width: 0,
  raster: "",
  is_outreach: "",
  is_fixed_post: "",
  origin_x: 0,
  origin_y: 0,
  //"estimated_pop": null,
  "computed_pop": null,
  "version_id": null,
  split_parent: null,
  split_type: "none",
  global_id: "",
  bbox: [0, 0, 0, 0] as [number, number, number, number],
  boundary_polygon: "",
  type: "gmt" as SettlementType,
  original_guids: [],
  settlement_name: ""
}

export interface GeoJsonSettlementPart extends GeoJsonBase {
  type: "Feature";
  geometry: MultiPolygon;

  properties: GeoJsonSettlementPartProperties
}


export const DefaultGeoJSonSettlementNameProperties: GeoJsonSettlementNameProperties = {
  global_id: "",
  boundary_polygon: "",
  name: "",
  version_id: null,
  settlement_part: null,
  estimated_pop: null,
  is_primary: true,
  problematic: [],
  uninhabited_reason: null,
  uninhabited: false,
  synonyms: []
}

interface GeoJsonSettlementNameProperties {
  global_id: string,
  boundary_polygon: string,
  name: string,
  synonyms: Array<string>,
  settlement_part: string | null,
  uninhabited: boolean,
  uninhabited_reason: UninhabitedOption | null,
  problematic: Array<ProblematicOption>,
  is_primary: boolean,

  //Estimated pop is done per name because that's how we expect the user to estimate.  Not
  //via the settlement part.  In cases where a settlement part only has 1 primary name, this
  //is the same, but whene a settlement part has multiple primary names, it's better they
  //estimate the pop for each name.  It wouldn't make sense to use the calculated %.
  //calculated_pop is a property of settlement part because it comes from the zonal stats
  estimated_pop: number | null,
  //defined if imported server side, null otherwise
  version_id: null | number,
}

interface GeoJsonSettlementNameProperties {
  global_id: string,
  boundary_polygon: string,
  name: string,
  synonyms: Array<string>,
  settlement_part: string | null,
  uninhabited: boolean,
  uninhabited_reason: UninhabitedOption | null,
  problematic: Array<ProblematicOption>,
  is_primary: boolean,

  //Estimated pop is done per name because that's how we expect the user to estimate.  Not
  //via the settlement part.  In cases where a settlement part only has 1 primary name, this
  //is the same, but whene a settlement part has multiple primary names, it's better they
  //estimate the pop for each name.  It wouldn't make sense to use the calculated %.
  //calculated_pop is a property of settlement part because it comes from the zonal stats
  estimated_pop: number | null,
  //defined if imported server side, null otherwise
  version_id: null | number,
}

interface GeoJsonBoundaryProperties {
  global_id: string,
  boundary_polygon: string,
  settlement_name: string,
  level: number,
  name: string,
  code: string,
  num_pop_squares: number,
  computed_pop: number | null,
  //defined by the server
  bbox: Extent,
  //defined if imported server side, null otherwise
  version_id: null | number,
  // if true, boundary is participating in GMT micro-planning
  [PARTICIPATING_PROPERTY]?: boolean,

  //[key: string]: PropertyValue};
}

interface GeoJsonBoundaryEditedProperties {
  global_id: string,
  boundary_polygon: string,
  name: string,
  code: string,
  //defined by the server
  bbox: Extent,
  //defined if imported server side, null otherwise
  version_id: null | number,

  drawn_geometry?: MultiPolygon | null,
  resolved?: boolean,
  union?: boolean,
  comment?: null | string,
  is_edit?: boolean, // if true, then this is only temp edit suggestion saved to db and not the real boundary
}

export interface GeoJsonSettlementName extends GeoJsonBase {
  type: "Feature";
  geometry: Point;
  bbox?: Extent;
  properties: GeoJsonSettlementNameProperties
}

export interface GeoJsonBoundary extends GeoJsonBase {
  type: "Feature";
  geometry: MultiPolygon;
  properties: GeoJsonBoundaryProperties
}

export interface GeoJsonBoundaryEdited extends GeoJsonBase {
  type: "Feature";
  geometry: MultiPolygon;
  properties: GeoJsonBoundaryEditedProperties
}

export const defaultGeoJsonBoundaryProperties: GeoJsonBoundaryProperties = {
  global_id: "",
  boundary_polygon: "",
  settlement_name: "",
  level: 0,
  name: "",
  code: "",
  num_pop_squares: 0,
  computed_pop: null,
  bbox: [0, 0, 0, 0] as [number, number, number, number],
  version_id: null
}

interface GeoJsonHealthFacilityProperties {
  global_id: string,
  boundary_polygon: string,
  name: string,
  synonyms: Array<string>,
  services: Array<HealthFacilityServices>,
  //delimited list
  equipment: Array<string>,


  mp_status: HealthFacilityCatchmentStatus,
  level_of_care: HealthFacilityLevelOfCare,
  maturity_level: HealthFacilityMaturityLevel,
  primary_type: HealthFacilityPrimaryType,

  private: boolean | null,

  operating_hours_start: Array<string>,
  operating_hours_stop: Array<string>,

  staff_names: Array<string>,
  staff_positions: Array<HealthFacilityStaffPosition>,
  staff_types: Array<HealthFacilityStaffType>,

  num_employees?: number,
  inaccessible: boolean | null,


  parent: string | null,
  transport: Array<HealthFacilityMeansOfTransport>,
  //Note this is NOT backed by a postgresql enum since it has a high likelihood of changing
  //Once it is stable though, it should be
  frequency: Frequency,
  type: HealthFacilityType,

  origin_x: number,
  origin_y: number,
  raster_width: number,
  raster_height: number,
  catchment_raster: string,

  //Not backed by a column, but used, will be stored in the properties json in the db
  color?: string,
  index?: string,
  created_date?: string,

  //defined if imported server side, null otherwise
  version_id: null | number,
}

export interface GeoJsonHealthFacility extends GeoJsonBase {
  type: "Feature";
  geometry: Point;
  bbox?: Extent;
  properties: GeoJsonHealthFacilityProperties
}


export const DefaultGeoJSonHealthFacilityProperties: GeoJsonHealthFacilityProperties = {
  name: "",
  equipment: [],
  maturity_level: "Unknown",
  frequency: "Unknown",
  synonyms: [],
  mp_status: "Unknown",
  level_of_care: "Unknown",
  operating_hours_start: [],
  operating_hours_stop: [],
  primary_type: "Unknown",
  private: false,
  staff_names: [],
  staff_positions: [],
  staff_types: [],
  transport: [],
  inaccessible: false,
  //color: null,
  parent: null,
  catchment_raster: "",
  origin_x: 0,
  origin_y: 0,
  raster_height: 0,
  raster_width: 0,
  global_id: "",
  services: [],
  type: UNKNOWN,
  boundary_polygon: "",
  version_id: null,
}


export interface GeoJsonCatchmentItem extends GeoJsonBase {
  type: "Feature";
  geometry: Point;
  bbox?: Extent;
  properties: {
    global_id: string,

    //Exclude == true catchment items are owned by the health facility, because
    //the user changing them would checkout the same boundary as that HF
    //BUT the exclude == false, being generated, are generated for all settlement parts
    //so belong to the settlement parts boundary
    boundary_polygon: string,
    health_facility_point: string,

    population_perc: number,

    //uuid of settlement part
    settlement_part: string,
    //defined if imported server side, null otherwise
    version_id: null | number,

    //true if this means do NOT allow this hf <=> sp
    type: CiType
  }
}

export interface FeatureCollection {
  type: "FeatureCollection",
  features: Array<GeoJsonBase>
}

export interface GeoJsonList {
  list: Array<GeoJsonBase>,
  version: number
}

export interface SettlementListItem {
  settlementName: GeoJsonSettlementName,
  settlementPart: GeoJsonSettlementPart,
}
