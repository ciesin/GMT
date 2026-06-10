import {RasterSquareIndex} from "./RasterSquareIndex";
import {RasterStats} from "./RasterStats";
import {Position} from "../../utils/server-interfaces/GeoJson";


function testAssert(ok: boolean, msg: string = "")
{
    if (!ok) {
        throw new Error(msg);
    }
}
function testEquals(r1: RasterSquareIndex, r2: RasterSquareIndex, msg: string = "")
{
    if (!r1.equals(r2)) {
        throw new Error(`${r1} does not equal ${r2}.  ${msg}`);
    }
}


const Directions = [
    //right
    new RasterSquareIndex({x_col:1,y_row: 0}),
    //up
    new RasterSquareIndex({x_col:0,y_row: -1}),
    //left
    new RasterSquareIndex({x_col:-1,y_row: 0}),
    //down
    new RasterSquareIndex({x_col:0,y_row: 1}),
]

/**
 * raster_x, raster_y, raster_index
 * @param stats
 */
export function* topDownGenerator(stats: RasterStats) : Generator<[number,number,number], any, any>
{
    const coord: [number,number,number] = [0,0,0];

    for (let geom_y = 0; geom_y < stats.size[1]; geom_y += 1) {
        coord[1] = geom_y;
        for (let geom_x = 0; geom_x < stats.size[0]; geom_x += 1) {
            coord[0] = geom_x;
            yield (coord);
            coord[2]++;
        }
    }
}

/*
Yields the squares starting from each corner, going in the opposite corners direction
 */
export function* fromEachCorner(stats: RasterStats) : Generator<Position, any, any>
{
    const coord: Position = [0,0];

    for (let geom_y = 0; geom_y < stats.size[1]; geom_y += 1) {
        coord[1] = geom_y;
        for (let geom_x = 0; geom_x < stats.size[0]; geom_x += 1) {
            coord[0] = geom_x;
            yield (coord);
        }
    }
    for (let geom_y = stats.size[1] - 1; geom_y >= 0; geom_y -= 1) {
        coord[1] = geom_y;
        for (let geom_x = stats.size[0] - 1; geom_x >= 0; geom_x -= 1) {
            coord[0] = geom_x;
            yield (coord);
        }
    }

    for (let geom_y = 0; geom_y < stats.size[1]; geom_y += 1) {
        coord[1] = geom_y;
        for (let geom_x = stats.size[0] - 1; geom_x >= 0; geom_x -= 1) {
            coord[0] = geom_x;
            yield (coord);
        }
    }

    for (let geom_y = stats.size[1] - 1; geom_y >= 0; geom_y -= 1) {
        coord[1] = geom_y;
        for (let geom_x = 0; geom_x < stats.size[0]; geom_x += 1) {
            coord[0] = geom_x;
            yield (coord);
        }
    }
}

export function* eightDirections(coords: Position) : Generator<[Position, boolean], any, any>
{
    const adjCoords : Position = [0,0];

    //N E S W
    adjCoords[0] = coords[0];
    adjCoords[1] = coords[1] - 1;
    yield ([adjCoords, false]);

    adjCoords[0] = coords[0] + 1;
    adjCoords[1] = coords[1] ;
    yield ([adjCoords, false]);

    adjCoords[0] = coords[0];
    adjCoords[1] = coords[1] + 1;
    yield ([adjCoords, false]);

    adjCoords[0] = coords[0] - 1;
    adjCoords[1] = coords[1] ;
    yield ([adjCoords, false]);

    //NE SE SW NW
    adjCoords[0] = coords[0] + 1;
    adjCoords[1] = coords[1] - 1;
    yield ([adjCoords, true]);

    adjCoords[0] = coords[0] + 1;
    adjCoords[1] = coords[1] + 1;
    yield ([adjCoords, true]);

    adjCoords[0] = coords[0] - 1;
    adjCoords[1] = coords[1] + 1;
    yield ([adjCoords, true]);

    adjCoords[0] = coords[0] - 1;
    adjCoords[1] = coords[1] - 1;
    yield ([adjCoords, true]);

}

export function* spiralGenerator(start: RasterSquareIndex) : Generator<RasterSquareIndex, any, any>
{
    //https://stackoverflow.com/questions/398299/looping-in-a-spiral

    let dir_index = -1;
    let forward_step = 0;
    //shallow copy is good enough
    let current = new RasterSquareIndex(start);
    yield(new RasterSquareIndex(current));

    const incDir = () => {
        dir_index += 1;
        if (dir_index >= Directions.length) {
            dir_index = 0;
        }
        return Directions[dir_index];
    };

    //following the pattern, you go forward the # of forward steps twice, then turn
    while(true) {
        forward_step += 1;

        //keep this number of forward steps for 2 turns
        for(let i = 0; i < 2; ++i) {

            //turn
            const direction = incDir();

            //go forward
            for(let j = 0; j < forward_step; ++j) {
                current.add_assign(direction);
                yield(new RasterSquareIndex(current));
            }



        }
    }

}

export function calcDistance(p1: Position | [number,number], p2: Position  | [number,number] | Float64Array) : number
{
    return Math.sqrt(
        Math.pow(p1[0] - p2[0], 2) +
        Math.pow(p1[1] - p2[1], 2)
    );
}

export function* distanceOrderGenerator(centerStart: Position,
                                        hfCoords: [number, number],
                                        rasterStats: RasterStats,
                                        maxDiagDistance: number) : Generator<Position, any, any>
{
    let distanceSquare: Array<[Position,number]> = [];

    //first generate all the squares, this could be cached...
    for(let xDiff = -maxDiagDistance; xDiff <= maxDiagDistance; xDiff += 1)
    {
        for(let yDiff = -maxDiagDistance; yDiff <= maxDiagDistance; yDiff += 1)
        {
            const sq: Position = [ centerStart[0] + xDiff, centerStart[1] + yDiff];
            const rasterSqCoords = rasterStats.centerCoords(sq);
            distanceSquare.push( [sq, calcDistance(hfCoords, rasterSqCoords) ])
        }
    }

    //Order the squares
    distanceSquare.sort( (a,b) => {
        if (a[1] == b[1]) {
            return 0;
        }
        return a[1] < b[1] ? -1 : 1;
    });

    for(const item of distanceSquare) {
        yield(item[0]);
    }
}

/*
export function testIterator() {
    console.log("Testing iterator");
    let start = RasterSquareIndex.build(3, 3);
    let c = spiralGenerator(start);
    testEquals(RasterSquareIndex.build(3, 3),  c.next().value, "");
    testEquals(RasterSquareIndex.build(4, 3),  c.next().value, "");
    testEquals(RasterSquareIndex.build(4, 2),  c.next().value, "");
    testEquals(RasterSquareIndex.build(3, 2),  c.next().value, "");
    testEquals(RasterSquareIndex.build(2, 2),  c.next().value, "");
    testEquals(RasterSquareIndex.build(2, 3),  c.next().value, "");
    testEquals(RasterSquareIndex.build(2, 4),  c.next().value, "");

    testEquals(RasterSquareIndex.build(3, 3),  start, "Shallow copy");

    start = RasterSquareIndex.build(0, 0);
    c = spiralGenerator(start);

    testEquals(RasterSquareIndex.build(0, 0),  c.next().value, "");
    testEquals(RasterSquareIndex.build(1, 0),  c.next().value, "");
    testEquals(RasterSquareIndex.build(1, -1),  c.next().value, "");

    let s = new RasterStats({
        size: new RasterSquareIndex({
            x_col: 2,
            y_row: 3
        })
    });
    const a = [];
    for(let v of spiralGenerator(start))
    {
        //console.log(`# ${a.length} V is ${v} x ${v[0]} y ${v[1]}`);
        a.push(v);
        if (a.length > 200) {
            break;
        }
    }

    const b = a.filter( (sq) => {
        return s.is_valid_coord(sq);
    });

    testAssert(b.length == 6, `Length of array is ${b.length} ${b}`);
}*/

