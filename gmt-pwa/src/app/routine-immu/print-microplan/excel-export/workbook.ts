//Functions that assemble the excel documents

import { BoundaryDataClass } from "@services/geo/BoundaryDataClass";
import { Workbook, Buffer } from "exceljs";
import _ from "lodash";
import { NGXLogger } from "ngx-logger";
import { BoundaryData } from "src/app/utils/export/pdf";
import { buildCatchmentRowList, buildCatchmentSheet, ExcelCatchmentRowData } from "./sheet-catchments";
import { buildHfCatchmentRowList, buildHfCatchmentSheet, ExcelHfCatchmentRowData } from "./sheet-hf-catchment";
import { buildHfRowList, buildHfSheet, ExcelHfRowData } from "./sheet-hfs";
import { buildBoundaryRowList, buildBoundarySheet, ExcelBoundaryRowData } from "./sheet-overview";
import { buildSettlementRowList, buildSettlementSheet, ExcelSettlementRowData } from "./sheet-settlements";

/*
1 xlsx for all boundaries
 */
export async function createSingleExcel(
    allBoundaryData: Map<string, BoundaryDataClass>,
    boundaryIds: Array<string>,
    logger: NGXLogger
): Promise<Array<Buffer>> {

    const workbook = new Workbook();

    const allHfCatchmentRowData: Array<ExcelHfCatchmentRowData> = [];
    const allCatchmentRowData: Array<ExcelCatchmentRowData> = [];
    const allHfRowData: Array<ExcelHfRowData> = [];
    const allSettlementRowData: Array<ExcelSettlementRowData> = [];
    const allBoundaryRowData: Array<ExcelBoundaryRowData> = [];

    const allBoundaryLabels: Array<Array<string>> = [];

    for (const boundaryId of boundaryIds) {

        const boundaryData = allBoundaryData.get(boundaryId)!;

        const hfCatchmentRowData = buildHfCatchmentRowList(boundaryData, logger);
        allBoundaryLabels.push(boundaryData.getBoundaryLabels(boundaryId));
        allHfCatchmentRowData.push(...hfCatchmentRowData);

        const hfRowData = buildHfRowList(boundaryData, logger);
        for (const hfData of hfRowData) {
            if (_.isNil(hfData)) {
                continue;
            }
            allHfRowData.push(hfData);
        }

        const settlementRowData = buildSettlementRowList(boundaryData, logger);
        allSettlementRowData.push(...settlementRowData);

        const boundaryRowData = buildBoundaryRowList(boundaryData, logger);
        allBoundaryRowData.push(...boundaryRowData);

        const catchmentRowData = buildCatchmentRowList(boundaryData, logger);
        allCatchmentRowData.push(...catchmentRowData);
    }


    buildBoundarySheet(workbook, allBoundaryRowData, logger);
    buildHfSheet(workbook, allHfRowData, logger);
    buildSettlementSheet(workbook, allSettlementRowData, logger);
    buildCatchmentSheet(workbook, allCatchmentRowData, logger);
    buildHfCatchmentSheet(workbook, allHfCatchmentRowData, allBoundaryLabels);

    // write to a new buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return [buffer];
}

/*
1 xlsx per selected boundary
*/
export async function createBoundaryExcel(
    //boundaryId => boundary data
    allBoundaryData: Map<string, BoundaryDataClass>,
    boundaryIds: Array<string>,
    logger: NGXLogger
): Promise<Array<Buffer>> {

    //logger.info(allBoundaryData, boundaryIds);

    return Promise.all(boundaryIds.map(boundaryId => {

        const workbook = new Workbook();

        const boundaryData = allBoundaryData.get(boundaryId)!;

        const boundaryRowData = buildBoundaryRowList(boundaryData, logger);
        buildBoundarySheet(workbook, boundaryRowData, logger);

        const hfRowData = buildHfRowList(boundaryData, logger);
        buildHfSheet(workbook, hfRowData, logger);

        const settlementRowData = buildSettlementRowList(boundaryData, logger);
        buildSettlementSheet(workbook, settlementRowData, logger);

        const catchmentRowData = buildCatchmentRowList(boundaryData, logger);
        buildCatchmentSheet(workbook, catchmentRowData, logger);

        const hfCatchmentRowData = buildHfCatchmentRowList(boundaryData, logger);
        const allBoundaryLabels: Array<Array<string>> = [];
        allBoundaryLabels.push(boundaryData.getBoundaryLabels(boundaryId));
        buildHfCatchmentSheet(workbook, hfCatchmentRowData, allBoundaryLabels);

        // write to a new buffer
        return workbook.xlsx.writeBuffer();
    }));
}
