/// <reference lib="webworker" />


import {TravelTimeBetweenPointsArgs, WorkerFunction, WorkerRequest, WorkerResponse} from "./WorkerInterface";
import {buildRasterStatsFromTiff, RasterDatabase} from "../vector_layer/RasterDatabase";
import {getSquareValue} from "./RasterFuncs";
import {loadCachedOrBuildSinglePointTimeRaster} from "./QuickestRasterSinglePoint";


import {
  cleanupSettlementProblems,
  getSettlementProblemsGeometry,
  getSettlementProblemsNameRelated,
  // getSettlementProblemsPopulation,
  initSettlementProblems
} from "./settlement/problems";
// import { NGXLogger } from "ngx-logger"; // if uncommented has compile errors

const funcs = (()=> {
  const funcs = new Map<WorkerFunction, (data: any) => Promise<any>>();

  funcs.set(WorkerFunction.WAIT, waitFunction);
  funcs.set(WorkerFunction.TRAVEL_TIME_SINGLE_POINT, travelTimeBetweenPoints);

  funcs.set(WorkerFunction.INIT_SETTLEMENTS_PROBLEMS, initSettlementProblems);
  // funcs.set(WorkerFunction.GET_SETTLEMENT_PROBLEM, getSettlementProblems);
  funcs.set(WorkerFunction.GET_SETTLEMENT_PROBLEM_GEOMETRY, getSettlementProblemsGeometry);
  // funcs.set(WorkerFunction.GET_SETTLEMENT_PROBLEM_POPULATION, getSettlementProblemsPopulation);
  funcs.set(WorkerFunction.GET_SETTLEMENT_PROBLEM_NAME_RELATED, getSettlementProblemsNameRelated);
  funcs.set(WorkerFunction.CLEANUP_SETTLEMENTS_PROBLEMS, cleanupSettlementProblems);
  return funcs;
})();


addEventListener('message', async (message) => {

  const workerRequest: WorkerRequest = message.data;

  //console.info('in webworker', workerRequest);
  //const s = new Set<number>();


  //postMessage('this is the response ', .data);
  postMessage(wrapResult(workerRequest, await funcs.get(workerRequest.func)!(workerRequest.data)));

});


function wrapResult(request: WorkerRequest, workerFunctionResp: any): WorkerResponse {
  return {
    data: workerFunctionResp, index: request.index
  };
}

function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFunction(secondsToWait: number): Promise<number> {
  await timeout(secondsToWait * 1000);
  return secondsToWait + 37;
}


/**
 *
 * @param args
 * @return time in seconds
 */
export async function travelTimeBetweenPoints(args: TravelTimeBetweenPointsArgs): Promise<number> {
  const rasterDb = new RasterDatabase();
  const dbKey = rasterDb.getTravelTimeKey(args.boundaryId, args.is_walking);

  //Note this raster has been extended which should include surrounding boundaries
  //This means if the shortest route is to quit the boundary/ward, it will be taken
  const frictionRaster = await rasterDb.friction.get(dbKey);

  if (!frictionRaster) {
    //normal for now to not have friction rasters
    return -1;
  }

  const frictionRasterStats = buildRasterStatsFromTiff(frictionRaster);

  const timeRaster = await loadCachedOrBuildSinglePointTimeRaster(
    rasterDb,
    args.from3857,
    args.is_walking,
    args.fromPointId,
    frictionRaster,
    frictionRasterStats,
    args.logger
  );

  rasterDb.close();

  if (!timeRaster) {
    console.error("Could not load time raster");
    return -1;
  }

  const toSquare = frictionRasterStats.toIndexRoundDown(args.to3857);

  if (!frictionRasterStats.isValidPosition(toSquare)) {
    console.error("Invalid to coordinate, perhaps too far");
    return -1;
  }

  const timeValue = getSquareValue(timeRaster, toSquare);
  //const distance = calcDistance(args.from3857, args.to3857);

  //console.log(`Returning ${timeValue} minutes for ${distance} meters`);

  //The friction raster is in minutes / meter so we adjust to seconds
  return timeValue * 60.0;
}



