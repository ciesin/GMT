import Dexie from "dexie";
import {RasterStats} from "../geo/RasterStats";


type ArrayWithProps<T> = [T[]] & { width: number, height: number }
export type OriginResolutionData = {
  origin: [number, number],
  //xPixelWidth, yPixelHeight
  resolution: [number, number, number],
  data: ArrayWithProps<number>,
  geometry_id: string,
  version: number,
};

//Needs to be high enough to handle 2x number of checked out boundaries,
//knowing that these are cleaned afterwards
const RASTER_SIZE_LIMIT = 1000;

//Travel time from single point raster, cache key is the global id of the starting point


export class RasterDatabase extends Dexie {


  //key is the boundary guid
  pop: Dexie.Table<OriginResolutionData, string>;
  friction: Dexie.Table<OriginResolutionData, string>;
  tt_from_sp: Dexie.Table<OriginResolutionData, string>;


  constructor() {

    super("RasterDatabase");

    //console.log("Constructing RasterDatabase");

    const store_schema: { [key: string]: string } = {};
    store_schema["pop"] = "geometry_id";
    //Note for friction and travel time from single point, the travel mode is appended to the geometry id
    store_schema["friction"] = "geometry_id";
    store_schema["tt_from_sp"] = "geometry_id";


    //
    // Define tables and indexes
    //
    this.version(9).stores(store_schema);


    this.pop = this.table("pop");
    this.friction = this.table("friction");
    this.tt_from_sp = this.table("tt_from_sp");


    //console.log("Finished Constructing RasterDatabase");
  }

  async enforceRasterSize() {
    if (await this.pop.count() > RASTER_SIZE_LIMIT) {
      await this.pop.clear();
    }
    if (await this.friction.count() > RASTER_SIZE_LIMIT) {
      await this.friction.clear();
    }
    if (await this.tt_from_sp.count() > RASTER_SIZE_LIMIT) {
      await this.tt_from_sp.clear();
    }

  }

  getTravelTimeKey(geometryId: string, isWalking: boolean): string {
    return geometryId + (isWalking ? "walking" : "mixed");
  }

}


export function buildRasterStatsFromTiff(rd: OriginResolutionData) {
  return new RasterStats({
                           origin: [rd.origin[0],
                             rd.origin[1]],
                           xPixelWidth: rd.resolution[0],
                           yPixelHeight: rd.resolution[1],
                           size: [rd.data.width,
                             rd.data.height]
                         });
}
