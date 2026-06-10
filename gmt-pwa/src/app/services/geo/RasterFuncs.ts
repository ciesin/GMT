import { buildRasterStatsFromTiff, OriginResolutionData } from "../vector_layer/RasterDatabase";
import { RasterStats } from "./RasterStats";
import { topDownGenerator } from "./RasterIterators";
import { Position } from "../../utils/server-interfaces/GeoJson";

export function getSquareValue(raster: OriginResolutionData, index: Position) {
    //bounds check
    /*if (index.x_col < 0 || index.x_col >= raster[2].width) {
        throw new Error("x out of bounds");
    }
    if (index.y_row < 0 || index.y_row >= raster[2].height) {
        throw new Error("y out of bounds");
    }
    if (!Number.isSafeInteger(index.x_col) || !Number.isSafeInteger(index.y_row)) {
        throw new Error("Not integral");
    }*/

    //computer 1d index
    const vectorIndex = index[0] + index[1] * raster.data.width;

    return raster.data[0][vectorIndex];
}


export function setSquareValue(raster: OriginResolutionData,
    index: Position, value: number) {
    //bounds check
    /*if (index.x_col < 0 || index.x_col >= raster[2].width) {
        throw new Error("x out of bounds");
    }
    if (index.y_row < 0 || index.y_row >= raster[2].height) {
        throw new Error("y out of bounds");
    }
    if (!Number.isSafeInteger(index.x_col) || !Number.isSafeInteger(index.y_row)) {
        throw new Error("Not integral");
    }*/

    //computer 1d index
    const vectorIndex = index[0] + index[1] * raster.data.width;

    raster.data[0][vectorIndex] = value;
}


export function initializeRaster(
    //reference raster
    geomRaster: OriginResolutionData,
    initValue: number
): OriginResolutionData {
    const geomRasterStats = buildRasterStatsFromTiff(geomRaster);
    let loopLimit = 2000000;

    const rasterCellData: Array<number> = [];

    for (const rasterIndex of topDownGenerator(geomRasterStats)) {
        //Filter out squares that are not in the admin boundary
        loopLimit--;
        if (loopLimit <= 0) {
            break;
        }
        if (!geomRasterStats.isValidPosition(rasterIndex as unknown as Position)) {
            throw new Error("Invalid coord!")
        }

        //const geomValue = getSquareValue(geomRaster, rasterIndex);

        // if (geomValue != 1) {
        //     rasterCellData.push(-2);
        //     quickestHFCellData.push(-2);
        // } else {
        rasterCellData.push(initValue);

    }

    //now make the 2 rasters in the right format of OriginResolutionData
    //console.log(`Time raster data length ${timeRasterCellData.length} geom len ${geomRaster[2][0].length}`);
    const data: any = [rasterCellData];
    data.width = geomRaster.data.width;
    data.height = geomRaster.data.height;

    return {
        data,
        geometry_id: "",
        origin: geomRaster.origin,
        resolution: geomRaster.resolution,
        version: geomRaster.version
    };

}
