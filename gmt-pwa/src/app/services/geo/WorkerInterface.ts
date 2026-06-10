// import { NGXLogger } from "ngx-logger"; // if uncommented has compile errors
import {
  GeoJsonSettlementName,
  GeoJsonSettlementPart,
} from "../../utils/server-interfaces/GeoJson";
import {BoundaryDataClassInterface} from "./BoundaryDataClass";
import {RasterStatsInterface} from "./RasterStats";

interface WorkerMessage
{
    index: number,
    data: any
}

export interface WorkerResponse extends WorkerMessage
{

}

export enum WorkerFunction {
    WAIT,
    LOAD_POP_RASTER,
    RASTERIZE_MULTIPOLYGON,
  TRAVEL_TIME_SINGLE_POINT,

  INIT_SETTLEMENTS_PROBLEMS,
  // GET_SETTLEMENT_PROBLEM,
  GET_SETTLEMENT_PROBLEM_GEOMETRY,
  GET_SETTLEMENT_PROBLEM_POPULATION,
  GET_SETTLEMENT_PROBLEM_NAME_RELATED,
  CLEANUP_SETTLEMENTS_PROBLEMS,
}

export interface WorkerRequest extends WorkerMessage
{
    func: WorkerFunction
}


export interface TravelTimeBetweenPointsArgs {
  boundaryId: string,
  //This is where the distance is calculated from, it will be cached
  fromPointId: string,
  from3857: [number, number],
  to3857: [number, number],
  is_walking: boolean
  logger? //: NGXLogger
}

export interface BaselineOptions {
  boundaryId: string
}

export interface SettlementProblemArgs {
  settlementNames: Array<GeoJsonSettlementName>,
  data: BoundaryDataClassInterface
  problemType: WorkerFunction,
  earlyStop?: boolean, // if true, will stop when first issue is found
  cacheKey: number
}

export interface SettlementProblemSingleArgs {
  cacheKey: number,
  settlementNameId: string,
  settlementPartId: string,
}


//Also includes problems with orphan settlement parts
export enum SettlementNameProblemTypes {
  //The settlement name point does not geospatially intersect its assigned settlement part
  NO_INTERSECT_FK_SETTLEMENT_PART,

  //Settlement name point has no geeometry
  EMPTY_OR_NULL_GEOMETRY,

  //Settlement name  has no settlement_part guid
  NO_SETTLEMENT_PART,

  //settlement part has no name point associated with it or the global_id is not valid
  //Unnamed settlement parts have a fake one generated, just to have the code not have to deal with no name point.
  //This could happen to with data problems if this settlement name gets deleted somehow.
  NO_SETTLEMENT_NAME,

  //guid in settlement_part field is invalid
  INVALID_SETTLEMENT_PART,

  MULTIPLE_PN,  //Settlement name Does not geospatially intersect its boundary
  NAME_OUTSIDE_BOUNDARY,

  //Redundant with name outside boundary and NO_INTERSECT_FK_SETTLEMENT_PART
  //PART_OUTSIDE_BOUNDARY,

  //settlement part boundary id is not the same as the settlement name boundary id
  PART_BOUNDARY_ATTRIBUTE_MISMATCH,

  //Redundant with name outside boundary and NO_INTERSECT_FK_SETTLEMENT_PART

  //Spills over outside the boundary borders
  //PART_PARTIALLY_OUTSIDE_BOUNDARY,


  //Intersects a settlement part in the same boundary, solution is to merge
  OVERLAPS_OTHER_SETTLEMENT,

  MACHINE_GENERATED_NAME,

  //Name is empty or whitespace
  EMPTY_NAME,

  UNCLAIMED,

}


//This can be settlement name or settlement part problems
export interface SettlementProblems {
  messages: Array<string>,
  problems: Array<SettlementNameProblemTypes>,
  // resolutions: { [key in SettlementNameProblemTypes]: [CustomMenuItem] },
  resolutions: { [SettlementNameProblemTypes:string] : Array<{
      tooltip?: string,
      label: string,
      command: () => void
    }> },

  settlementPartId: string,
  settlementNameId: string,

  //What settlement parts intersect this settlement name point
  intersectingPartsWithName: Array<GeoJsonSettlementPart>,
  //FK assigned settlement part
  settlementPart: GeoJsonSettlementPart | null,

  //Parts within same boundary that intersect
  intersectingPartsWithPart: Array<GeoJsonSettlementPart>,

  //Other names that are attributed to the same settlement part
  associatedPrimaryNames: Array<GeoJsonSettlementName>,

  //geospatially intersecting name points with a settlement part
  intersectingNames: Array<GeoJsonSettlementName>,

}
