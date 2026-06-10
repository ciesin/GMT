import { BoundaryDataClass } from "@services/geo/BoundaryDataClass";
import { Border, Font, Worksheet } from "exceljs";
import { GeoJsonHealthFacility } from "src/app/utils/server-interfaces/GeoJson";
import { CellFormatter } from "./cell-formatter";
import { getCiComputedPop, getCiEstimatedGisPop, getCiEstimatedPopIfExists } from "src/app/utils/server-interfaces/utils/indicator.util";
import { string } from "yup";
import _ from "lodash";
import { formatPopulation } from "src/app/utils/string-formatting";
import { getColumnLetter } from "../excel-export/utils";
import { NGXLogger } from "ngx-logger";

const MediumBorder: Border = { style: 'medium', color: { argb: 'FF000000' } };
const ThinBorder: Border = { style: 'thin', color: { argb: 'FF000000' } };

const COL_START = 2;
const ROW_TABLE_START = 5;

interface TargetPopCategory {
    label: string;
    perc: number
}

const TARGET_POP_CATS: Array<TargetPopCategory> = [
    {
        label: "0 - 11 months",
        perc: 4,
    }, {
        label:
            "12 to 23 months",
        perc: 3.8
    }, {
        label:
            "<5yr",
        perc: 20
    }, {
        label:
            "Pregnant Women",
        perc: 5
    },
    {
        label: "Adolescents",
        perc: 16
    },
    { label: "Women 15-49 yrs", perc: 22 }
];

const COLUMN_COUNT = TARGET_POP_CATS.length + 5;

function setTopLabels(targetPopulation: Worksheet,
    hf: GeoJsonHealthFacility,
    boundaryData: BoundaryDataClass,
    logger: NGXLogger
) {

    const labelFont: Partial<Font> = { bold: true };
    const valueFont: Partial<Font> = { bold: false, italic: false };
    const rowsBetweenLabels = 1;

    const cellFormatter = new CellFormatter(targetPopulation, logger);
    cellFormatter.setRowCol(1, COL_START).setFont(labelFont);

    cellFormatter.setCellValue("Form 1: Background information and services");

    //cellFormatter.setCol(9).setFont({ italic: true }, true).setCellValue("©SPHCMB KANO_2024 PHC REW microplan");

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

    cellFormatter.setCol(lastCol)
        .setFont(labelFont, true).setCellValue("LGA: ________________________________");

    cellFormatter.col += 2;
    cellFormatter.setFont(valueFont, true).setCellValue(boundaryLabels[boundaryLabels.length - 2].toUpperCase());

    cellFormatter.setCol(17).setFont(labelFont, true).setCellValue("State: ________________________________");

    cellFormatter.setCol(cellFormatter.col + 1).setFont(valueFont, true).setCellValue(boundaryLabels[boundaryLabels.length - 3].toUpperCase());


    cellFormatter.setRowCol(5, lastCol + 2).setBorders({ top: MediumBorder, left: MediumBorder, bottom: ThinBorder, right: MediumBorder })
        .setSpanWidthHeight(10, 1)
        .setAlignment({ horizontal: "left" })
        .setCellValue("Map of Health Facility Catchment Area");


    cellFormatter.setRowCol(5 + 1, lastCol + 2)
        .setFont({ "italic": true }, true)
        .setAlignment({ vertical: "top" })
        .setBorders({ top: MediumBorder, left: MediumBorder, bottom: ThinBorder, right: MediumBorder })
        .setSpanWidthHeight(10, 24)
        .setCellValue("(Showing distances and population)");

}

function setTableLabels(targetPopulation: Worksheet, logger: NGXLogger, isGisPop: boolean) {


    const labelBottomRow = ROW_TABLE_START + 1;

    const targetPopStartCol = COL_START + 3;
    const targetPopStopCol = targetPopStartCol + TARGET_POP_CATS.length - 1;

    const labelFont: Partial<Font> = { bold: true };
    const cellFormatter = new CellFormatter(targetPopulation, logger);



    cellFormatter.setRowCol(ROW_TABLE_START, COL_START).setFont(labelFont).setBorders({ top: MediumBorder, left: MediumBorder, bottom: MediumBorder, right: MediumBorder })
        .setAlignment({
            wrapText: true,
            vertical: 'middle',
            horizontal: 'center'
        }).setSpanWidthHeight(1, 2)
        .setCellValue("S/N");

    cellFormatter.setRowCol(ROW_TABLE_START, COL_START + 1).setBorders({ right: ThinBorder }).setCellValue("Village/Settlement in GMT");

    cellFormatter.setRowCol(ROW_TABLE_START, COL_START + 2).setBorders({ left: ThinBorder });

    if (isGisPop) {
        cellFormatter.setCellValue("Total Population (modelled operational estimates)");
    } else {
        cellFormatter.setCellValue("Total Population (as entered by a user in GMT)");
    }



    const topBottomBorder = { top: MediumBorder, left: ThinBorder, bottom: MediumBorder, right: ThinBorder };

    //Cols 5 to 10


    cellFormatter.setBorders({ top: ThinBorder, left: ThinBorder, bottom: MediumBorder, right: ThinBorder })
        .setSpanWidthHeight(1, 1).setRow(labelBottomRow)
        ;
    for (const [idx, tpCat] of TARGET_POP_CATS.entries()) {
        const perc = tpCat.perc

        cellFormatter.setCol(targetPopStartCol + idx).setCellValue(tpCat.label + " (" + perc.toFixed(1) + "% of Total Pop)");
    }


    cellFormatter.setRowCol(ROW_TABLE_START, targetPopStartCol).setSpanWidthHeight(targetPopStopCol - targetPopStartCol + 1, 1)
        .setBorders({ top: MediumBorder, left: ThinBorder, bottom: ThinBorder, right: ThinBorder });

    if (isGisPop) {
        cellFormatter.setCellValue("Target Population (derived from modelled operational estimates)");

    } else {
        cellFormatter.setCellValue("Target Population (proportion applied to the total population by GMT)");
    }


    cellFormatter.setRowCol(ROW_TABLE_START, targetPopStopCol + 1)
        .setBorders(topBottomBorder)
        .setSpanWidthHeight(1, 2).setCellValue("Settlement Type (Urban/ Rural)");

    cellFormatter.setCol(targetPopStopCol + 2).setBorders({ right: MediumBorder })
        .setCellValue("Hard to Reach/ Nomadic/ Riverine");

}

function setDimensions(targetPopulation: Worksheet) {

    targetPopulation.getColumn(2).width = 5;
    targetPopulation.getColumn(3).width = 25;
    const lastCol = COL_START + COLUMN_COUNT - 1;

    for (let col = 4; col <= lastCol; ++col) {
        targetPopulation.getColumn(col).width = 12;
    }

    targetPopulation.getColumn(lastCol + 1).width = 1;

    for (let col = lastCol + 2; col <= 23; ++col) {
        targetPopulation.getColumn(col).width = 8.43;
    }

    targetPopulation.getRow(5).height = 38.25;
    targetPopulation.getRow(6).height = 57;
}


function computeTargetPopulationForSettlements(
    hf: GeoJsonHealthFacility,
    boundaryData: BoundaryDataClass,
    useGisPop: boolean
): Map<string, number> {
    const children = (boundaryData.hfChildMap.get(hf.properties.global_id) || []).filter(
        hf => hf.properties.services.includes("Routine Immunization")
    );

    //We need total pop summing all outreaches
    //pn guid => sum
    const catchmentSum: Map<string, number> = new Map();

    for (const hfGuid of [hf.properties.global_id, ...children.map(c => c.properties.global_id)]) {
        const catchment = boundaryData.getCatchmentForHf(hfGuid, true, true);

        for (const ci of catchment) {
            const primaryNames = boundaryData.getPrimaryNamesForSettlementPart(ci.properties.settlement_part, true);

            const sp = boundaryData.spMap.get(ci.properties.settlement_part)!;

            for (const pn of primaryNames) {
                // let's only use the field estimated here and not default (ie same as the current export we have in excel)
                // and then if needed we can add the third option (which we also have in the excel) where we default
                const ciPop = useGisPop ? getCiComputedPop(pn, sp, ci) : (getCiEstimatedPopIfExists(pn, ci) || 0);


                catchmentSum.set(pn.properties.global_id, (catchmentSum.get(pn.properties.global_id) || 0) + ciPop);
            }
        }
    }

    return catchmentSum;
}


interface TargetPopSettlement {
    name: string;
    total_population: number;
    //false -- rural, null unknown/blank
    is_urban: boolean | null;
    //Comma joined limited to htr, nomadic, riverine
    problematic: string
}

export function buildTargetPopulationSheet(
    targetPopulation: Worksheet,
    hf: GeoJsonHealthFacility,
    boundaryData: BoundaryDataClass,
    useGisPop: boolean,
    logger: NGXLogger
) {

    setTopLabels(targetPopulation, hf, boundaryData, logger);
    setTableLabels(targetPopulation, logger, useGisPop);


    const cellFormatter = new CellFormatter(targetPopulation, logger);

    //Now finally fill in the table
    const settlements = getSettlementData(hf, boundaryData, useGisPop);

    cellFormatter.setRowCol(ROW_TABLE_START + 2, COL_START).setBorders({
        left: MediumBorder,
        top: ThinBorder,
        bottom: ThinBorder,
        right: ThinBorder
    });

    writeSettlementTable(cellFormatter, settlements);

    const totalRow = ROW_TABLE_START + 2 + settlements.length;

    cellFormatter.setRowCol(totalRow, COL_START).setFont({
        bold: true
    }).setSpanWidthHeight(2, 1).setBorders({
        left: MediumBorder,
        right: ThinBorder,
        top: MediumBorder,
        bottom: ThinBorder
    }).setCellValue("TOTAL");

    cellFormatter
        .setBorders({ top: ThinBorder })
        .setRowCol(totalRow + 1, COL_START).setCellValue("Main languages");
    cellFormatter.setRowCol(totalRow + 2, COL_START).setCellValue("Main occupations (2-3)");

    cellFormatter.setRowCol(totalRow + 1, COL_START + 2)
        .setBorders({ right: MediumBorder, left: ThinBorder })
        .setSpanWidthHeight(COLUMN_COUNT - 2, 1).setCellValue("");
    cellFormatter.setRow(totalRow + 2).setCellValue("");

    const sumRowStart = ROW_TABLE_START + 2;
    const sumRowStop = sumRowStart + settlements.length - 1;

    for (let tcIdx = -1; tcIdx < TARGET_POP_CATS.length; ++tcIdx) {
        //Skip sum if no settlements
        if (settlements.length <= 0) {
            continue;
        }
        const formulaCol = COL_START + 3 + tcIdx;
        const sumCol = getColumnLetter(formulaCol - 1);

        const formula = `SUM(${sumCol}${sumRowStart}:${sumCol}${sumRowStop})`;
        //console.warn(`Formula is [${formula}]`)
        cellFormatter.setRowCol(totalRow, formulaCol)
            .setSpanWidthHeight(1, 1)
            .setBorders({
                left: ThinBorder,
                right: ThinBorder,
                top: MediumBorder,
                bottom: ThinBorder
            })
            .setNumFmt("0")
            .setCellValue({
                formula,
                date1904: false
            })
    }

    cellFormatter.setBorders({
        left: ThinBorder,
        right: ThinBorder,
        top: MediumBorder,
        bottom: ThinBorder
    }).setSpanWidthHeight(1, 1).setCol(COL_START + 3 + TARGET_POP_CATS.length).setCellValue("");
    cellFormatter.setCol(COL_START + 4 + TARGET_POP_CATS.length).setBorders({ right: MediumBorder }).setCellValue("");


    setDimensions(targetPopulation);
}

function getSettlementData(
    hf: GeoJsonHealthFacility,
    boundaryData: BoundaryDataClass,
    useGisPop: boolean,): Array<TargetPopSettlement> {
    //We need total pop summing all outreaches
    //pn guid => sum
    const catchmentSum = computeTargetPopulationForSettlements(hf, boundaryData, useGisPop);

    const settlements: Array<TargetPopSettlement> =
        Array.from(catchmentSum.entries()).map(([pnGuid, totalPop]) => {
            const pn = boundaryData.snMap.get(pnGuid)!;
            const sp = boundaryData.spMap.get(pn.properties.settlement_part!)!;
            let is_urban: boolean | null = null;
            if (sp.properties.type == "bua") {
                is_urban = true;
            } else if (sp.properties.type == "ha" || sp.properties.type == "ssa") {
                is_urban = false;
            }

            const problematic = pn.properties.problematic.filter(p => p == "Hard To Reach" || p == "Nomadic/Fulani" || p == "Riverine").join(", ");

            return {
                name: pn.properties.name,
                total_population: totalPop,
                is_urban,
                problematic
            };
        });

    //Sort by name
    settlements.sort((a, b) => {
        return a.name.localeCompare(b.name);
    })

    return settlements;
}

function writeSettlementTable(
    cellFormatter: CellFormatter,
    settlements: Array<TargetPopSettlement>

) {
    for (const [setIdx, setPop] of settlements.entries()) {

        cellFormatter.setRowCol(ROW_TABLE_START + 2 + setIdx, COL_START)
            .setBorders({
                left: MediumBorder,
                right: MediumBorder,
                top: ThinBorder,
                bottom: ThinBorder
            }).setCellValue(setIdx + 1);

        cellFormatter.setBorders({ left: ThinBorder, right: ThinBorder })
            .setCol(COL_START + 1).setCellValue(setPop.name);
        cellFormatter.setCol(COL_START + 2)
            .setNumFmt("0")
            .setCellValue(setPop.total_population);

        for (const [catIdx, cat] of TARGET_POP_CATS.entries()) {
            cellFormatter.setCol(COL_START + 3 + catIdx).setCellValue(
                setPop.total_population * cat.perc / 100);
        }

        cellFormatter.setCol(COL_START + COLUMN_COUNT - 2).setNumFmt("")
            .setCellValue(setPop.is_urban === true ? "URBAN" : (setPop.is_urban === false ? "RURAL" : ""))


        cellFormatter
            .setCol(COL_START + COLUMN_COUNT - 1)
            .setBorders({ right: MediumBorder })
            .setAlignment({ wrapText: true })
            .setCellValue(setPop.problematic);

        cellFormatter.setAlignment({}, true);
    }
}