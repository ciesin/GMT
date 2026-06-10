import { Alignment, Borders, Cell, CellValue, Font, Worksheet } from "exceljs";
import _ from "lodash";
import { NGXLogger } from "ngx-logger";

export class CellFormatter {
    public row: number;
    public col: number;
    public font: Partial<Font>;
    public alignment: Partial<Alignment>;
    public borders: Partial<Borders>;

    public numFmt: string;

    public spanWidth: number = 1;
    public spanHeight: number = 1;

    constructor(private sheet: Worksheet, private logger: NGXLogger) {
        this.row = 0;
        this.col = 0;
    }

    setRowCol(pRow: number, pCol: number): CellFormatter {
        this.row = pRow;
        this.col = pCol;
        return this;
    }
    setRow(pRow: number): CellFormatter {
        this.row = pRow;

        return this;
    }
    addToRow(pRow: number): CellFormatter {
        this.row += pRow;

        return this;
    }
    setCol(pCol: number): CellFormatter {
        this.col = pCol;
        return this;
    }
    addToCol(pCol: number): CellFormatter {
        this.col += pCol;
        return this;
    }

    setSpanWidthHeight(pSpanWidth: number, pSpanHeight: number): CellFormatter {
        this.spanHeight = pSpanHeight;
        this.spanWidth = pSpanWidth;
        return this;
    }

    setFont(pFont: Partial<Font>, clear: boolean = false): CellFormatter {
        if (clear) {
            this.font = _.cloneDeep(pFont);
        } else {
            this.font = _.assign({}, this.font, pFont);
        }
        return this;
    }
    setAlignment(pAlignment: Partial<Alignment>, clear: boolean = false): CellFormatter {
        if (clear) {
            this.alignment = _.cloneDeep(pAlignment);
        } else {
            this.alignment = _.assign({}, this.alignment, pAlignment);
        }
        return this;
    }
    setBorders(pBorder: Partial<Borders>): CellFormatter {
        //Effectively clones
        this.borders = _.assign({}, this.borders, pBorder);
        return this;
    }
    setNumFmt(n: string): CellFormatter {
        this.numFmt = n;
        return this;
    }

    /*
    Sets with current row/col/font/border/etc.
    */
    setCellValue(cellValue: CellValue): Cell {
        const cell = this.sheet.getCell(this.row, this.col);
        cell.value = cellValue;
        cell.font = this.font;
        cell.border = this.borders;
        cell.alignment = this.alignment;
        cell.numFmt = this.numFmt;

        if (this.spanHeight != 1 || this.spanWidth != 1) {

            //this.logger.debug(`Merge cells top ${this.row} bottom ${this.row + this.spanHeight - 1} left ${this.col} right ${this.col + this.spanWidth - 1}`);
            try {
                this.sheet.mergeCells(
                    this.row, this.col, this.row + this.spanHeight - 1,
                    this.col + this.spanWidth - 1);
            } catch (ex) {
                this.logger.error(`${ex} EEE -- Merge cells top ${this.row} bottom ${this.row + this.spanHeight - 1} left ${this.col} right ${this.col + this.spanWidth - 1}`);
            }
        }

        return cell;
    }
}
