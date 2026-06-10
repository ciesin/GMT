import { Workbook, Buffer } from "exceljs";
import { NGXLogger } from "ngx-logger";
import _ from "lodash";
import { BoundaryDataClass } from "@services/geo/BoundaryDataClass";
import { buildTargetPopulationSheet } from "./target-population";
import { buildCaForServicesSheet } from "./catchment-area-for-services";
import { buildBackgroundAndServicesSheet } from "./background-and-services";

export interface RewExportSheet {
    fileName: string;
    excelData: Buffer;
}

/*
Returns 1 REW Excel sheet per Health facility

Grouped in map boundaryId => list of rews
 */
export async function createRewExcelSheets(
    allBoundaryData: Map<string, BoundaryDataClass>,
    boundaryIds: Array<string>,
    logger: NGXLogger,
    returnBuffers: Map<string, Array<RewExportSheet>>
): Promise<void> {


    //const returnBuffers: Map<string, Array<RewExportSheet>> = new Map();

    for (const boundaryId of boundaryIds) {

        const retArray: Array<RewExportSheet> = [];
        const boundaryData = allBoundaryData.get(boundaryId)!;
        const boundaryObj = boundaryData.bMap.get(boundaryId)!;
        const boundaryName = boundaryObj.properties.name;
        const boundaryParentObj = boundaryData.bMap.get(boundaryObj.properties.boundary_polygon)!;

        for (const hf of boundaryData.hfList) {

            if (hf.properties.type != "fixed_post") {
                continue;
            }
            if (hf.properties.boundary_polygon != boundaryId) {
                continue;
            }
            const workbook = new Workbook();

            const backgroundAndServices = workbook.addWorksheet("GMT Background and Services",);

            buildBackgroundAndServicesSheet(backgroundAndServices, hf, boundaryObj, boundaryParentObj, logger);

            const targetPopulationGis = workbook.addWorksheet("GMT Target Population - GIS");

            buildTargetPopulationSheet(targetPopulationGis, hf, boundaryData, true, logger);

            const targetPopulationEst = workbook.addWorksheet("GMT Target Population - Estimated");

            buildTargetPopulationSheet(targetPopulationEst, hf, boundaryData, false, logger);

            const caForServices = workbook.addWorksheet("GMT Catchment Area for Services");
            buildCaForServicesSheet(caForServices, hf, boundaryData, logger);

            //Add title to e1
            const workSheetCount = workbook.worksheets.length;
            for (let wsIdx = 1; wsIdx <= 4; ++wsIdx) {
                //1 based index
                const ws = workbook.getWorksheet(wsIdx);
                if (_.isNil(ws)) {
                    logger.warn(`Did not find wsIdx ${wsIdx}`);
                    continue;
                }
                const titleCell = ws.getCell(1, 5);
                if (_.isNil(titleCell)) {
                    logger.warn(`Title cell not found for ${wsIdx}`);
                    continue;
                }
                titleCell.value = "GMT Export"
                titleCell.font = { bold: true, size: 18 };

            }

            // write to a new buffer
            const buffer = await workbook.xlsx.writeBuffer();
            retArray.push({
                fileName: `REW_${boundaryName}_${hf.properties.name}.xlsx`,
                excelData: buffer,
            });


        }

        returnBuffers.set(boundaryId, retArray);
    }
}



