import {OriginResolutionData} from "../vector_layer/RasterDatabase";
import {RasterStats} from "./RasterStats";
import {getSquareValue} from "./RasterFuncs";
import {Position} from "../../utils/server-interfaces/GeoJson";

export function computePopSquareValue(rasterX: number,
                               rasterY: number,
                               subRasterStats: RasterStats,
                               popRasterStats: RasterStats,
                               offset: Position, popRaster: OriginResolutionData): number {
  const popRasterX = rasterX + offset[0];
  const popRasterY = rasterY + offset[1];

  //this.logger.info(`${LOG_PREFIX}popRasterX ${popRasterX} popRasterY ${popRasterY}`);

  if (popRasterStats.isValidPosition([popRasterX, popRasterY])) {
    const popValue = getSquareValue(popRaster, [popRasterX, popRasterY]);

    if (popValue > 0) {
      return popValue;
      //this.logger.info(`${LOG_PREFIX}popRasterX ${popRasterX} popRasterY ${popRasterY} value ${popValue}`);
    }
  }

  return 0;
}
