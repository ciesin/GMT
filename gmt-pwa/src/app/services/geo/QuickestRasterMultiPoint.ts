import { OriginResolutionData } from "../vector_layer/RasterDatabase";
import { GeoJsonHealthFacility, Point } from "../../utils/server-interfaces/GeoJson";
import { RasterStats } from "./RasterStats";
import { toMercator } from "@turf/turf";
import { getSquareValue, setSquareValue } from "./RasterFuncs";
import { calcDistance, distanceOrderGenerator, eightDirections, fromEachCorner } from "./RasterIterators";

/*
Functions to generate a quickest raster for multiple starting points
 */

/**
 Sets 1 square for each health facility in the time and health facility rasters

 @param quickestHfRaster hf INDEX pointing to which is the current fastest health facility
 by travel time.  -1 for not initialized
 */


// function initializeTimeAndHfRasters(timeRaster: OriginResolutionData,
//     quickestHfRaster: OriginResolutionData,
//     frictionRaster: OriginResolutionData,
//     hfList: Array<GeoJsonHealthFacility>,
// ) {
//     //Loop through HFs, initializing a set of 9 squares around it with the real distance

//     //the raster stats of both rasters should be the exact same, we just need 1 of them
//     const geomRasterStats = RasterStats.build(frictionRaster);

//     /*const hfUuidToIndex: Map<string, number> =
//       new Map(Array.from(hfList.entries()).map(([index, feature]) => [feature.properties.global_id, index]));


//     for (const e of hfUuidToIndex.entries()) {
//       console.log("$$ entry", e);
//     }*/

//     let loopLimit = 100000;
//     let needToLoopAgain = false;
//     do {
//         needToLoopAgain = false;
//         if (loopLimit <= 0) {
//             break;
//         }
//         console.log("$$ Looping through HF, finding closest squares");
//         for (const [hfIndex0, hfFeature] of hfList.entries()) {

//             const hfIndex = 1 + hfIndex0;

//             loopLimit--;
//             if (loopLimit <= 0) {
//                 break;
//             }

//             //What square is the hf in?
//             const olPoint4326 = hfFeature.geometry as Point;
//             const olPoint3857 = toMercator(olPoint4326);

//             let coords = olPoint3857.coordinates;

//             //console.log(`Coords are ${coords}`);

//             const hfSquare = geomRasterStats.toIndexRoundDown(new Float64Array(coords));

//             console.log(`$$ Hf square ${hfIndex} is ${hfSquare}`);

//             const hfFrictionValue = getSquareValue(frictionRaster, hfSquare);


//             //TODO handle unbounded distance
//             //Find the closest square
//             for (const adjSquare of distanceOrderGenerator(hfSquare, coords, geomRasterStats, 3)) {

//                 //out of raster
//                 if (!geomRasterStats.isValidPosition(adjSquare)) {
//                     console.log(`Adj square ${adjSquare} is not valid`);
//                     continue;
//                 }

//                 //if we already have a value with this HF index, we are done
//                 const nearestHF = getSquareValue(quickestHfRaster, adjSquare);

//                 if (nearestHF == hfIndex) {
//                     break;
//                 }

//                 //Real distance between center and health facility
//                 //While not always correct if distance is many squares, for simlpcity assume
//                 //the friction value of the health facility.  To do this properly, would need
//                 //to intersect the line with raster squares
//                 const adjCoords = geomRasterStats.centerCoords(adjSquare);
//                 const hfDistance = calcDistance(coords, adjCoords);
//                 const hfTime = hfDistance * hfFrictionValue;

//                 const currentBestTime = getSquareValue(timeRaster, adjSquare);

//                 if (hfTime < currentBestTime) {
//                     setSquareValue(timeRaster, adjSquare, hfTime);
//                     setSquareValue(quickestHfRaster, adjSquare, hfIndex);

//                     console.log(`$$ Found a better time in square ${adjSquare}.  Was ${currentBestTime} with HF ${nearestHF}`);
//                     console.log(`$$ Now ${hfDistance} with HF ${hfIndex} with coords ${coords} vs adj coords ${adjCoords} friction ${hfFrictionValue} minutes/meter distance ${hfDistance}`);

//                     needToLoopAgain = true;
//                     break;
//                 }
//             }
//         }
//     } while (needToLoopAgain);


//     console.log(`$$ Done initializing HF square.  `);


// }

/**
 Sets 1 square for each health facility in the time and health facility rasters.

 This makes the assumption that travel time is 0 for the initial square.  The reason
 is to properly balance health facilities in the same square.

 @param quickestHfRaster hf INDEX pointing to which is the current fastest health facility
 by travel time.  -1 for not initialized
 */
// function initializeTimeAndHfRastersZeroTime(timeRaster: OriginResolutionData,
//     quickestHfRaster: OriginResolutionData,
//     hfList: Array<GeoJsonHealthFacility>,
//     sharedHF: Map<number, number>
// ) {
//     //Loop through HFs, initializing a set of 9 squares around it with the real distance

//     //the raster stats of both rasters should be the exact same, we just need 1 of them
//     const geomRasterStats = RasterStats.build(quickestHfRaster);

//     /*const hfUuidToIndex: Map<string, number> =
//       new Map(Array.from(hfList.entries()).map(([index, feature]) => [feature.properties.global_id, index]));
  
  
//     for (const e of hfUuidToIndex.entries()) {
//       console.log("$$ entry", e);
//     }*/

//     console.log("$$ Looping through HF, finding closest squares");
//     for (const [hfIndex, hfFeature] of hfList.entries()) {

//         //What square is the hf in?
//         const olPoint4326 = hfFeature.geometry as Point;
//         const olPoint3857 = toMercator(olPoint4326);

//         let coords = olPoint3857.coordinates;

//         //console.log(`Coords are ${coords}`);

//         const hfSquare = geomRasterStats.toIndexRoundDown(new Float64Array(coords));

//         console.log(`$$ Hf square ${hfIndex} is ${hfSquare}`);


//         //out of raster
//         if (!geomRasterStats.isValidPosition(hfSquare)) {
//             console.error(`square of ${hfSquare} is not valid`);
//             continue;
//         }

//         //if a HF already has this square, continue
//         const nearestHF = getSquareValue(quickestHfRaster, hfSquare);

//         if (nearestHF >= 0) {
//             //already a hf
//             sharedHF.set(hfIndex, nearestHF)
//             continue;
//         }

//         setSquareValue(timeRaster, hfSquare, 0.001);
//         setSquareValue(quickestHfRaster, hfSquare, hfIndex);

//         console.log(`$$ with HF ${hfIndex} with coords ${coords} `);

//     }
//     console.log(`$$ Done initializing HF square.  `);


// }
/*
function findQuickestHF(timeRaster: OriginResolutionData,
                        quickestHfRaster: OriginResolutionData,
                        frictionRaster: OriginResolutionData,) {
  let loopLimit = 1000000;
  const SQUARE_ROOT_2 = Math.sqrt(2);

  const geomRasterStats = RasterStats.build(frictionRaster);

  //Now we do the 4 passes
  for (const rasterIndex of fromEachCorner(geomRasterStats)) {
    loopLimit--;
    if (loopLimit <= 0) {
      break;
    }
    if (!geomRasterStats.isValidPosition(rasterIndex)) {
      console.error("Invalid coordinate");
    }

    const quickestHFValue = getSquareValue(quickestHfRaster, rasterIndex);
    const frictionValue = getSquareValue(frictionRaster, rasterIndex);
    const timeValue = getSquareValue(timeRaster, rasterIndex);

    //not initialized yet
    if (quickestHFValue < 0) {
      continue;
    }

    // Attempt to find a better time value; propogate current quickest hf to adjacent squares
    // really based on the corner direction, we only need the 3 adacent squares
    // 1 2 3
    // 4 5 6
    // 7 8 9
    // 124 or 236 or 478 or 689
    for (const [adjRasterIndex, is_diag] of eightDirections(rasterIndex)) {
      if (!geomRasterStats.isValidPosition(adjRasterIndex)) {
        continue;
      }

      const adjFrictionValue = getSquareValue(frictionRaster, adjRasterIndex);
      const adjTimeValue = getSquareValue(timeRaster, adjRasterIndex);

      //Calculate the time, center of current square to center of adajecent square

      //we know / assume the raster squares are 100 meters in width/height
      //thus the distance between 2 square centers is either 50 * F1 +50 * F2
      //or 50*sqrt(2) *F1 + 50*sqrt(2) *F2
      //where F1 and F2 are the friction values (minutes per meter)

      let dist = 50;
      if (is_diag) {
        dist *= SQUARE_ROOT_2;
      }
      //minutes per meter is unit of friction raster
      // minutes to neaest is unit of time raster
      // raster square is 100m, we need to travel half of adj cell + half of current cell
      let newTimeValue = timeValue + dist * adjFrictionValue + dist * frictionValue;
      if (newTimeValue < adjTimeValue) {
        setSquareValue(timeRaster, adjRasterIndex, newTimeValue);
        setSquareValue(quickestHfRaster, adjRasterIndex, quickestHFValue);
      }
    }


  }
}*/

