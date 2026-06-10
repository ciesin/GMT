import { Table, Cell, TableColumnProperties, Worksheet } from "exceljs";

import * as _ from "lodash";

export interface TableColumnPropertiesExtra extends TableColumnProperties {
    numFmt?: string;
}

export const NO_VALUE = "N/A";

//Catchment pop types header suffixes

//Estimated pop or blank
export const SUFFIX_EST = "(EST)";

//Computed pop
export const SUFFIX_GIS = "(GIS)";

//Estimated, defaulting to computed
export const SUFFIX_EST_GIS = "(EST+GIS where no EST)";

/**
 * Autofit columns by width
 * see https://github.com/exceljs/exceljs/issues/83#issuecomment-801895920
 *
 */
export function autoWidth(worksheet: Worksheet, minimalWidth: number = 10) {
    for (const column of worksheet.columns) {
        if (!column) {
            continue;
        }
        let maxColumnLength = 0;
        column.eachCell!({ includeEmpty: true }, (cell: Cell) => {

            if (cell.isMerged) {
                return;
            }
            maxColumnLength = Math.max(
                maxColumnLength,
                minimalWidth,
                cell.value ? cell.value.toString().length : 0
            );
        });
        column.width = maxColumnLength + 2;
    }
}

export function finishPrepareSheet(excelSheet: Worksheet, table: Table, columns: Array<TableColumnPropertiesExtra>) {
    // 1 based index; last 2 columns contain population
    // We want them formatted as a number
    for (const [columnIndex, columnInfo] of columns.entries()) {
        if (!columnInfo.numFmt) {
            continue;
        }
        //column is 1 based
        const popColumn = excelSheet.getColumn(1 + columnIndex);
        popColumn.numFmt = columnInfo.numFmt;
    }

    table.commit();

    autoWidth(excelSheet);
}

export function trimAllStrings(rows: Array<Array<string | number | boolean | null>>) {
    for (const row of rows) {
        for (let i = 0; i < row.length; i++) {
            if (!_.isString(row[i])) {
                continue;
            }

            row[i] = _.trim(row[i] as string);
        }
    }
}


//https://stackoverflow.com/questions/8240637/convert-numbers-to-letters-beyond-the-26-character-alphabet
/*
0 based column
*/
export function getColumnLetter(num) {
    let letters = ''
    while (num >= 0) {
        letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[num % 26] + letters
        num = Math.floor(num / 26) - 1
    }
    return letters
}