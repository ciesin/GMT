import { Position, GeoJsonSettlementPart, GeoJsonHealthFacility} from "./../GeoJson";
import { roundUp, roundDown, roundPosition} from "../utils/coords.util";


//these are the standard worldpop values, these should be the pop raster stats
export const STANDARD_X_PIXEL_WIDTH = 0.000833333329980;
export const STANDARD_Y_PIXEL_HEIGHT = -STANDARD_X_PIXEL_WIDTH;

export function fromSpOrHf(
  spOrHf: GeoJsonSettlementPart | GeoJsonHealthFacility,
): RasterStats {
  return new RasterStats({
                           origin: [spOrHf.properties.origin_x,
                             spOrHf.properties.origin_y],

                           xPixelWidth: STANDARD_X_PIXEL_WIDTH,
                           yPixelHeight: STANDARD_Y_PIXEL_HEIGHT,
                           size: [spOrHf.properties.raster_width,
                             spOrHf.properties.raster_height]
                         });
}

export type Extent = [number, number, number, number];

export interface RasterStatsInterface {
  origin: Position,
  xPixelWidth: number;
  yPixelHeight: number;

  size: Position;
}

export class RasterStats implements RasterStatsInterface {
  origin: Position = [0.0, 0.0];

  xPixelWidth: number = 1;
  yPixelHeight: number = 1;

  size: Position = [0, 0];

  constructor(data: Partial<RasterStats> = {}) {
    Object.assign(this, data);
  }

  static fromPlainObject(data: RasterStatsInterface): RasterStats {
    const newClass = new RasterStats();
    Object.assign(newClass, data);
    return newClass;
  }

  toPlainObj(): RasterStatsInterface {
    return Object.assign({}, this);
  }

  isValidPosition(idx: Position): boolean {
    return idx[0] >= 0 && idx[1] >= 0 && idx[0] < this.size[0] && idx[1] < this.size[1];
  }

  clampCoord(coord: number, dim: number): number {
    if (coord < 0) {
      return 0;
    }

    if (coord >= this.size[dim]) {
      return this.size[dim] - 1;
    }

    return coord;
  }

  /**
   * returns all adj pos, including diagonals
   * @param pos
   */
  * getAdjacent(pos: Position): Generator<Position, any, any> {
    for (let dx = -1; dx <= 1; ++dx) {
      for (let dy = -1; dy <= 1; ++dy) {

        if (dx == 0 && dy == 0) {
          continue;
        }
        let adjPos: Position = [pos[0] + dx, pos[1] + dy];

        if (this.isValidPosition(adjPos)) {
          yield adjPos;
        }

      }
    }
  }

  //From projected coords to raster index x, y
  toIndex(projCoords: Position): Position {
    return [
      (projCoords[0] - this.origin[0]) / this.xPixelWidth,
      (projCoords[1] - this.origin[1]) / this.yPixelHeight,
    ];
  }

  to2dIndex(idx: number): Position {
    let rasterX = idx % this.size[0];
    let rasterY = (idx - rasterX) / this.size[0];
    return [rasterX, rasterY];
  }

  to1dIndex(idx: Position): number {
    return idx[0] + idx[1] * this.size[0];
  }

  //Because coords are top / left corner, we use floor
  toIndexRoundDown(projCoords: Position): Position {
    return roundDown(this.toIndex(projCoords));
  }

  //When we expect the projected coords to be snapped
  //projected coords => raster index
  toIndexRound(projCoords: Position): Position {
    return roundPosition(this.toIndex(projCoords));
  }

  calcTopLeftCoords(idx: Position): Position {
    return [
      this.origin[0] + this.xPixelWidth * (idx[0]),
      this.origin[1] + this.yPixelHeight * (idx[1]),
    ];
  }

  centerCoords(idx: Position): Position {
    return [
      this.origin[0] + this.xPixelWidth * (idx[0] + 0.5),
      this.origin[1] + this.yPixelHeight * (idx[1] + 0.5),
    ];
  }

  polyCoords(rasterIndex: Position): Array<Position> {
    const [x_min, y_min, x_max, y_max] = this.getExtent(rasterIndex);

    return [
      [x_min, y_min],
      [x_min, y_max],
      [x_max, y_max],
      [x_max, y_min],
      [x_min, y_min],
    ];
  }

  getExtent(rasterIndex: Position): Extent {
    const x_min = this.origin[0] + this.xPixelWidth * rasterIndex[0];
    const x_max = this.origin[0] + this.xPixelWidth * (1 + rasterIndex[0]);
    const y_max = this.origin[1] + this.yPixelHeight * rasterIndex[1];
    const y_min = this.origin[1] + this.yPixelHeight * (1 + rasterIndex[1]);
    return [x_min, y_min, x_max, y_max];
  }

  getRasterExtent(): Extent {
    const x_min = this.origin[0];
    const x_max = this.origin[0] + this.xPixelWidth * this.size[0];
    const y_max = this.origin[1];
    const y_min = this.origin[1] + this.yPixelHeight * this.size[1];
    return [x_min, y_min, x_max, y_max];
  }

  getSubRasterStatsForExtent(extent: Extent): RasterStats {
    // minX, minY, maxX, maxY order
    let upperLeft = roundDown(this.toIndex([
                                             extent[0],
                                             extent[3]
                                           ]));
    let bottomRight = roundUp(this.toIndex([
                                             extent[2],
                                             extent[1]
                                           ]));

    let subOrigin = this.calcTopLeftCoords(upperLeft);

    return new RasterStats({
                             origin: subOrigin,
                             xPixelWidth: this.xPixelWidth,
                             yPixelHeight: this.yPixelHeight,
                             size: [bottomRight[0] - upperLeft[0],
                               bottomRight[1] - upperLeft[1]]
                           });
  }

  /**
   * Gets a 01010001 string
   * @param coords projected coordinates
   */
  getRasterStringFromCoords(coords: Array<Position>): string {
    const rasterArray: Array<string> = Array(this.size[0] * this.size[1]);
    rasterArray.fill("0");

    for (const coord of coords) {
      const idx2d = this.toIndexRound(coord);
      const idx = this.to1dIndex(idx2d);
      //console.log(`For coord ${coord[0]}, ${coord[1]} index is ${idx2d} or ${idx}`);
      rasterArray[idx] = "1";
    }

    return rasterArray.join("");
  }
}
