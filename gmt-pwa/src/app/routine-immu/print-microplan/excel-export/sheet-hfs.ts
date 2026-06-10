import { Workbook, Worksheet } from "exceljs";
import { NGXLogger } from "ngx-logger";
import { BoundaryDataClass } from "src/app/services/geo/BoundaryDataClass";
import { CatchmentPopulation, loadHealthFacility } from "src/app/services/vector_layer/single-hf-processing.service";
import { AppConfigService } from "src/app/utils/app-config.service";
import {
    ALL_HEALTH_FACILITY_SERVICES,
    GeoJsonHealthFacility,
    GeoJsonHealthFacilityProperties
} from "src/app/utils/server-interfaces/GeoJson";
import {
    finishPrepareSheet,
    NO_VALUE,
    SUFFIX_EST,
    SUFFIX_EST_GIS,
    SUFFIX_GIS,
    TableColumnPropertiesExtra, trimAllStrings
} from "./utils";
import _ from "lodash";

export interface ExcelHfRowData {


    hfName: string;
    hfAltNames: string;
    hfLong: number;
    hfLat: number;
    hfSetWithGps: boolean | null;
    hfComments: string;
    hfBoundaryLabels: Array<string>;
    performsRI: boolean,
    //# of Settlements of just the HF in question
    totalSettlements: number;
    //# of Settlement of related outreaches
    totalOutreachSettlements: number;
    //gis/computed, estimated, estimated default to computed
    totalCatchmentPop: CatchmentPopulation;
    totalFixedPostCatchmentPop: CatchmentPopulation;
    totalOutreachCatchmentPop: CatchmentPopulation;

    hfProperties: GeoJsonHealthFacilityProperties
}


export function buildHfSheet(
    workbook: Workbook,
    rowData: Array<ExcelHfRowData | null>,
    logger: NGXLogger
): Worksheet {
    //

    const hfSheet = workbook.addWorksheet("GMT - HFs", {
        views: [{
            state: 'frozen',
            ySplit: 1
        }]
    });

    const columns: Array<TableColumnPropertiesExtra> = [
        {
            name: "HF Name",
            filterButton: true
        },
        {
            name: "HF Alternate Name",
            filterButton: true
        },
        {
            name: "HF Comments",
            filterButton: true
        },
        { name: "HF Latitude", filterButton: true, numFmt: "0.00000" },
        { name: "HF Longitude", filterButton: true, numFmt: "0.00000" },
        { name: "HF Set With GPS", filterButton: true},
    ];

    const NA_BOUNDARY: Array<string> = [];

    const LEVEL_TO_LABEL = AppConfigService.get_level_to_label();

    for (let i = 1; i <= AppConfigService.conf.generic.operational_boundary_level; ++i) {
        columns.push({ name: `HF ${LEVEL_TO_LABEL[i]}`, filterButton: true });

        NA_BOUNDARY.push(NO_VALUE);
    }

    columns.push({ name: "RI Strategy", filterButton: true });
    //Not valid to sum because the settlements are not unique
    columns.push({ name: "Total STL FIXED", filterButton: true, numFmt: "0" });
    columns.push({ name: "Total STL OUTREACH", filterButton: true, numFmt: "0" });

    for (const suffix of [SUFFIX_GIS, SUFFIX_EST, SUFFIX_EST_GIS]) {
        columns.push({ name: `Total Catchment ${suffix}`, filterButton: true, numFmt: "0", totalsRowFunction: "sum" });
    }
    for (const suffix of [SUFFIX_GIS, SUFFIX_EST, SUFFIX_EST_GIS]) {
        columns.push({ name: `Total FIXED ${suffix}`, filterButton: true, numFmt: "0", totalsRowFunction: "sum" });
        columns.push({ name: `Total OUTREACH ${suffix}`, filterButton: true, numFmt: "0", totalsRowFunction: "sum" });
    }

    columns.push({ name: "MP Status", filterButton: true });
    columns.push({ name: "Ownership", filterButton: true });

    //level of care
    columns.push({ name: "Type", filterButton: true });
    columns.push({ name: "Primary Type", filterButton: true });
    for (const service of ALL_HEALTH_FACILITY_SERVICES) {
        columns.push({ name: service, filterButton: true });
    }

    const rows = rowData.filter(rd => !_.isNil(rd)).map(excelRowData => {

        if (_.isNil(excelRowData)) {
            throw Error("Should have been filtered out");
        }
        const ret: Array<string | number | boolean | null> = [
            excelRowData.hfName,
            excelRowData.hfAltNames,
            excelRowData.hfComments,

            excelRowData.hfLat,
            excelRowData.hfLong,

            excelRowData.hfSetWithGps,

            ...excelRowData.hfBoundaryLabels,


            excelRowData.performsRI,
            //Total STL FIXED
            excelRowData.totalSettlements,
            excelRowData.totalOutreachSettlements,

            excelRowData.totalCatchmentPop.computedPop,
            excelRowData.totalCatchmentPop.estimatedPop,
            excelRowData.totalCatchmentPop.estimatedGisPop,

            excelRowData.totalFixedPostCatchmentPop.computedPop,
            excelRowData.totalOutreachCatchmentPop.computedPop,
            excelRowData.totalFixedPostCatchmentPop.estimatedPop,
            excelRowData.totalOutreachCatchmentPop.estimatedPop,
            excelRowData.totalFixedPostCatchmentPop.estimatedGisPop,
            excelRowData.totalOutreachCatchmentPop.estimatedGisPop,

            excelRowData.hfProperties.mp_status,
            //Ownership
            excelRowData.hfProperties.private ? "Private" : "Public",

            //Type (type in UI is level of care in the code)
            excelRowData.hfProperties.level_of_care,

            excelRowData.hfProperties.primary_type
        ];

        for (const service of ALL_HEALTH_FACILITY_SERVICES) {
            ret.push(excelRowData.hfProperties.services.includes(service))
        }

        return ret;
    });

    trimAllStrings(rows);

    const table = hfSheet.addTable({
        name: 'HF_Table',
        ref: `A${1}`,
        headerRow: true,
        totalsRow: true,
        columns,
        rows
    });

    finishPrepareSheet(hfSheet, table, columns);

    return hfSheet;
}


/**
 * Returns row in the GMT_Hf sheet
 * @param boundaryData
 * @param hfFixedPost
 * @param logger
 * @returns
 */
function addHFRow(
    boundaryData: BoundaryDataClass,
    hfFixedPost: GeoJsonHealthFacility,
    logger: NGXLogger
): ExcelHfRowData | null {

    if (hfFixedPost.properties.type != "fixed_post") {
        logger.error(`HF is not fixed post! -- ${hfFixedPost.properties.global_id}`);
        return null;
    }

    const data = loadHealthFacility({ boundaryData, logger }, hfFixedPost.properties.global_id)!;

    const mainHfRow: ExcelHfRowData = {
        hfBoundaryLabels: boundaryData.getBoundaryLabels(hfFixedPost.properties.boundary_polygon),
        hfName: hfFixedPost.properties.name,
        hfAltNames: data.hf!.properties.synonyms.join(", "),
        hfComments: data.hf!.properties.comments,
        hfLong: data.hf!.geometry.coordinates[0],
        hfLat: data.hf!.geometry.coordinates[1],
        hfSetWithGps: data.hf!.properties.set_with_gps,
        performsRI: hfFixedPost.properties.services.includes("Routine Immunization"),
        totalSettlements: data.settlementCountFixedPost,
        totalOutreachSettlements: data.settlementCountOutreach,
        totalCatchmentPop: data.catchmentPopulation,
        totalFixedPostCatchmentPop: data.catchmentPopulationFixedPost,
        totalOutreachCatchmentPop: data.catchmentPopulationOutreach,
        hfProperties: data.hf!.properties
    };

    return mainHfRow;
}


export function buildHfRowList(
    boundaryData: BoundaryDataClass,
    logger: NGXLogger
): Array<ExcelHfRowData | null> {
    const rows: Array<ExcelHfRowData | null> = [];
    const fixedPosts = boundaryData.getHfFixedPost();
    fixedPosts.sort((hfA, hfB) => hfA.properties.name.localeCompare(hfB.properties.name));

    for (const fp of fixedPosts) {
        rows.push(addHFRow(boundaryData, fp, logger));
    }

    return rows;
}
