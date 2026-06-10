import { Workbook, Worksheet } from 'exceljs';
import { NGXLogger } from 'ngx-logger';
import { BoundaryDataClass } from 'src/app/services/geo/BoundaryDataClass';

import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  finishPrepareSheet,
  NO_VALUE,
  TableColumnPropertiesExtra,
  trimAllStrings,
} from './utils';

export interface ExcelBoundaryRowData {
  popCalculated: number;
  boundaryLabels: string[];
}

export function buildBoundarySheet(
  workbook: Workbook,
  rowData: Array<ExcelBoundaryRowData>,
  logger: NGXLogger
): Worksheet {
  //

  const settlementSheet = workbook.addWorksheet('GMT - Overview', {
    views: [
      {
        state: 'frozen',
        ySplit: 1,
      },
    ],
  });

  const columns: Array<TableColumnPropertiesExtra> = [];

  const NA_BOUNDARY: Array<string> = [];
  const LEVEL_TO_LABEL = AppConfigService.get_level_to_label();

  for (
    let i = 0;
    i <= AppConfigService.conf.generic.operational_boundary_level;
    ++i
  ) {
    columns.push({ name: `${LEVEL_TO_LABEL[i]}`, filterButton: true });

    NA_BOUNDARY.push(NO_VALUE);
  }

  columns.push({
    name: 'POP GIS',
    filterButton: true,
    numFmt: '0',
    totalsRowFunction: 'sum',
  });

  const rows = rowData.map((excelRowData) => {
    const ret: Array<string | number | boolean> = [
      'Nigeria',
      ...excelRowData.boundaryLabels,
      excelRowData.popCalculated,
    ];

    return ret;
  });

  trimAllStrings(rows);

  const table = settlementSheet.addTable({
    name: 'Overview_Table',
    ref: `A${1}`,
    headerRow: true,
    totalsRow: true,
    columns,
    rows,
  });

  finishPrepareSheet(settlementSheet, table, columns);

  return settlementSheet;
}

/**
 * Returns row in the GMT_Boundary sheet
 * @param boundaryData
 * @param hfFixedPost
 * @param logger
 * @returns
 */
function addBoundaryRow(boundaryData: BoundaryDataClass): ExcelBoundaryRowData {
  const mainBoundaryRow: ExcelBoundaryRowData = {
    boundaryLabels: boundaryData.getBoundaryLabels(boundaryData.boundaryId),
    popCalculated: boundaryData.bMap.get(boundaryData.boundaryId)!.properties
      .computed_pop!,
  };

  return mainBoundaryRow;
}

export function buildBoundaryRowList(
  boundaryData: BoundaryDataClass,
  logger: NGXLogger
): Array<ExcelBoundaryRowData> {
  const rows: Array<ExcelBoundaryRowData> = [];

  rows.push(addBoundaryRow(boundaryData));

  return rows;
}
