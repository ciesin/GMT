import { Workbook, Worksheet } from 'exceljs';
import { NGXLogger } from 'ngx-logger';
import { BoundaryDataClass } from 'src/app/services/geo/BoundaryDataClass';

import {
  addCatchmentPop,
  CatchmentPopulation,
  DEFAULT_CATCHMENT_POPULATION,
} from '@services/vector_layer/single-hf-processing.service';
import _ from 'lodash';
import { AppConfigService } from 'src/app/utils/app-config.service';
import { safeDistance } from 'src/app/utils/coords';
import { GeoJsonHealthFacility } from 'src/app/utils/server-interfaces/GeoJson';
import {
  getCiComputedPop,
  getCiEstimatedGisPop,
  getCiEstimatedPopIfExists,
  getSpComputedPop,
  NON_ZERO_POP,
} from 'src/app/utils/server-interfaces/utils/indicator.util';
import { RI_SERVICE } from '../../../constants/hf.constants';
import { formatFrequencyOrDays } from '../../../utils/string-formatting';
import { getMobileItems } from './sheet-hf-catchment';
import {
  finishPrepareSheet,
  NO_VALUE,
  SUFFIX_EST,
  SUFFIX_EST_GIS,
  SUFFIX_GIS,
  TableColumnPropertiesExtra,
  trimAllStrings,
} from './utils';

export interface ExcelCatchmentRowData {
  fpName: string;
  hfType: string;
  outreachName: string;

  //text representing frequency
  schedule: string;

  settlementName: string;
  settlementBoundaryName: string;

  //Uses computed population
  catchmentPopulationInsideBoundary: CatchmentPopulation;
  catchmentPopulationOutsideBoundary: CatchmentPopulation;

  settlementPopulationPercentageAssignedToHF: number;

  distanceSettlementHf: number;
  distanceHFOutreachSite: number;
}

export function buildCatchmentSheet(
  workbook: Workbook,
  rowData: Array<ExcelCatchmentRowData>,
  logger: NGXLogger
): Worksheet {
  //

  const settlementSheet = workbook.addWorksheet('GMT - Catchments', {
    views: [
      {
        state: 'frozen',
        ySplit: 1,
      },
    ],
  });

  const columns: Array<TableColumnPropertiesExtra> = [];

  const LEVEL_TO_LABEL = AppConfigService.get_level_to_label();

  const operatingBoundaryLevelName =
    LEVEL_TO_LABEL[AppConfigService.conf.generic.operational_boundary_level];

  columns.push({ name: 'HF Name', filterButton: true });
  columns.push({ name: 'RI Strategy', filterButton: true });
  columns.push({ name: 'Outreach Site Name', filterButton: true });
  columns.push({ name: 'Schedule', filterButton: true });
  columns.push({ name: 'Settlement Name', filterButton: true });
  columns.push({ name: 'Settlement Ward', filterButton: true });

  for (const suffix of [SUFFIX_GIS, SUFFIX_EST, SUFFIX_EST_GIS]) {
    //These are not totals, but the pop for that line item
    columns.push({
      name: `Catchment Population ${suffix}`,
      filterButton: true,
      numFmt: '0',
      totalsRowFunction: 'sum',
    });
  }

  columns.push({
    name: `Catchment Population Inside HF ${operatingBoundaryLevelName}`,
    filterButton: true,
    numFmt: '0',
    totalsRowFunction: 'sum',
  });
  columns.push({
    name: `Catchment Population Outside HF ${operatingBoundaryLevelName}`,
    filterButton: true,
    numFmt: '0',
    totalsRowFunction: 'sum',
  });

  columns.push({
    name: '% of Settlement Population Assigned To HF',
    filterButton: true,
    numFmt: '0.0',
  });
  columns.push({
    name: 'Distance Settlement HF (m)',
    filterButton: true,
    numFmt: '0',
  });
  columns.push({
    name: 'Distance HF OutreachSite (m)',
    filterButton: true,
    numFmt: '0',
  });

  const rows = rowData.map((excelRowData) => {
    const catchmentPopulation = addCatchmentPop(
      excelRowData.catchmentPopulationInsideBoundary,
      excelRowData.catchmentPopulationOutsideBoundary
    );

    const ret: Array<string | number | boolean | null> = [
      excelRowData.fpName,
      excelRowData.hfType,
      excelRowData.outreachName,

      excelRowData.schedule,

      excelRowData.settlementName,

      excelRowData.settlementBoundaryName,

      catchmentPopulation.computedPop,

      //should == multiply estimated population * % of sett. population assigned to HF
      catchmentPopulation.estimatedPop,

      catchmentPopulation.estimatedGisPop,

      excelRowData.catchmentPopulationInsideBoundary.computedPop,
      excelRowData.catchmentPopulationOutsideBoundary.computedPop,

      excelRowData.settlementPopulationPercentageAssignedToHF,
      excelRowData.distanceSettlementHf,
      excelRowData.distanceHFOutreachSite,
    ];

    return ret;
  });

  trimAllStrings(rows);

  const table = settlementSheet.addTable({
    name: 'CTCH_Table',
    ref: `A${1}`,
    headerRow: true,
    //The reason we don't show the totals row is the sum can be misleading
    //If you have a settlement whose population is covered with out of boundary hf's, then the totals
    //won't be the same as the settlement totals
    totalsRow: false,
    columns,
    rows,
  });

  finishPrepareSheet(settlementSheet, table, columns);

  return settlementSheet;
}

function addFixedPostHF(
  boundaryData: BoundaryDataClass,
  hfFixedPost: GeoJsonHealthFacility,
  logger: NGXLogger
): Array<ExcelCatchmentRowData> {
  if (hfFixedPost.properties.type != 'fixed_post') {
    logger.error(
      `HF is not fixed post! -- ${hfFixedPost.properties.global_id}`
    );
    return [];
  }

  const children = (
    boundaryData.hfChildMap.get(hfFixedPost.properties.global_id) || []
  ).filter((hf) => hf.properties.services.includes(RI_SERVICE));
  children.sort((hfA, hfB) =>
    hfA.properties.name.localeCompare(hfB.properties.name)
  );

  const rows: Array<ExcelCatchmentRowData> = [];

  rows.push(
    ...addSettlementRows(boundaryData, hfFixedPost, hfFixedPost, logger)
  );

  for (const outreachSite of children) {
    //Should never happen...
    if (outreachSite.properties.type != 'outreach') {
      logger.error(
        `Child HF is not outreach! -- ${outreachSite.properties.global_id}`
      );
      continue;
    }
    rows.push(
      ...addSettlementRows(boundaryData, hfFixedPost, outreachSite, logger)
    );
  }

  return rows;
}

function addSettlementRows(
  boundaryData: BoundaryDataClass,
  fixedPostHf: GeoJsonHealthFacility,
  //can be the outreach hf or the same as fixedp ost
  catchmentHf: GeoJsonHealthFacility,
  logger: NGXLogger
): Array<ExcelCatchmentRowData> {
  const catchment = boundaryData.getCatchmentForHf(
    catchmentHf.properties.global_id,
    true,
    true
  );

  const settlementRows: Array<ExcelCatchmentRowData> = [];

  for (const ci of catchment) {
    const primaryNames = boundaryData.getPrimaryNamesForSettlementPart(
      ci.properties.settlement_part,
      true
    );

    const sp = boundaryData.spMap.get(ci.properties.settlement_part)!;

    for (const pn of primaryNames) {
      const inBoundary =
        pn.properties.boundary_polygon == boundaryData.boundaryId;
      const ciPop: CatchmentPopulation = {
        computedPop: getCiComputedPop(pn, sp, ci),
        estimatedPop: getCiEstimatedPopIfExists(pn, ci),
        estimatedGisPop: getCiEstimatedGisPop(pn, sp, ci),
      };
      const boundary = boundaryData.bMap.get(pn.properties.boundary_polygon)!;

      const schedule = formatFrequencyOrDays(catchmentHf.properties);

      const row: ExcelCatchmentRowData = {
        catchmentPopulationInsideBoundary: inBoundary
          ? ciPop
          : DEFAULT_CATCHMENT_POPULATION,
        catchmentPopulationOutsideBoundary: inBoundary
          ? DEFAULT_CATCHMENT_POPULATION
          : ciPop,

        distanceHFOutreachSite:
          catchmentHf.properties.type == 'outreach'
            ? safeDistance(catchmentHf, fixedPostHf, 0)
            : ('' as unknown as number),
        distanceSettlementHf: safeDistance(catchmentHf, pn, 0),
        fpName: fixedPostHf.properties.name,
        outreachName:
          catchmentHf.properties.type == 'outreach'
            ? catchmentHf.properties.name
            : '',
        hfType: catchmentHf.properties.type,
        settlementName: pn.properties.name,
        settlementBoundaryName: boundary.properties.name,
        settlementPopulationPercentageAssignedToHF:
          ci.properties.population_perc,
        schedule,
      };

      if (catchmentHf.properties.type == 'outreach') {
        row.outreachName = catchmentHf.properties.name;
      }

      settlementRows.push(row);
    }
  }

  settlementRows.sort((r1, r2) =>
    r1.settlementName!.localeCompare(r2.settlementName!)
  );

  return settlementRows;
}

/*
This is the data needed to output a row in the GMT - Catchments worksheet
*/
export function buildCatchmentRowList(
  boundaryData: BoundaryDataClass,
  logger: NGXLogger
): Array<ExcelCatchmentRowData> {
  const rows: Array<ExcelCatchmentRowData> = [];
  const fixedPosts = boundaryData
    .getHfFixedPost()
    .filter((hf) => hf.properties.services.includes('Routine Immunization'));
  fixedPosts.sort((hfA, hfB) =>
    hfA.properties.name.localeCompare(hfB.properties.name)
  );

  for (const fp of fixedPosts) {
    rows.push(...addFixedPostHF(boundaryData, fp, logger));
  }

  rows.push(...addMobileItems(boundaryData, logger));

  return rows;
}

function addMobileItems(
  boundaryData: BoundaryDataClass,
  logger: NGXLogger
): Array<ExcelCatchmentRowData> {
  let rows: Array<ExcelCatchmentRowData> = [];

  for (const [snId, uncoveredPop] of getMobileItems(boundaryData)) {
    const pn = boundaryData.snMap.get(snId)!;

    const sp = boundaryData.spMap.get(pn.properties.settlement_part!)!;

    const boundary = boundaryData.bMap.get(pn.properties.boundary_polygon)!;

    const row: ExcelCatchmentRowData = {
      catchmentPopulationInsideBoundary: uncoveredPop,

      fpName: 'Mobile',
      hfType: 'mobile',
      settlementName: pn.properties.name,
      settlementBoundaryName: boundary.properties.name,
      schedule: 'N/A',
      outreachName: NO_VALUE,
      catchmentPopulationOutsideBoundary: _.cloneDeep(
        DEFAULT_CATCHMENT_POPULATION
      ),
      distanceHFOutreachSite: '' as unknown as number,
      distanceSettlementHf: '' as unknown as number,
      settlementPopulationPercentageAssignedToHF:
        (100.0 * uncoveredPop.computedPop) / getSpComputedPop(sp, NON_ZERO_POP),
    };

    rows.push(row);
  }

  rows.sort((r1, r2) => r1.settlementName!.localeCompare(r2.settlementName!));

  return rows;
}
