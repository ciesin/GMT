import { BBox2d } from '@turf/helpers/dist/js/lib/geojson';
import { bbox } from '@turf/turf';
import { Extent } from 'ol/extent';
import { getCenterOfExtent, roundPosition } from '../../utils/coords';
import {
  DefaultGeoJSonSettlementPartProperties,
  GeoJsonBase,
  GeoJsonHealthFacility,
  GeoJsonSettlementPart,
  MultiPolygon,
  Position,
} from '../../utils/server-interfaces/GeoJson';
import { fromSpOrHf, RasterStats } from './RasterStats';

function getRingEdges(
  stats: RasterStats,
  coordinates: Array<Position>
): Array<Edge> {
  const rasterCoords: Array<Position> = [];
  for (const pos of coordinates) {
    const rasterIdx = stats.toIndex(pos);
    rasterCoords.push(rasterIdx);
  }

  const edges: Array<Edge> = [];
  for (let pt_idx = 0; pt_idx < rasterCoords.length - 1; pt_idx += 1) {
    let r1 = rasterCoords[pt_idx];
    let r2 = rasterCoords[pt_idx + 1];

    let [topCoord, botCoord] = r1[1] < r2[1] ? [r1, r2] : [r2, r1];

    //skip horizontal edges
    if (r1[1] == r2[1]) {
      continue;
    }

    let edge = new Edge(topCoord, botCoord); //, format!(
    //     "raster (r{}, c{}) to (r{}, c{}) coords {}, {} to {}, {}",
    //     top_coord.row,
    //     top_coord.col,
    //     bot_coord.row,
    //     bot_coord.col,
    //     p1.0, p1.1, p2.0, p2.1
    // ));

    if (edge.rasterYMin < edge.rasterYMax) {
      edges.push(edge);
    } else {
      //these edges won't intersect a raster square center
      //println!("Ignoring edge {:?}", &edge);
    }
  }

  return edges;
}

export function getEdges(stats: RasterStats, p: GeoJsonBase): Array<Edge> {
  const edges: Array<Edge> = [];

  if (p.geometry.type == 'Polygon') {
    for (const ring of p.geometry.coordinates) {
      edges.push(...getRingEdges(stats, ring));
    }
  } else if (p.geometry.type == 'MultiPolygon') {
    for (const polygon of p.geometry.coordinates) {
      for (const ring of polygon) {
        edges.push(...getRingEdges(stats, ring));
      }
    }
  }

  //lowest raster y min last
  edges.sort((e1, e2) => e2.rasterYMin - e1.rasterYMin);

  return edges;
}

export function rasterize(edgeList: Array<Edge>, rasterStats: RasterStats) {
  let currentRow = 0;

  let active_edges: Array<Edge> = [];

  let rasterized: Array<boolean> = [];

  for (let i = 0; i < rasterStats.size[0] * rasterStats.size[1]; ++i) {
    rasterized[i] = false;
  }

  while (
    (edgeList.length > 0 || active_edges.length > 0) &&
    currentRow < rasterStats.size[1]
  ) {
    //console.log(`${LOG_PREFIX}Starting row ${currentRow}`);

    //consider edges whose y_max >= current_y and y_min <= current_y
    //anything earlier in the edge_list has a y_min that is too high
    //and we stop looking when the y_min

    //Move those edges from the ET to the AET for which holds:
    while (edgeList.length > 0) {
      let last_elem = edgeList[edgeList.length - 1];
      if (last_elem.rasterYMin == currentRow) {
        active_edges.push(edgeList.pop()!);
        continue;
      }

      if (last_elem.rasterYMin > currentRow) {
        break;
      }

      //edge case, first edge is above
      if (last_elem.rasterYMin < currentRow) {
        edgeList.pop();
      }
    }

    const xHitList = active_edges.map((e) => e.rasterXHit);
    xHitList.sort((a, b) => a - b);

    // for (const a of active_edges) {
    //     console.log(`${LOG_PREFIX}Active edge ${a.label}`);
    // }
    //
    // const xHitStr = xHitList.join(", ");
    // console.log(`${LOG_PREFIX}X intersections: ${xHitStr}`);

    let xHitIdx = 0;
    let parity = 0;

    for (let col = 0; col < rasterStats.size[0]; ++col) {
      while (xHitIdx < xHitList.length && xHitList[xHitIdx] < 0.5 + col) {
        xHitIdx += 1;
        parity = 1 - parity;
      }
      rasterized[currentRow * rasterStats.size[0] + col] = parity == 1;
    }

    //Remove anything in active_edges that no longer applies
    for (let i = active_edges.length - 1; i >= 0; --i) {
      if (active_edges[i].rasterYMax == 1 + currentRow) {
        active_edges.splice(i, 1);
      }
    }

    //Increment x intersection
    for (const a of active_edges) {
      a.rasterXHit += a.mInv;
    }

    currentRow += 1;
  }

  return rasterized;
}

class Edge {
  //y_min: f64,     // smallest value of y (when edge enters)
  //y_max: f64,     // largest value of y (when edge leaves)
  rasterXHit: number;
  // intersection point (init with x value at yMax)
  mInv: number;
  // dx/dy (inverse line increment)
  rasterYMin: number;
  //min raster row is (-0.5, 0.5)
  rasterYMax: number;

  //label: string;

  constructor(topCoord: Position, botCoord: Position) {
    //because 1st row is above the last row
    console.assert(topCoord[1] < botCoord[1]);

    let dy = topCoord[1] - botCoord[1];
    let dx = topCoord[0] - botCoord[0];

    console.assert(topCoord[1] >= 0);
    console.assert(botCoord[1] >= 0);

    //we want y_min to be rounded down and y_max to be rounded up
    //this is because we want the real segment to actually intersect the middle of these raster squares
    //note the 0.5 pixel height is because we want the center
    this.rasterYMin = Math.floor(topCoord[1] + 0.5);
    this.rasterYMax = Math.floor(botCoord[1] + 0.5);

    // (x0 - x1) / (y0 - y1) = dx / dy
    // x0 - x1 = (dx / dy) * (y0-y1)
    // x0 =  (dx / dy) * (y0-y1) + x1

    this.mInv = dx / dy;

    //x at rasterYMin+0.5
    this.rasterXHit =
      topCoord[0] + (this.rasterYMin + 0.5 - topCoord[1]) * this.mInv;

    //this.label = `rasterXHit: ${this.rasterXHit} y min/max ${this.rasterYMin}, ${this.rasterYMax}.  What ${topCoord[0]} + ${topCoord[1]} - ${this.rasterYMin} * ${dx}/${dy}`
  }
}

/**
 *
 * @param settlementPart settlement part, in 4326
 * @param subRasterStats
 * @param mpExtent extent of settlement part, in 4326
 *
 * @returns An array the size of subRasterStats that is true if the cell is in the geometry, false otherwise
 */
export function getRasterized(
  settlementPart: GeoJsonSettlementPart,
  subRasterStats: RasterStats,
  mpExtent: Extent
): Array<boolean> {
  const edges = getEdges(subRasterStats, settlementPart);

  //console.log(`${LOG_PREFIX}Edges`, edges);

  const rasterized = rasterize(edges, subRasterStats);

  const totalNumSquares = rasterized.reduce((pv, cv) => {
    if (cv) {
      return pv + 1;
    } else {
      return pv;
    }
  }, 0);

  if (totalNumSquares == 0) {
    //deal with no rasterized squares, fall back to nearest raster square
    let center = getCenterOfExtent(mpExtent);
    let rasterIdx = subRasterStats.toIndexRoundDown(center);
    let raster1dIndex = subRasterStats.to1dIndex(rasterIdx);
    rasterized[raster1dIndex] = true;
  }

  return rasterized;
}

const GLOBAL_WORLDPOP_GRID = new RasterStats({
  origin: [-180.001249265000013, 84.007916532010029],
  xPixelWidth: 0.00083333333,
  yPixelHeight: -0.00083333333,

  size: [432000, 187200],
});

export function resetRasterSettlementPartFields(
  updatedSettlementPart: GeoJsonSettlementPart
) {
  updatedSettlementPart.properties.raster = '';
  updatedSettlementPart.properties.is_fixed_post = '';
  updatedSettlementPart.properties.is_outreach = '';

  updatedSettlementPart.properties.raster_width = 0;
  updatedSettlementPart.properties.raster_height = 0;
}

export function resetRasterHealthFacilityFields(hf: GeoJsonHealthFacility) {
  hf.properties.catchment_raster = '';

  hf.properties.raster_width = 0;
  hf.properties.raster_height = 0;
}

export function manuallyPopulateSettlementPartFieldsIfNeeded(
  settlementPart: GeoJsonSettlementPart
) {
  if (
    settlementPart.properties.raster &&
    settlementPart.properties.raster.length > 0
  ) {
    //assume we don't need to do anything
    return;
  }

  if (
    !Array.isArray(settlementPart.properties.bbox) ||
    settlementPart.properties.bbox.length != 4
  ) {
    settlementPart.properties.bbox = bbox(settlementPart.geometry) as BBox2d;
  }

  // minX, minY, maxX, maxY order
  let mpExtent = settlementPart.properties.bbox;

  //console.log(`${LOG_PREFIX}Settlement part extent`, mpExtent);

  //we only need the snapped raster width & height
  const subRasterStats =
    GLOBAL_WORLDPOP_GRID.getSubRasterStatsForExtent(mpExtent);
  const rasterized = getRasterized(settlementPart, subRasterStats, mpExtent);

  //settlementPart.properties.bbox set above
  settlementPart.properties.origin_x = subRasterStats.origin[0];
  settlementPart.properties.origin_y = subRasterStats.origin[1];
  settlementPart.properties.raster_width = subRasterStats.size[0];
  settlementPart.properties.raster_height = subRasterStats.size[1];
  settlementPart.properties.raster = rasterized
    .map((r) => (r ? '1' : '0'))
    .join('');
}

export function doRastersIntersect(
  sp1: GeoJsonSettlementPart,
  sp1Stats: RasterStats,
  sp2: GeoJsonSettlementPart,
  sp2Stats: RasterStats
): boolean {
  const offset = roundPosition(sp1Stats.toIndex(sp2Stats.origin));

  //These are coordinates in sp1 raster, clamped
  let xRasterStart = sp1Stats.clampCoord(offset[0], 0);
  let yRasterStart = sp1Stats.clampCoord(offset[1], 1);

  let xRasterStop = sp1Stats.clampCoord(offset[0] + sp2Stats.size[0] - 1, 0);
  let yRasterStop = sp1Stats.clampCoord(offset[1] + sp2Stats.size[1] - 1, 1);

  //loop through
  for (let sp1x = xRasterStart; sp1x <= xRasterStop; ++sp1x) {
    for (let sp1y = yRasterStart; sp1y <= yRasterStop; ++sp1y) {
      const sp1Index = sp1Stats.to1dIndex([sp1x, sp1y]);

      if (sp1.properties.raster.charAt(sp1Index) != '1') {
        continue;
      }

      //now check sp2
      let sp2x = sp1x - offset[0];
      let sp2y = sp1y - offset[1];

      if (!sp2Stats.isValidPosition([sp2x, sp2y])) {
        continue;
      }

      const sp2Index = sp2Stats.to1dIndex([sp2x, sp2y]);

      if (sp2.properties.raster.charAt(sp2Index) != '1') {
        continue;
      }

      //here we intersected
      return true;
    }
  }

  return false;
}

export function testRasterIntersect() {
  const spTests: Array<GeoJsonSettlementPart> = [];

  for (let i = 0; i < 5; ++i) {
    const sp: GeoJsonSettlementPart = {
      type: 'Feature',
      properties: {
        ...DefaultGeoJSonSettlementPartProperties,
      },
      geometry: [] as unknown as MultiPolygon,
    };
    spTests.push(sp);
  }

  const popRasterStats = new RasterStats({
    origin: [-10, 10],
    xPixelWidth: 1,
    yPixelHeight: -1,

    size: [20, 20],
  });

  spTests[0].properties.origin_x = 1;
  spTests[0].properties.origin_y = 7;
  spTests[0].properties.raster_width = 2;
  spTests[0].properties.raster_height = 4;
  spTests[0].properties.raster = '11000011';

  spTests[1].properties.origin_x = 2;
  spTests[1].properties.origin_y = 10;
  spTests[1].properties.raster_width = 3;
  spTests[1].properties.raster_height = 4;
  spTests[1].properties.raster = '000000000100';

  spTests[2].properties.origin_x = 8;
  spTests[2].properties.origin_y = 10;
  spTests[2].properties.raster_width = 2;
  spTests[2].properties.raster_height = 2;
  spTests[2].properties.raster = '1111';

  spTests[3].properties.origin_x = 2;
  spTests[3].properties.origin_y = 5;
  spTests[3].properties.raster_width = 5;
  spTests[3].properties.raster_height = 4;
  spTests[3].properties.raster = '00000100000000000000';

  spTests[4].properties.origin_x = -3;
  spTests[4].properties.origin_y = 4;
  spTests[4].properties.raster_width = 5;
  spTests[4].properties.raster_height = 6;
  spTests[4].properties.raster = '000010000000000000000000000000';

  const spStats: Array<RasterStats> = [];
  for (let i = 0; i < 5; ++i) {
    const stats = fromSpOrHf(spTests[i]);

    stats.xPixelWidth = popRasterStats.xPixelWidth;
    stats.yPixelHeight = popRasterStats.yPixelHeight;

    spStats.push(stats);
  }

  console.assert(
    doRastersIntersect(spTests[0], spStats[0], spTests[1], spStats[1])
  );
  console.assert(
    !doRastersIntersect(spTests[0], spStats[0], spTests[2], spStats[2])
  );
  console.assert(
    doRastersIntersect(spTests[0], spStats[0], spTests[3], spStats[3])
  );
  console.assert(
    doRastersIntersect(spTests[0], spStats[0], spTests[4], spStats[4])
  );

  console.assert(
    doRastersIntersect(spTests[1], spStats[1], spTests[0], spStats[0])
  );
  console.assert(
    !doRastersIntersect(spTests[2], spStats[2], spTests[0], spStats[0])
  );
  console.assert(
    doRastersIntersect(spTests[3], spStats[3], spTests[0], spStats[0])
  );
  console.assert(
    doRastersIntersect(spTests[4], spStats[4], spTests[0], spStats[0])
  );
}
