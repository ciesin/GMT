class RasterSquareBase {
    y_row: number = 0
    x_col: number = 0

    //https://stackoverflow.com/questions/40521447/typescript-pass-to-constructor-entire-object
    constructor(data: Partial<RasterSquareBase> = {}) {
        Object.assign(this, data)
    }


    add_assign(rhs: this) {
        this.x_col += rhs.x_col;
        this.y_row += rhs.y_row;
    }

    equals(rhs: this): boolean {
        return (this.x_col == rhs.x_col) && (this.y_row == rhs.y_row);
    }

}



export class RasterSquareIndex extends RasterSquareBase {

    public override toString(): string {
        return `RasterSquareIndex x_col: ${this.x_col} y_row: ${this.y_row}`;
    }

    static build(x_col: number, y_row: number) {
        return new RasterSquareIndex({
            x_col,
            y_row
        })
    }

    //N E S W
    cross(): [RasterSquareIndex, RasterSquareIndex, RasterSquareIndex, RasterSquareIndex] {
        return [new RasterSquareIndex({
            x_col: this.x_col,
            y_row: this.y_row - 1
        }),
        new RasterSquareIndex({
            x_col: this.x_col + 1,
            y_row: this.y_row
        }),
        new RasterSquareIndex({
            x_col: this.x_col,
            y_row: this.y_row + 1
        }),
        new RasterSquareIndex({
            x_col: this.x_col - 1,
            y_row: this.y_row
        })
        ];
    }

    //NE SE SW NW
    cross_diag(): [RasterSquareIndex, RasterSquareIndex, RasterSquareIndex, RasterSquareIndex] {
        return [new RasterSquareIndex({
            x_col: this.x_col + 1,
            y_row: this.y_row - 1
        }),
        new RasterSquareIndex({
            x_col: this.x_col + 1,
            y_row: this.y_row + 1
        }),
        new RasterSquareIndex({
            x_col: this.x_col - 1,
            y_row: this.y_row + 1
        }),
        new RasterSquareIndex({
            x_col: this.x_col - 1,
            y_row: this.y_row - 1
        })
        ];
    }
}

export class RasterSquareCoords extends RasterSquareBase {

    public override toString(): string {
        return `RasterSquareCoords x_coord: ${this.x_col} y_coord: ${this.y_row}`;
    }
}
