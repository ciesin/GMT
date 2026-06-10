import { Workbook, Worksheet } from 'exceljs';
import * as _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { BoundaryDataClass } from 'src/app/services/geo/BoundaryDataClass';
import { getSettlements } from 'src/app/services/vector_layer/single-hf-processing.service';
import { CatchedSettlement } from 'src/app/services/vector_layer/single-hf.service';

import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  ALL_PROBLEMATIC_OPTIONS,
  ALL_UNINHABITED_OPTIONS,
} from 'src/app/utils/server-interfaces/GeoJson';
import { getNumberOrDefault } from 'src/app/utils/string-formatting';
import {
  finishPrepareSheet,
  NO_VALUE,
  TableColumnPropertiesExtra,
  trimAllStrings,
} from './utils';

export interface ExcelSettlementRowData {
  settlementName: string;
  settlementAlternateName: string;
  settlementComments: string;
  settlementLatitude: number;
  settlementLongitude: number;
  settlementSetWithGps: boolean | null;
  settlementBoundaryLabels: Array<string>;
  settlementInBoundary: boolean;

  //Is there a FP or Outreach in this ward that covers at least > 0.5 people of this settlement?
  partOfBoundaryHfCatchment: boolean;

  //Does an Outreach (of any boundary) exclude this settlement
  isExcluded: boolean;

  popCalculated: number;
  popEstimated: number | null;
  popDiff: number;
  markedForPopReview: boolean | null;
  //Boolean flags for ALL_PROBLEMATIC_OPTIONS
  problematicFlags: Array<boolean>;
  //Boolean flags for ALL_UNINHABITED_OPTIONS
  uninhabitedFlags: Array<boolean>;

  //Uninhabited is not a multi select field; this is either ALL_UNINHABITED_OPTIONS or in the case of Other, the user provided detail
  uninhabitedReason: string;
}

export function buildSettlementSheet(
  workbook: Workbook,
  rowData: Array<ExcelSettlementRowData>,
  logger: NGXLogger
): Worksheet {
  //

  const settlementSheet = workbook.addWorksheet('GMT - STLs', {
    views: [
      {
        state: 'frozen',
        ySplit: 2,
      },
    ],
  });

  const columns: Array<TableColumnPropertiesExtra> = [
    {
      name: 'Name',
      filterButton: true,
    },
    {
      name: 'Alternate Name',
      filterButton: true,
    },
    {
      name: 'Comments',
      filterButton: true,
    },
    { name: 'STL Latitude', filterButton: true, numFmt: '0.00000' },
    { name: 'STL Longitude', filterButton: true, numFmt: '0.00000' },
    { name: 'STL Set With GPS', filterButton: true },
  ];

  const NA_BOUNDARY: Array<string> = [];
  const LEVEL_TO_LABEL = AppConfigService.get_level_to_label();

  for (
    let i = 1;
    i <= AppConfigService.conf.generic.operational_boundary_level;
    ++i
  ) {
    columns.push({ name: `STL ${LEVEL_TO_LABEL[i]}`, filterButton: true });

    NA_BOUNDARY.push(NO_VALUE);
  }

  columns.push({ name: 'STL in ward', filterButton: true });

  columns.push({
    name: 'Part of HF catchment of this ward',
    filterButton: true,
  });
  columns.push({ name: 'Excluded from a catchment', filterButton: true });

  const popStartColumn = columns.length;
  columns.push({
    name: 'POP GIS',
    filterButton: true,
    numFmt: '0',
    totalsRowFunction: 'sum',
  });
  columns.push({
    name: 'POP EST',
    filterButton: true,
    numFmt: '0',
    totalsRowFunction: 'sum',
  });
  columns.push({
    name: 'POP DIFF',
    filterButton: true,
    numFmt: '0',
    totalsRowFunction: 'sum',
  });
  const popNumColumns = columns.length - popStartColumn;

  columns.push({ name: 'Marked for pop. review', filterButton: true });

  const uninhabitedStartColumn = columns.length;

  columns.push({ name: 'Uninhabited Reason', filterButton: true });
  columns.push(
    ...ALL_UNINHABITED_OPTIONS.map((uo) => {
      return { name: uo, filterButton: true };
    })
  );

  const problematicStartColumn = columns.length;

  columns.push(
    ...ALL_PROBLEMATIC_OPTIONS.map((uo) => {
      //Excel needs unique column names
      if (uo == 'Unknown') {
        return { name: 'Reason Unknown', filterButton: true };
      }
      if (uo == 'Other') {
        return { name: 'Reason Other', filterButton: true };
      }
      return { name: uo, filterButton: true };
    })
  );

  const rows = rowData.map((excelRowData) => {
    const ret: Array<string | number | boolean | null> = [
      excelRowData.settlementName,
      excelRowData.settlementAlternateName,
      excelRowData.settlementComments,
      //lat
      excelRowData.settlementLatitude,
      //lon
      excelRowData.settlementLongitude,
      excelRowData.settlementSetWithGps,

      ...excelRowData.settlementBoundaryLabels,
      excelRowData.settlementInBoundary,

      excelRowData.partOfBoundaryHfCatchment,
      excelRowData.isExcluded,

      excelRowData.popCalculated,
      excelRowData.popEstimated,
      excelRowData.popDiff,
      excelRowData.markedForPopReview,
      excelRowData.uninhabitedReason,
      ...excelRowData.uninhabitedFlags,
      ...excelRowData.problematicFlags,
    ];

    return ret;
  });

  trimAllStrings(rows);
  //logger.info(`EEE STL Table`, columns, rows);

  const table = settlementSheet.addTable({
    name: 'STL_Table',
    ref: `A${2}`,
    headerRow: true,
    totalsRow: true,
    columns,
    rows,
  });

  finishPrepareSheet(settlementSheet, table, columns);

  //Add subtitles

  //1 based indexes
  settlementSheet.mergeCells(
    1,
    popStartColumn + 1,
    1,
    popStartColumn + popNumColumns
  );
  const popTotalCell = settlementSheet.getCell(1, popStartColumn + 1);
  popTotalCell.value = 'POPULATION TOTAL';

  const uninhabitedNumColumns = ALL_UNINHABITED_OPTIONS.length;

  const problematicNumColumns = ALL_PROBLEMATIC_OPTIONS.length;

  settlementSheet.mergeCells(
    1,
    uninhabitedStartColumn + 1,
    1,
    uninhabitedStartColumn + uninhabitedNumColumns
  );
  const uninhabitedCell = settlementSheet.getCell(
    1,
    uninhabitedStartColumn + 1
  );
  uninhabitedCell.value = 'UNINHABITED';

  settlementSheet.mergeCells(
    1,
    problematicStartColumn + 1,
    1,
    problematicStartColumn + problematicNumColumns
  );
  const problematicCell = settlementSheet.getCell(
    1,
    problematicStartColumn + 1
  );
  problematicCell.value = 'SPECIAL ATTENTION';

  return settlementSheet;
}

/**
 * Returns row in the GMT_Settlement sheet
 */
function addSettlementRow(
  boundaryData: BoundaryDataClass,
  settlement: CatchedSettlement,
  logger: NGXLogger
): ExcelSettlementRowData {
  const uninhabitedFlags: Array<boolean> = [];
  for (const uo of ALL_UNINHABITED_OPTIONS) {
    if (settlement.settlementName.properties.uninhabited !== true) {
      uninhabitedFlags.push(false);
      continue;
    }
    uninhabitedFlags.push(
      uo == settlement.settlementName.properties.uninhabited_reason
    );
  }

  const problematicFlags: Array<boolean> = [];
  for (const po of ALL_PROBLEMATIC_OPTIONS) {
    problematicFlags.push(
      settlement.settlementName.properties.problematic.includes(po)
    );
  }

  const popCalculated = settlement.settlementPart.properties.computed_pop!;
  const popEstimated = settlement.settlementName.properties.estimated_pop;

  const catchmentList = boundaryData.getCatchmentForSp(
    settlement.settlementPart.properties.global_id,
    true,
    false
  );
  const isExcluded = catchmentList.some(
    (ci) => ci.properties.type == 'exclude'
  );

  //Match the logic in getSettlements, where just having any generated ci item is enough to have it listed in settlements
  const partOfBoundaryHfCatchment = catchmentList.some((ci) => {
    const hf = boundaryData.hfMap.get(ci.properties.health_facility_point);
    if (_.isNil(hf)) {
      return false;
    }
    //Don't count if FP/Outreach is in another boundaries
    //Take care that this settlement could also be in another boundary, so we
    //use the current boundary from boundary data
    if (hf.properties.boundary_polygon != boundaryData.boundaryId) {
      return false;
    }
    if (ci.properties.type == 'exclude') {
      return false;
    }
    //Any include/generated item counts
    return true;
  });

  let uninhabitedReason = 'N/A';

  if (settlement.settlementName.properties.uninhabited) {
    uninhabitedReason =
      settlement.settlementName.properties.uninhabited_reason || 'Unknown';
    if (uninhabitedReason == 'Other') {
      uninhabitedReason =
        'Other - ' +
        (settlement.settlementName.properties.uninhabited_other_detail ||
          'Unknown');
    }
  }

  const mainSettlementRow: ExcelSettlementRowData = {
    settlementBoundaryLabels: boundaryData.getBoundaryLabels(
      settlement.settlementName.properties.boundary_polygon
    ),
    settlementName: settlement.settlementName.properties.name,
    settlementAlternateName:
      settlement.settlementName.properties.synonyms.join(', '),
    settlementComments: settlement.settlementName.properties.comments,
    settlementLatitude: settlement.settlementName.geometry.coordinates[1],
    settlementLongitude: settlement.settlementName.geometry.coordinates[0],
    settlementSetWithGps: settlement.settlementName.properties.set_with_gps,
    settlementInBoundary: settlement.inBoundary,
    popCalculated,
    popEstimated,
    popDiff: popCalculated - getNumberOrDefault(popEstimated, popCalculated),
    markedForPopReview: settlement.settlementName.properties.marked_for_review!,
    uninhabitedFlags,
    uninhabitedReason,
    problematicFlags,
    isExcluded,
    partOfBoundaryHfCatchment,
  };

  return mainSettlementRow;
}

export function buildSettlementRowList(
  boundaryData: BoundaryDataClass,
  logger: NGXLogger
): Array<ExcelSettlementRowData> {
  //We need to find all settlements that are related to
  const fixedPosts = boundaryData.getHfFixedPost();

  const hfLoader = { logger, boundaryData };

  const includedSettlementsMap: Map<string, CatchedSettlement> = new Map();
  const excludedSettlementsMap: Map<string, CatchedSettlement> = new Map();

  for (const fp of fixedPosts) {
    getSettlements(
      hfLoader,
      fp,
      includedSettlementsMap,
      excludedSettlementsMap,
      false
    );

    for (let outreach of boundaryData.hfChildMap.get(fp.properties.global_id) ||
      []) {
      getSettlements(
        hfLoader,
        outreach,
        includedSettlementsMap,
        excludedSettlementsMap,
        false
      );
    }
  }

  //We also need to include any settlements that are not in any catchment but are in the ward
  for (const settlementName of boundaryData.snList) {
    //Must be in boundary
    if (settlementName.properties.boundary_polygon != boundaryData.boundaryId) {
      continue;
    }

    if (includedSettlementsMap.has(settlementName.properties.global_id)) {
      continue;
    }

    const settlementPart = boundaryData.spMap.get(
      settlementName.properties.settlement_part!
    );

    if (!settlementPart) {
      continue;
    }

    includedSettlementsMap.set(settlementName.properties.global_id, {
      settlementName,
      settlementPart,
      catchmentJson: [],
      inBoundary: true,
    });
  }

  const rows: Array<ExcelSettlementRowData> = [];

  for (const settlement of includedSettlementsMap.values()) {
    rows.push(addSettlementRow(boundaryData, settlement, logger));
  }

  rows.sort((r1, r2) => r1.settlementName!.localeCompare(r2.settlementName!));

  return rows;
}
