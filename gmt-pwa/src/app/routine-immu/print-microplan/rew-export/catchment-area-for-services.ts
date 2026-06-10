import { BoundaryDataClass } from "@services/geo/BoundaryDataClass";
import { Border, Font, Worksheet } from "exceljs";
import { GeoJsonHealthFacility, GeoJsonSettlementName, GeoJsonSettlementPart } from "src/app/utils/server-interfaces/GeoJson";
import { CellFormatter } from "./cell-formatter";
import { getMobileItems } from "../excel-export/sheet-hf-catchment";
import {
    Feature as TurfFeature,
    MultiPolygon as TurfMultiPolygon,
    Point as TurfPoint,
    Polygon as TurfPolygon
} from "@turf/helpers/dist/js/lib/geojson";
import { booleanPointInPolygon, lineString, pointToLineDistance, polygon, Position } from "@turf/turf";
import { NGXLogger } from "ngx-logger";

//const ThickBorder: Border = { style: 'medium', color: { argb: 'FF000000' } };
const ThinBorder: Border = { style: 'thin', color: { argb: 'FF000000' } };

const COL_START = 2;
const ROW_TABLE_START = 5;


const COLUMN_COUNT = 10;

function setTopLabels(caForServices: Worksheet,
    hf: GeoJsonHealthFacility,
    boundaryData: BoundaryDataClass,
    logger: NGXLogger) {

    const labelFont: Partial<Font> = { bold: true };
    const valueFont: Partial<Font> = { bold: false, italic: false };
    const rowsBetweenLabels = 1;

    const cellFormatter = new CellFormatter(caForServices, logger);
    cellFormatter.setRowCol(1, COL_START).setFont(labelFont);

    cellFormatter.setCellValue("Form 2: Catchment area for services");

    //cellFormatter.setCol(8).setFont({ italic: true }, true).setCellValue("©SPHCMB KANO_2024 PHC REW microplan");

    cellFormatter.row += 1 + rowsBetweenLabels;
    cellFormatter.setCol(COL_START)
        .setFont(labelFont, true)
        .setCellValue("Health Facility: ____________________________________");

    cellFormatter.col += 2;
    cellFormatter.setFont(valueFont, true).setCellValue(hf.properties.name);

    cellFormatter.setCol(7).setFont(labelFont, true).setCellValue("Ward: ________________________________");

    const boundaryLabels = boundaryData.getBoundaryLabels(hf.properties.boundary_polygon);

    cellFormatter.col += 1;
    cellFormatter.setFont(valueFont, true).setCellValue(boundaryLabels[boundaryLabels.length - 1].toUpperCase());

    const lastCol = COL_START + COLUMN_COUNT - 1;

    cellFormatter.setCol(lastCol - 2)
        .setFont(labelFont, true).setCellValue("LGA: ________________________________");

    cellFormatter.setCol(lastCol - 1)
    cellFormatter.setFont(valueFont, true).setCellValue(boundaryLabels[boundaryLabels.length - 2].toUpperCase());

}

function setTableLabels(caForServices: Worksheet, logger: NGXLogger) {

    const labelFont: Partial<Font> = { bold: true };
    const cellFormatter = new CellFormatter(caForServices, logger);

    cellFormatter.setRowCol(ROW_TABLE_START, COL_START).setFont(labelFont)
        .setBorders({
            top: ThinBorder, left: ThinBorder, bottom: ThinBorder,
            right: ThinBorder
        })
        .setAlignment({
            wrapText: true,
            vertical: 'middle',
            horizontal: 'center'
        }).setSpanWidthHeight(1, 2)
        .setCellValue("S/N");

    cellFormatter.setRowCol(ROW_TABLE_START, COL_START + 1).setBorders(
        {
            left: ThinBorder,
            right: ThinBorder
        }).setCellValue("Village/Settlement in GMT");

    cellFormatter.setRowCol(ROW_TABLE_START, COL_START + 2)
        .setBorders({ right: ThinBorder, bottom: ThinBorder, left: ThinBorder, top: ThinBorder })
        .setSpanWidthHeight(3, 1)
        .setCellValue("Distance from Health Facility");
    cellFormatter.setRowCol(ROW_TABLE_START, COL_START + 5)
        .setSpanWidthHeight(2, 1)
        .setCellValue("RI");

    cellFormatter.setRowCol(ROW_TABLE_START, COL_START + COLUMN_COUNT - 3)
        .setSpanWidthHeight(1, 1)
        .setCellValue("ANC");

    cellFormatter.setRowCol(ROW_TABLE_START, COL_START + COLUMN_COUNT - 2)
        .setSpanWidthHeight(1, 1)
        .setCellValue("Labour & Delivery");

    cellFormatter.setRowCol(ROW_TABLE_START, COL_START + COLUMN_COUNT - 1)
        .setSpanWidthHeight(1, 1)
        .setBorders({ right: ThinBorder })
        .setCellValue("Family Planning");


    for (let col = COL_START + COLUMN_COUNT - 5; col < COL_START + COLUMN_COUNT; ++col) {
        cellFormatter.setCol(col).setRow(ROW_TABLE_START + 1)
            .setBorders({ right: ThinBorder, bottom: ThinBorder, left: ThinBorder, top: ThinBorder })
            .setCellValue("Yes/No");
    }

    cellFormatter.setRowCol(ROW_TABLE_START + 1, COL_START + COLUMN_COUNT - 4)
        .setSpanWidthHeight(1, 1)
        .setCellValue("Type of Immunization Sessions (FS, OS1, OS2, etc.)");

    cellFormatter.setRowCol(ROW_TABLE_START + 1, COL_START + 2)
        .setSpanWidthHeight(1, 1)
        .setCellValue("Fixed Post (<2km)");

    cellFormatter.setCol(COL_START + 3)
        .setCellValue("Outreach (2-5km)");

    cellFormatter.setCol(COL_START + 4)
        .setCellValue("Mobile (>5km)");
}

function setDimensions(caForServices: Worksheet) {

    caForServices.getColumn(2).width = 5;
    caForServices.getColumn(3).width = 25;
    const lastCol = COL_START + COLUMN_COUNT - 1;

    for (let col = 4; col <= lastCol; ++col) {
        caForServices.getColumn(col).width = 12;
    }

    caForServices.getColumn(8).width = 15;

    caForServices.getRow(5).height = 40.5;
    caForServices.getRow(6).height = 57.75;
}


interface RowData {
    name: string;
    //null is mobile
    hf: GeoJsonHealthFacility | null;
    distance: number;
    ri: boolean;

    //These are problematic flags
    anc: boolean | null;
    delivery: boolean | null;
    family_planning: boolean | null;

}

function fetchRowData(
    fixedPostHf: GeoJsonHealthFacility,
    boundaryData: BoundaryDataClass
): Array<RowData> {

    /*
    Need all settlements of each FP, outreaches

    as well as any settlement not covered

    Share with other excel code
    */


    const rowMap = new Map<string, RowData>();

    //Add fixed post first

    const children = (boundaryData.hfChildMap.get(fixedPostHf.properties.global_id) || []).filter(
        hf => hf.properties.services.includes("Routine Immunization")
    );

    for (const hfGuid of [fixedPostHf.properties.global_id, ...children.map(c => c.properties.global_id)]) {
        const catchment = boundaryData.getCatchmentForHf(hfGuid, true, true);

        for (const ci of catchment) {
            const primaryNames = boundaryData.getPrimaryNamesForSettlementPart(ci.properties.settlement_part, true);

            const sp = boundaryData.spMap.get(ci.properties.settlement_part)!;

            for (const pn of primaryNames) {

                const hf = boundaryData.hfMap.get(hfGuid)!;
                rowMap.set(pn.properties.global_id, {
                    name: pn.properties.name,
                    hf,
                    //Always distance to fixed post
                    distance: calculateDistance(fixedPostHf, pn, sp),
                    ri: true,
                    anc: hf.properties.services.includes("Antenatal Care"),
                    delivery: hf.properties.services.includes("Delivery"),
                    family_planning: hf.properties.services.includes("Family Planning")
                });
            }


        }
    }

    const mobileItems = Array.from(getMobileItems(boundaryData));

    for (const [pnGuid, _] of mobileItems) {
        const pn = boundaryData.snMap.get(pnGuid)!;
        const sp = boundaryData.spMap.get(pn.properties.settlement_part!)!;
        rowMap.set(pn.properties.global_id, {
            name: pn.properties.name,
            hf: null,
            //Always distance to fixed post
            distance: calculateDistance(fixedPostHf, pn, sp),
            ri: true,
            anc: null,
            delivery: null,
            family_planning: null
        });
    }

    const rows = Array.from(rowMap.values());

    rows.sort((a, b) => a.name.localeCompare(b.name));

    return rows;
}

function calculateDistance(hf: GeoJsonHealthFacility, sn: GeoJsonSettlementName, sp: GeoJsonSettlementPart): number {
    const tPoint = hf as TurfFeature<TurfPoint>;
    const tPoly = sp as TurfFeature<TurfMultiPolygon>;

    const dist = turfDistanceToPolygon(tPoly, tPoint);

    return dist;
}

export function buildCaForServicesSheet(
    caForServices: Worksheet,
    hf: GeoJsonHealthFacility,
    boundaryData: BoundaryDataClass,
    logger: NGXLogger
) {

    setTopLabels(caForServices, hf, boundaryData, logger);
    setTableLabels(caForServices, logger);

    const cellFormatter = new CellFormatter(caForServices, logger);

    //Now finally fill in the table


    //We need total pop summing all outreaches
    //pn guid => sum
    const allRowData = fetchRowData(hf, boundaryData);



    cellFormatter.setRowCol(ROW_TABLE_START + 2, COL_START).setBorders({
        left: ThinBorder,
        top: ThinBorder,
        bottom: ThinBorder,
        right: ThinBorder
    });

    for (const [rowIdx, rowData] of allRowData.entries()) {

        cellFormatter.setRowCol(ROW_TABLE_START + 2 + rowIdx, COL_START)
            .setBorders({
                left: ThinBorder,
                right: ThinBorder,
                top: ThinBorder,
                bottom: ThinBorder
            }).setCellValue(rowIdx + 1);

        cellFormatter.setBorders({ left: ThinBorder, right: ThinBorder })
            .setCol(COL_START + 1).setCellValue(rowData.name);

        let distColumn = COL_START + 2;
        if (rowData.hf && rowData.hf.properties.type == "fixed_post") {
            distColumn = COL_START + 2;
        }
        else if (rowData.hf && rowData.hf.properties.type == "outreach") {
            distColumn = COL_START + 3;
        }
        else {
            distColumn = COL_START + 4;
        }

        for (let col = COL_START + 2; col <= COL_START + 4; ++col) {
            cellFormatter.setCol(col)
                .setCellValue(
                    ""
                );
        }

        cellFormatter.setCol(distColumn)
            .setNumFmt("0")
            .setCellValue(
                rowData.distance
            );

        cellFormatter.setCol(COL_START + 5).setCellValue(rowData.ri ? "YES" : "NO");
        cellFormatter.setCol(COL_START + 6).setCellValue("");

        cellFormatter.setCol(COL_START + COLUMN_COUNT - 3).setCellValue(rowData.anc ? "YES" : "NO");
        cellFormatter.setCol(COL_START + COLUMN_COUNT - 2).setCellValue(rowData.delivery ? "YES" : "NO");
        cellFormatter.setCol(COL_START + COLUMN_COUNT - 1).setCellValue(rowData.family_planning ? "YES" : "NO");

    }


    setDimensions(caForServices);
}

// see https://github.com/Turfjs/turf/issues/1743
function turfDistanceToPolygon(
    poly: TurfFeature<TurfMultiPolygon>,
    point: TurfFeature<TurfPoint>
): number {
    let bestDistanceKm = Number.MAX_VALUE;

    // Covert single polygon or multi-polygon into consistent array

    let polygons: Position[][][] = poly.geometry.coordinates;

    for (const aPolygon of polygons) {
        // First item is the outer perimeter
        const outer = aPolygon[0];
        const outerLine = lineString(outer);

        // Inside outer and not in a hole
        const isInsidePolygon = booleanPointInPolygon(point, polygon(aPolygon));

        if (isInsidePolygon) {
            return 0;
        }

        const distanceToPoly = pointToLineDistance(point, lineString(outer), { units: "kilometers" });

        if (distanceToPoly < bestDistanceKm) {
            bestDistanceKm = distanceToPoly;
        }
    }


    return bestDistanceKm;
};