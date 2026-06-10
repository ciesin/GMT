import { Workbook, Worksheet } from 'exceljs';

import { AppConfigService } from 'src/app/utils/app-config.service';
import {
  ALL_HEALTH_FACILITY_SERVICES,
  ALL_PROBLEMATIC_OPTIONS,
  ALL_UNINHABITED_OPTIONS,
  GeoJsonHealthFacility,
  GeoJsonHealthFacilityProperties,
  GeoJsonSettlementNameProperties,
  HealthFacilityType,
} from 'src/app/utils/server-interfaces/GeoJson';
import {
  formatDaysAsCSL,
  formatFrequencyOrDays,
  formatStrategy,
  getNumberOrDefault,
} from 'src/app/utils/string-formatting';
import {
  finishPrepareSheet,
  NO_VALUE,
  TableColumnPropertiesExtra,
  trimAllStrings,
} from './utils';

import {
  CatchmentPopulation,
  DEFAULT_CATCHMENT_POPULATION,
  inlineAddCatchmentPop,
} from '@services/vector_layer/single-hf-processing.service';
import _ from 'lodash';
import { NGXLogger } from 'ngx-logger';
import { BoundaryDataClass } from 'src/app/services/geo/BoundaryDataClass';
import { safeDistance } from 'src/app/utils/coords';
import {
  calculatePartialCatchmentInfo,
  getCiComputedPop,
  getCiEstimatedGisPop,
  getCiEstimatedPopIfExists,
  getSnEstimatedPop,
  getSpComputedPop,
} from 'src/app/utils/server-interfaces/utils/indicator.util';
import { ExcelCatchmentRowData } from './sheet-catchments';

export interface ExcelHfCatchmentRowData {
  isAggRow: boolean;
  hfBoundaryLabels: Array<string>;
  hfType?: HealthFacilityType;

  //for FP and outreach, will be the FP or the parent
  fpProperties?: GeoJsonHealthFacilityProperties;

  //Either the FP or Outreach
  hfProperties?: GeoJsonHealthFacilityProperties;

  hfLat?: number;
  hfLon?: number;

  snProperties?: GeoJsonSettlementNameProperties;
  snLat?: number;
  snLon?: number;

  settlementBoundaryLabels?: Array<string>;

  hfName: string;
  outreachName?: string;
  settlementName?: string;

  catchmentPopulationInsideBoundary: CatchmentPopulation;
  catchmentPopulationOutsideBoundary: CatchmentPopulation;

  //If settlement sn/pn boundary == hf catchment boundary
  settlementWithinHfBoundary?: boolean | null;

  settlementComputedPopulation?: number;
  settlementFieldEstimatedPopulation?: number;
  //Field_estimate_computed_pop_difference
  settlementPopulationPercentageAssignedToHF?: number;
  distanceSettlementHf?: number;
  distanceHFOutreachSite?: number;
}

export function buildHfCatchmentSheet(
  workbook: Workbook,
  rowData: Array<ExcelHfCatchmentRowData>,
  //the admin boundary labels, should have same # of rows as rowData
  boundaryLabels: Array<Array<string>>
): Worksheet {
  //

  const extraHeaderRows = 5;
  const hfCatchmentsSheet = workbook.addWorksheet('HF_catchments', {
    views: [
      {
        state: 'frozen',
        ySplit: 1 + extraHeaderRows,
      },
    ],
  });

  const LEVEL_TO_LABEL = AppConfigService.get_level_to_label();
  const operatingBoundaryLevelName =
    LEVEL_TO_LABEL[AppConfigService.conf.generic.operational_boundary_level];

  const columns: Array<TableColumnPropertiesExtra> = [
    {
      name: 'Index',
      filterButton: true,
    },
    {
      name: 'HF Name',
      filterButton: true,
    },
  ];

  const NA_BOUNDARY: Array<string> = [];

  for (
    let i = 1;
    i <= AppConfigService.conf.generic.operational_boundary_level;
    ++i
  ) {
    columns.push({ name: `HF ${LEVEL_TO_LABEL[i]}`, filterButton: true });

    NA_BOUNDARY.push(NO_VALUE);
  }

  //0 based indexes, inclusive
  const rewStarts: Array<number> = [];
  const rewStops: Array<number> = [];

  rewStarts.push(columns.length);
  rewStops.push(columns.length);
  columns.push(
    ...[
      { name: 'Health Facility (REW)' },

      //Outreach or Fixed post lat/lon
      { name: 'Latitude' },
      { name: 'Longitude' },
      { name: 'Alternative Names HF' },

      { name: 'Ownership', filterButton: true },

      //This is level of care
      { name: 'Type', filterButton: true },
      { name: 'Primary Type', filterButton: true },

      { name: 'Village/Settlement Name', filterButton: true },
      { name: 'ALT Village/Settlement Name', filterButton: true },
      { name: 'Latitude (Settlement)', numFmt: '0.00000' },
      { name: 'Longitude (Settlement)', numFmt: '0.00000' },
      //{ name: "Frequency of Session", filterButton: true },
    ]
  );

  for (
    let i = 1;
    i <= AppConfigService.conf.generic.operational_boundary_level;
    ++i
  ) {
    columns.push({
      name: `Settlement ${LEVEL_TO_LABEL[i]}`,
      filterButton: true,
    });
  }

  columns.push({
    name: `Settlement In HF ${operatingBoundaryLevelName}?`,
    filterButton: true,
  });

  rewStarts.push(columns.length);
  columns.push(
    ...[
      //blank rew fields
      { name: 'Village/Settlement (REW)', filterButton: false },
      { name: 'Operational settlement name (REW)', filterButton: true },
      { name: 'Primary Settlement (REW)', filterButton: true },
      { name: 'Settlement Type (Urban/ Rural) (REW)', filterButton: false },
      { name: 'Fixed/Outreach/Mobile (REW)', filterButton: false },
      {
        name: 'Type of Immunization Sessions (FS, OS1, OS2, etc.) (REW)',
        filterButton: false,
      },
    ]
  );
  rewStops.push(columns.length - 1);

  columns.push(
    ...[
      //This duplicates the type column
      { name: 'Fixed/Outreach/Mobile  (GMT)', filterButton: true },
      { name: 'Outreach Site Name (GMT)', filterButton: true },

      //Days just for outreach
      { name: 'Days of Routine Immunization (fixed post)', filterButton: true },
    ]
  );

  rewStarts.push(columns.length);
  rewStops.push(columns.length);

  columns.push(
    ...[
      {
        name: 'Days of Routine Immunization (fixed post) (REW)',
        filterButton: true,
      },
      { name: 'Transport', filterButton: true },
      //In case of weekly this is the Days comma seperated
      { name: 'Frequency of outreach sessions', filterButton: true },

      { name: 'POP GIS', filterButton: true, numFmt: '0' },
      {
        name: 'ESTIMATED POP (Entered in GMT)',
        filterButton: true,
        numFmt: '0',
      },
      { name: 'POP DIFF', filterButton: true, numFmt: '0' },
    ]
  );

  rewStarts.push(columns.length);
  rewStops.push(columns.length);
  columns.push(
    ...[
      { name: 'Total Population (REW)', filterButton: false },

      {
        name: 'Catchment Population Total (GIS POP)',
        filterButton: true,
        numFmt: '0',
      },
      {
        name: 'Catchment Population Total (EST POP)',
        filterButton: true,
        numFmt: '0',
      },
      {
        name: 'Catchment Population Total (EST POP + GIS where EST POP is missing)',
        filterButton: true,
        numFmt: '0',
      },
    ]
  );

  rewStarts.push(columns.length);
  rewStops.push(columns.length);

  columns.push(
    ...[
      { name: 'Catchment Population Total (REW)', filterButton: false },
      {
        name: `Catchment Population Inside HF ${operatingBoundaryLevelName}`,
        filterButton: true,
        numFmt: '0',
      },
      {
        name: `Catchment Population Outside HF ${operatingBoundaryLevelName}`,
        filterButton: true,
        numFmt: '0',
      },

      {
        name: '% of Settlement Population Assigned To HF',
        filterButton: true,
        numFmt: '0.0',
      },
      { name: 'Distance Settlement HF (m)', filterButton: true, numFmt: '0' },
      { name: 'Distance HF OutreachSite (m)', filterButton: true, numFmt: '0' },
    ]
  );

  //Uninhabited flags
  columns.push(
    ...ALL_UNINHABITED_OPTIONS.map((uo) => {
      return { name: `Uninhabited - ${uo}`, filterButton: true };
    })
  );

  //Problematic flags
  columns.push(
    ...ALL_PROBLEMATIC_OPTIONS.map((uo) => {
      return { name: uo, filterButton: true };
    })
  );

  rewStarts.push(columns.length);
  columns.push(
    ...[
      { name: 'Hard to Reach/ Nomadic/ Riverine (REW)', filterButton: false },
      { name: 'ANC (REW)', filterButton: false },
      { name: 'Family Planning (REW)', filterButton: false },
      { name: 'Labour & Delivery (REW)', filterButton: false },
    ]
  );
  rewStops.push(columns.length - 1);

  for (const service of ALL_HEALTH_FACILITY_SERVICES) {
    columns.push({ name: service, filterButton: true });
  }

  const rows = rowData.map((excelRowData, index) => {
    return mapRowDataToExcelRow(
      excelRowData as Required<ExcelHfCatchmentRowData>,
      NA_BOUNDARY,
      index
    );
  });

  trimAllStrings(rows);

  const table = hfCatchmentsSheet.addTable({
    name: 'Settlements',
    ref: `A${1 + extraHeaderRows}`,
    headerRow: true,
    totalsRow: true,
    columns,
    rows,
  });

  finishPrepareSheet(hfCatchmentsSheet, table, columns);

  colorCodeRows(extraHeaderRows, hfCatchmentsSheet, rowData);

  //Now add the title
  const titleParts: Array<string> = [];
  for (const bLabel of boundaryLabels) {
    titleParts.push(bLabel.join('/'));
  }
  const title = `Microplan for ${operatingBoundaryLevelName} ${titleParts.join(
    ', '
  )}`;

  hfCatchmentsSheet.mergeCells(1, 2, 1, 12);
  const titleCell = hfCatchmentsSheet.getCell(1, 2);
  titleCell.value = title;
  titleCell.font = {
    name: 'Calibri (Body)',
    family: 1,
    size: 18,
    bold: true,
  };
  hfCatchmentsSheet.getRow(1).height = 23.25;

  //https://github.com/novelt/GMT/issues/2846 REW rows light grey
  const titleRow = extraHeaderRows + 1;
  console.assert(titleRow == 6);
  for (let i = 0; i < rewStarts.length; ++i) {
    //once based indexes
    //hfCatchmentsSheet.mergeCells(5, rewStarts[i] + 1, 5, rewStops[i] + 1);
    for (
      let cellCol = rewStarts[i] + 1;
      cellCol <= rewStops[i] + 1;
      cellCol += 1
    ) {
      const rewCell = hfCatchmentsSheet.getCell(titleRow, cellCol);
      rewCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'B7B7B7' },
      };
    }
  }

  /*
    https://github.com/novelt/GMT/issues/2826
    No merged REW columns
    for(let i = 0; i < rewStarts.length; ++i) {
      //row 5
      //once based indexes
      hfCatchmentsSheet.mergeCells(5, rewStarts[i] + 1, 5, rewStops[i] + 1);
      const rewCell = hfCatchmentsSheet.getCell(5, rewStarts[i] + 1);
      rewCell.value = "REW";
      rewCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: "B7B7B7" }
      };
    }
    */

  return hfCatchmentsSheet;
}

export function colorCodeRows(
  extraHeaderRows: number,
  hfCatchmentsSheet: Worksheet,
  rowData: Array<ExcelHfCatchmentRowData | ExcelCatchmentRowData>
) {
  for (const [idx, row] of rowData.entries()) {
    if ('isAggRow' in row && !row.isAggRow) {
      continue;
    }
    //1 based and skip the title row
    const excelRowIndex = extraHeaderRows + idx + 2;

    let color = '548235';

    if (!row.hfType) {
      //main
      color = 'B4C6E7';
    } else if (row.hfType == 'fixed_post') {
      color = '548235';
    } else if (row.hfType == 'mobile') {
      color = 'E2EFDA';
    } else if (row.hfType == 'outreach') {
      color = 'A9D08E';
    }

    hfCatchmentsSheet.getRow(excelRowIndex).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: color },
    };
  }
}

function addFixedPostHF(
  boundaryData: BoundaryDataClass,
  hfFixedPost: GeoJsonHealthFacility,
  logger: NGXLogger
): Array<ExcelHfCatchmentRowData> {
  if (hfFixedPost.properties.type != 'fixed_post') {
    logger.error(
      `HF is not fixed post! -- ${hfFixedPost.properties.global_id}`
    );
    return [];
  }

  const children = (
    boundaryData.hfChildMap.get(hfFixedPost.properties.global_id) || []
  ).filter((hf) => hf.properties.services.includes('Routine Immunization'));
  children.sort((hfA, hfB) =>
    hfA.properties.name.localeCompare(hfB.properties.name)
  );

  const rows: Array<ExcelHfCatchmentRowData> = [];

  //Dark green fixed post row
  const mainHfRow: ExcelHfCatchmentRowData = {
    hfBoundaryLabels: boundaryData.getBoundaryLabels(
      hfFixedPost.properties.boundary_polygon
    ),
    hfName: hfFixedPost.properties.name,
    isAggRow: true,
    catchmentPopulationInsideBoundary: _.cloneDeep(
      DEFAULT_CATCHMENT_POPULATION
    ),
    catchmentPopulationOutsideBoundary: _.cloneDeep(
      DEFAULT_CATCHMENT_POPULATION
    ),

    hfLat: hfFixedPost.geometry.coordinates[1],
    hfLon: hfFixedPost.geometry.coordinates[0],

    fpProperties: hfFixedPost.properties,
    settlementWithinHfBoundary: null,
  };

  rows.push(mainHfRow);

  rows.push(
    ...addSettlementRows(
      boundaryData,
      hfFixedPost,
      hfFixedPost,
      mainHfRow,
      logger
    )
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
      ...addSettlementRows(
        boundaryData,
        hfFixedPost,
        outreachSite,
        mainHfRow,
        logger
      )
    );
  }

  return rows;
}

/*
This adds the outreach or fixed post summary row +
the entries for the catchment items (which are shown as a settlement)
*/

function addSettlementRows(
  boundaryData: BoundaryDataClass,
  fixedPostHf: GeoJsonHealthFacility,
  //can be the outreach hf or the same as fixedpost
  catchmentHf: GeoJsonHealthFacility,
  mainHfRow: ExcelHfCatchmentRowData,
  logger: NGXLogger
): Array<ExcelHfCatchmentRowData> {
  //Light green totals for outreach
  const hfRow: ExcelHfCatchmentRowData = {
    isAggRow: true,
    hfBoundaryLabels: mainHfRow.hfBoundaryLabels,
    hfName: mainHfRow.hfName,
    hfType: catchmentHf.properties.type,
    hfLat: catchmentHf.geometry.coordinates[1],
    hfLon: catchmentHf.geometry.coordinates[0],
    hfProperties: catchmentHf.properties,
    fpProperties: fixedPostHf.properties,

    catchmentPopulationInsideBoundary: _.cloneDeep(
      DEFAULT_CATCHMENT_POPULATION
    ),
    catchmentPopulationOutsideBoundary: _.cloneDeep(
      DEFAULT_CATCHMENT_POPULATION
    ),
  };

  if (fixedPostHf.properties.global_id != catchmentHf.properties.global_id) {
    hfRow.distanceHFOutreachSite = safeDistance(fixedPostHf, catchmentHf);
  }

  if (catchmentHf.properties.type == 'outreach') {
    hfRow.outreachName = catchmentHf.properties.name;
  }

  const catchment = boundaryData.getCatchmentForHf(
    catchmentHf.properties.global_id,
    true,
    true
  );

  const settlementRows: Array<ExcelHfCatchmentRowData> = [];

  for (const ci of catchment) {
    const primaryNames = boundaryData.getPrimaryNamesForSettlementPart(
      ci.properties.settlement_part,
      true
    );

    const sp = boundaryData.spMap.get(ci.properties.settlement_part)!;

    for (const pn of primaryNames) {
      const inBoundary =
        pn.properties.boundary_polygon == boundaryData.boundaryId;
      const ciComputedPop = getCiComputedPop(pn, sp, ci);
      const ciEstComputedPop = getCiEstimatedGisPop(pn, sp, ci);
      const ciEstPop = getCiEstimatedPopIfExists(pn, ci);

      const catchmentPopulationInsideBoundary: CatchmentPopulation =
        _.cloneDeep(DEFAULT_CATCHMENT_POPULATION);
      const catchmentPopulationOutsideBoundary: CatchmentPopulation =
        _.cloneDeep(DEFAULT_CATCHMENT_POPULATION);

      const catchToSet = inBoundary
        ? catchmentPopulationInsideBoundary
        : catchmentPopulationOutsideBoundary;
      catchToSet.estimatedPop = ciEstPop;
      catchToSet.estimatedGisPop = ciEstComputedPop;
      catchToSet.computedPop = ciComputedPop;

      const row: Required<ExcelHfCatchmentRowData> = {
        isAggRow: false,
        catchmentPopulationInsideBoundary,
        catchmentPopulationOutsideBoundary,

        //distanceHFOutreachSite: hfRow.distanceHFOutreachSite,
        distanceSettlementHf: safeDistance(catchmentHf, pn, 0),
        hfBoundaryLabels: hfRow.hfBoundaryLabels,
        //For an outreach this is the parent health facility
        hfName: hfRow.hfName,
        outreachName: hfRow.outreachName!,
        hfType: hfRow.hfType!,
        settlementBoundaryLabels: boundaryData.getBoundaryLabels(
          pn.properties.boundary_polygon
        ),
        settlementComputedPopulation: getSpComputedPop(sp),
        settlementName: pn.properties.name,
        settlementPopulationPercentageAssignedToHF:
          ci.properties.population_perc,
        settlementWithinHfBoundary: inBoundary,

        hfProperties: catchmentHf.properties,
        fpProperties: fixedPostHf.properties,
        hfLat: catchmentHf.geometry.coordinates[1],
        hfLon: catchmentHf.geometry.coordinates[0],
        settlementFieldEstimatedPopulation: NaN,
        distanceHFOutreachSite: NaN,

        snProperties: pn.properties,
        snLat: pn.geometry.coordinates[1],
        snLon: pn.geometry.coordinates[0],
      };

      if (catchmentHf.properties.type == 'outreach') {
        row.outreachName = catchmentHf.properties.name;
      }

      if (
        _.isFinite(pn.properties.estimated_pop) &&
        pn.properties.estimated_pop! >= 0
      ) {
        row.settlementFieldEstimatedPopulation = getSnEstimatedPop(pn, sp);
      }
      settlementRows.push(row);

      inlineAddCatchmentPop(
        hfRow.catchmentPopulationOutsideBoundary,
        row.catchmentPopulationOutsideBoundary
      );
      inlineAddCatchmentPop(
        hfRow.catchmentPopulationInsideBoundary,
        row.catchmentPopulationInsideBoundary
      );
      inlineAddCatchmentPop(
        mainHfRow.catchmentPopulationOutsideBoundary,
        row.catchmentPopulationOutsideBoundary
      );
      inlineAddCatchmentPop(
        mainHfRow.catchmentPopulationInsideBoundary,
        row.catchmentPopulationInsideBoundary
      );
    }
  }

  settlementRows.sort((r1, r2) =>
    r1.settlementName!.localeCompare(r2.settlementName!)
  );

  return [hfRow, ...settlementRows];
}

export function buildHfCatchmentRowList(
  boundaryData: BoundaryDataClass,
  logger: NGXLogger
): Array<ExcelHfCatchmentRowData> {
  const rows: Array<ExcelHfCatchmentRowData> = [];
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
): Array<ExcelHfCatchmentRowData> {
  const mobileRow: ExcelHfCatchmentRowData = {
    hfBoundaryLabels: boundaryData.getBoundaryLabels(boundaryData.boundaryId),
    hfName: 'Mobile',
    isAggRow: true,
    hfType: 'mobile',
    catchmentPopulationInsideBoundary: _.cloneDeep(
      DEFAULT_CATCHMENT_POPULATION
    ),
    catchmentPopulationOutsideBoundary: _.cloneDeep(
      DEFAULT_CATCHMENT_POPULATION
    ),
  };

  let rows: Array<ExcelHfCatchmentRowData> = [];

  for (const [snId, uncoveredPop] of getMobileItems(boundaryData)) {
    const pn = boundaryData.snMap.get(snId)!;

    const sp = boundaryData.spMap.get(pn.properties.settlement_part!)!;

    const row: ExcelHfCatchmentRowData = {
      isAggRow: false,
      catchmentPopulationInsideBoundary: uncoveredPop,
      catchmentPopulationOutsideBoundary: _.cloneDeep(
        DEFAULT_CATCHMENT_POPULATION
      ),
      hfBoundaryLabels: mobileRow.hfBoundaryLabels,
      hfName: mobileRow.hfName,

      hfType: mobileRow.hfType,
      settlementBoundaryLabels: boundaryData.getBoundaryLabels(
        pn.properties.boundary_polygon
      ),
      settlementComputedPopulation: getSpComputedPop(sp),
      settlementName: pn.properties.name,
      settlementWithinHfBoundary: true,
      snProperties: pn.properties,
      snLat: pn.geometry.coordinates[1],
      snLon: pn.geometry.coordinates[0],
    };

    if (
      _.isFinite(pn.properties.estimated_pop) &&
      pn.properties.estimated_pop! >= 0
    ) {
      row.settlementFieldEstimatedPopulation = getSnEstimatedPop(pn, sp);
    }
    rows.push(row);

    inlineAddCatchmentPop(
      mobileRow.catchmentPopulationInsideBoundary,
      row.catchmentPopulationInsideBoundary
    );
  }

  rows.sort((r1, r2) => r1.settlementName!.localeCompare(r2.settlementName!));

  return [mobileRow, ...rows];
}

/**
 * Mobile items in the XLS are basically all the uncovered population
 * @private
 * //[snId, [uncoveredComputedPop, uncoveredEstimatedPop]
 */
export function* getMobileItems(
  boundaryData: BoundaryDataClass
): Generator<[string, CatchmentPopulation], void, void> {
  //First we need the list of settlements in the boundary and their computed pop

  const settlements = boundaryData
    .getBoundaryPrimaryNameSettlementList()
    .filter((sn) => !sn.properties.uninhabited);
  //sn id => uncovered pop
  const setUncoveredPop: Map<string, CatchmentPopulation> = new Map(
    settlements.map((sn) => {
      const key = sn.properties.global_id;
      const sp = boundaryData.spMap.get(sn.properties.settlement_part!)!;
      const popComputed = getSpComputedPop(sp);
      const popEstimated = getSnEstimatedPop(sn, sp);
      const hasEstimatedPop = _.isFinite(sn.properties.estimated_pop);

      const ciList = boundaryData.getCatchmentForSp(
        sp.properties.global_id,
        true,
        true
      );
      const pInfo = calculatePartialCatchmentInfo(sn, ciList);
      const unclaimedComputedPop = Math.round(
        ((100 - pInfo.totalPerc) / 100) * popComputed
      );
      const unclaimedEstimatedPop = Math.round(
        ((100 - pInfo.totalPerc) / 100) * popEstimated
      );

      const unclaimedCatchment: CatchmentPopulation = {
        computedPop: unclaimedComputedPop,
        estimatedGisPop: unclaimedEstimatedPop,
        estimatedPop: hasEstimatedPop ? unclaimedEstimatedPop : null,
      };

      return [key, unclaimedCatchment];
    })
  );

  //Now add the excel row items for everything we have left.  Note this should return
  //the same as ciItemToExcelRowData
  for (const entry of setUncoveredPop.entries()) {
    const [_globalId, unclaimedCatchPop] = entry;

    //If both unclaimed computed pop & estgis pop are near enough to 0, we skip it considering it covered
    if (
      getNumberOrDefault(unclaimedCatchPop.computedPop, 0) < 0.5 &&
      getNumberOrDefault(unclaimedCatchPop.estimatedGisPop, 0) < 0.5
    ) {
      continue;
    }

    yield entry;
  }
}

/*
This maps any row, either an agg row
or one of the catchment items
*/

function mapRowDataToExcelRow(
  excelRowData: Required<ExcelHfCatchmentRowData>,
  NA_BOUNDARY: Array<string>,
  index: number
): Array<string | number | boolean> {
  const ret: Array<string | number | boolean> = [
    index,

    excelRowData.hfName,
    ...excelRowData.hfBoundaryLabels,

    //Column: Health Facility (REW); blank only for settlements
    formatBoolean(_.isNil(excelRowData.snProperties), NO_VALUE, ''),

    //lat hf
    excelRowData.hfLat,
    //lon hf
    excelRowData.hfLon,

    //alt names hf
    excelRowData.fpProperties
      ? excelRowData.fpProperties.synonyms.join(', ')
      : NO_VALUE,

    //ownership
    formatBoolean(excelRowData.fpProperties?.private, 'Private', 'Public'),

    //Column: Type (level of care in code)
    excelRowData.fpProperties
      ? excelRowData.fpProperties.level_of_care
      : NO_VALUE,

    //excelRowData.frequency ? formatFrequency(excelRowData.frequency) : NO_VALUE,

    //Primary Type
    excelRowData.fpProperties
      ? excelRowData.fpProperties.primary_type
      : NO_VALUE,

    //Village/Settlement Name
    excelRowData.snProperties
      ? excelRowData.snProperties.name || NO_VALUE
      : NO_VALUE,

    //ALT Village/Settlement Name
    excelRowData.snProperties
      ? excelRowData.snProperties.synonyms.join(', ')
      : NO_VALUE,

    //Lat SET
    numberOrNoValue(excelRowData.snLat),

    //LON set
    numberOrNoValue(excelRowData.snLon),

    ...(excelRowData.settlementBoundaryLabels
      ? excelRowData.settlementBoundaryLabels
      : NA_BOUNDARY),

    //STL in HF ward
    formatBoolean(
      excelRowData.settlementWithinHfBoundary === true,
      'Yes',
      'No'
    ),

    //6 blank rew fields related to settlements, we want blank for settlements
    formatBoolean(_.isNil(excelRowData.snProperties), NO_VALUE, ''),
    formatBoolean(_.isNil(excelRowData.snProperties), NO_VALUE, ''),
    formatBoolean(_.isNil(excelRowData.snProperties), NO_VALUE, ''),
    formatBoolean(_.isNil(excelRowData.snProperties), NO_VALUE, ''),
    formatBoolean(_.isNil(excelRowData.snProperties), NO_VALUE, ''),
    formatBoolean(_.isNil(excelRowData.snProperties), NO_VALUE, ''),

    //"Fixed/Outreach/Mobile  (GMT)"
    excelRowData.hfType ? formatStrategy(excelRowData.hfType) : 'All',

    //Outreach Site Name (GMT)
    excelRowData.outreachName || NO_VALUE,

    //Days of Routine Immunization (fp)
    excelRowData?.hfType === 'fixed_post'
      ? formatDaysAsCSL(excelRowData.fpProperties)
      : NO_VALUE,

    //REW Days of RI
    excelRowData?.hfType === 'fixed_post' ? '' : NO_VALUE,
  ];

  //Transport (only applies to outreach)
  if (
    excelRowData.hfProperties &&
    excelRowData.hfProperties.type == 'outreach'
  ) {
    ret.push(excelRowData.hfProperties.transport.join(', '));
  } else {
    ret.push(NO_VALUE);
  }

  ret.push(
    ...[
      //Frequency of outreach sessions
      excelRowData.hfProperties && excelRowData.hfProperties.type == 'outreach'
        ? formatFrequencyOrDays(excelRowData.hfProperties)
        : NO_VALUE,

      //Pop gis sn
      _.isNil(excelRowData.snProperties)
        ? NO_VALUE
        : getFirstFiniteValue([excelRowData.settlementComputedPopulation], ''),

      //est. pop
      _.isNil(excelRowData.snProperties)
        ? NO_VALUE
        : getFirstFiniteValue(
            [excelRowData.settlementFieldEstimatedPopulation],
            ''
          ),

      //diff
      _.isNil(excelRowData.snProperties)
        ? NO_VALUE
        : _.isFinite(excelRowData.settlementComputedPopulation) &&
          _.isFinite(excelRowData.settlementFieldEstimatedPopulation)
        ? excelRowData.settlementComputedPopulation -
          excelRowData.settlementFieldEstimatedPopulation
        : '',

      //rew blank Total Population (REW); blank only for settlements
      formatBoolean(_.isNil(excelRowData.snProperties), NO_VALUE, ''),

      //gis pop (only 1 will have a value)
      sumPositiveValues(
        [
          excelRowData.catchmentPopulationInsideBoundary.computedPop,
          excelRowData.catchmentPopulationOutsideBoundary.computedPop,
        ],
        0
      ),

      //est. can be blank if no estimates
      sumPositiveValues(
        [
          excelRowData.catchmentPopulationInsideBoundary.estimatedPop,
          excelRowData.catchmentPopulationOutsideBoundary.estimatedPop,
        ],
        ''
      ),

      //est/gis pop
      sumPositiveValues(
        [
          excelRowData.catchmentPopulationInsideBoundary.estimatedGisPop,
          excelRowData.catchmentPopulationOutsideBoundary.estimatedGisPop,
        ],
        0
      ),

      //REW catch pop
      '',

      getFirstPositiveValue(
        [excelRowData.catchmentPopulationInsideBoundary.computedPop],
        ''
      ),
      getFirstPositiveValue(
        [excelRowData.catchmentPopulationOutsideBoundary.computedPop],
        ''
      ),
      _.isNil(excelRowData.snProperties)
        ? NO_VALUE
        : getFirstFiniteValue(
            [excelRowData.settlementPopulationPercentageAssignedToHF],
            ''
          ),
      _.isNil(excelRowData.snProperties)
        ? NO_VALUE
        : getFirstFiniteValue([excelRowData.distanceSettlementHf], ''),
      getFirstFiniteValue([excelRowData.distanceHFOutreachSite], NO_VALUE),
    ]
  );

  for (const uo of ALL_UNINHABITED_OPTIONS) {
    if (_.isNil(excelRowData.snProperties)) {
      ret.push(NO_VALUE);
      continue;
    }
    if (excelRowData.snProperties.uninhabited !== true) {
      ret.push(false);
      continue;
    }
    ret.push(uo == excelRowData.snProperties.uninhabited_reason);
  }

  for (const po of ALL_PROBLEMATIC_OPTIONS) {
    if (_.isNil(excelRowData.snProperties)) {
      ret.push(NO_VALUE);
      continue;
    }
    ret.push(excelRowData.snProperties.problematic.includes(po));
  }

  //4 blank rew lines

  //settlement rew
  ret.push(formatBoolean(_.isNil(excelRowData.snProperties), NO_VALUE, ''));
  for (let i = 0; i < 3; ++i) {
    ret.push('');
  }

  //hf services flags
  for (const service of ALL_HEALTH_FACILITY_SERVICES) {
    if (_.isNil(excelRowData.fpProperties)) {
      ret.push(NO_VALUE);
    } else {
      ret.push(excelRowData.fpProperties.services.includes(service));
    }
  }

  return ret;
}

function getFirstFiniteValue(
  values: Array<number>,
  defaultIfNoFinite: number | string
): number | string {
  for (const v of values) {
    if (_.isFinite(v)) {
      return v;
    }
  }

  return defaultIfNoFinite;
}

function sumPositiveValues(
  values: Array<number | null>,
  defaultIfNoFinite: number | string = 0
): number | string {
  let sum = 0;

  for (const v of values) {
    if (_.isFinite(v) && v! > 0) {
      sum += v!;
    }
  }

  if (sum <= 0) {
    return defaultIfNoFinite;
  }

  return sum;
}

function getFirstPositiveValue(
  values: Array<number>,
  defaultIfNoFinite: number | string
): number | string {
  for (const v of values) {
    if (_.isFinite(v) && v > 0) {
      return v;
    }
  }

  return defaultIfNoFinite;
}

function numberOrNoValue(num: number): string | number {
  if (_.isFinite(num)) {
    return num;
  }
  return NO_VALUE;
}

function formatBoolean(
  b: boolean | null,
  yesStr: string,
  noStr: string,
  noValueStr = NO_VALUE
) {
  if (_.isBoolean(b)) {
    if (b) {
      return yesStr;
    } else {
      return noStr;
    }
  } else {
    return noValueStr;
  }
}
