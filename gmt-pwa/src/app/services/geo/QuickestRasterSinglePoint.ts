import {OriginResolutionData, RasterDatabase} from "../vector_layer/RasterDatabase";
import {RasterStats} from "./RasterStats";
import {TravelTimeBetweenPointsArgs} from "./WorkerInterface";
import {getSquareValue, initializeRaster, setSquareValue} from "./RasterFuncs";
import {calcDistance, eightDirections, fromEachCorner} from "./RasterIterators";
// import { NGXLogger } from "ngx-logger"; // if uncommented has compile errors

/**
 *
 * @param frictionRaster
 * @param frictionRasterStats
 * @param startingPoint X, Y in 3857
 */
export function buildFromSinglePointTimeRaster(
  frictionRaster: OriginResolutionData,
  frictionRasterStats: RasterStats,
  startingPoint: [number,number],
  logger
): OriginResolutionData {
  //Initialize time raster
  const timeRaster = initializeRaster(frictionRaster, -1);

  //Intialize the square with the from point
  const fromSquare = frictionRasterStats.toIndexRoundDown(startingPoint);

  if (!frictionRasterStats.isValidPosition(fromSquare)) {
    //this shouldn't happen so aside from logging we can't do too much
    //the friction raster should contain the entire boundary extent + an extra margin
    //and the from point should be within this area
    logger.error("Invalid from square", startingPoint, fromSquare);
    return null as any as OriginResolutionData;
  }

  //Minutes per meter
  const frictionValue = getSquareValue(frictionRaster, fromSquare);

  //3857 coordinates
  const squareCoords = frictionRasterStats.centerCoords(fromSquare);
  //console.log("Friction raster stats", frictionRasterStats);

  //Initial value is not 0, we set it as the time to travel to the center of the raster square
  const distance = calcDistance(startingPoint, squareCoords);
  const time = distance * frictionValue;

  //console.log(`Initializing square ${fromSquare} with ${time} minutes from distance ${distance} meters and friction value ${frictionValue} minutes per meter`);
  setSquareValue(timeRaster, fromSquare, time);

  //Now we do 4 passes from each corner to calculate the nearest time for every raster square
  const SQUARE_ROOT_2 = Math.sqrt(2);

  let loopLimit = 2000000;

  //Now we do the 4 passes
  for (const rasterIndex of fromEachCorner(frictionRasterStats)) {
    loopLimit--;
    if (loopLimit <= 0) {
      break;
    }
    if (!frictionRasterStats.isValidPosition(rasterIndex)) {
      logger.error("Invalid coordinate");
    }

    const frictionValue = getSquareValue(frictionRaster, rasterIndex);
    const timeValue = getSquareValue(timeRaster, rasterIndex);

    //Not initialized yet so we continue
    if (timeValue < 0) {
      continue;
    }

    // Attempt to find a better time value
    for (const [adjRasterIndex, is_diag] of eightDirections(rasterIndex)) {
      if (!frictionRasterStats.isValidPosition(adjRasterIndex)) {
        continue;
      }

      const adjFrictionValue = getSquareValue(frictionRaster, adjRasterIndex);
      const adjTimeValue = getSquareValue(timeRaster, adjRasterIndex);


      //Calculate the time, center of current square to center of adajecent square
      let dist = 50;
      if (is_diag) {
        dist *= SQUARE_ROOT_2;
      }
      //minutes per meter is unit of friction raster
      // minutes to neaest is unit of time raster
      // raster square is 100m, we need to travel half of adj cell + half of current cell

      //We are travelling from the current square to the adjusted square
      let newTimeValue = timeValue + dist * adjFrictionValue + dist * frictionValue;
      if (newTimeValue < adjTimeValue || adjTimeValue < 0) {
        setSquareValue(timeRaster, adjRasterIndex, newTimeValue);
      }
    }
  }

  return timeRaster;
}


export async function loadCachedOrBuildSinglePointTimeRaster(
  rasterDb: RasterDatabase,
  startingPoint: [number, number],
  isWalking: boolean,
  startingPointGuid: string,
  frictionRaster: OriginResolutionData,
  frictionRasterStats: RasterStats,
  logger //: NGXLogger
) : Promise<OriginResolutionData | null> {
  const timeRasterKey = rasterDb.getTravelTimeKey(startingPointGuid, isWalking);
  let timeRaster = await rasterDb.tt_from_sp.get(timeRasterKey);

  if (timeRaster && timeRaster.version != frictionRaster.version) {
    //need to rebuild
    console.log(`$$ Time raster is an old version ${timeRaster.version} instead of ${frictionRaster.version}`);
    timeRaster = undefined;
  }

  if (!timeRaster) {
    //console.log(`$$ Building single point time raster for ${startingPointGuid} Walking? ${isWalking}`);
    timeRaster = buildFromSinglePointTimeRaster(
      frictionRaster,
      frictionRasterStats,
      startingPoint,
      logger
    );

    //Not a valid raster, can happen on an error of some kind
    if (!timeRaster) {
      return null;
    }

    timeRaster.geometry_id = timeRasterKey;

    await rasterDb.enforceRasterSize();
    await rasterDb.tt_from_sp.put(timeRaster);
    console.log(`$$ Finishing caching time raster for ${startingPointGuid}`)

  } else {
    //console.log(`$$ Used cached time raster for ${startingPointGuid} cache key ${timeRasterKey}`)
  }

  return timeRaster;
}
