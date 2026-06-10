import { Workbook, Buffer, Worksheet, Font, Borders, BorderStyle, Border, Cell, Alignment } from "exceljs";
import { NGXLogger } from "ngx-logger";
import { BoundaryData } from "src/app/utils/export/pdf";
import { GeoJsonBoundary, GeoJsonHealthFacility, HealthFacilityServices } from "src/app/utils/server-interfaces/GeoJson";
import { autoWidth } from "../excel-export/utils";
import { NOT_OPERATING_HOURS } from "src/app/constants/hf.constants";
import { formatDaysAsCSL } from "src/app/utils/string-formatting";
import _ from "lodash";
import { BoundaryDataClass } from "@services/geo/BoundaryDataClass";
import { getCiEstimatedGisPop, getCiEstimatedPopIfExists } from "src/app/utils/server-interfaces/utils/indicator.util";
import { buildTargetPopulationSheet } from "./target-population";
import { buildCaForServicesSheet } from "./catchment-area-for-services";
import { AppConfigService } from "src/app/utils/app-config.service";
import { CellFormatter } from "./cell-formatter";

export function buildBackgroundAndServicesSheet(
    backgroundAndServices: Worksheet,
    hf: GeoJsonHealthFacility,
    boundaryObj: GeoJsonBoundary, boundaryParentObj: GeoJsonBoundary,
    logger: NGXLogger
) {

    const labelFont: Partial<Font> = { bold: true };
    //const valueFont: Partial<Font> = { bold: false, italic: false, color: { argb: '0000ff00' } };
    const valueFont: Partial<Font> = { bold: false, italic: false };

    const labelColStart = 2;
    const labelColStartSecondGroup = 6;

    const rowsBetweenLabels = 1;
    //let col = 2;
    //let row = 1;

    const MediumBorder: Border = { style: 'medium', color: { argb: 'FF000000' } };
    const ThinBorder: Border = { style: 'thin', color: { argb: 'FF000000' } };

    const cellFormatter = new CellFormatter(backgroundAndServices, logger);

    cellFormatter.setFont(labelFont).setRowCol(2, 1).setCellValue("Form 0: Background information and services");

    //cellFormatter.setCol(7).setFont({ italic: true }).setCellValue("©SPHCMB KANO_2024 PHC REW microplan");

    cellFormatter.addToRow(1 + rowsBetweenLabels).setCol(labelColStart)
        .setCellValue("Health Facility: ____________________________________");

    cellFormatter.addToCol(2).setFont(valueFont, true).setCellValue(hf.properties.name);

    cellFormatter.setCol(labelColStartSecondGroup).setFont(labelFont).setCellValue("Type of Facility: ________________________________");

    cellFormatter.addToCol(1).setFont(valueFont).setCellValue(hf.properties.private ? "Private" : "Public");

    cellFormatter.addToRow(1 + rowsBetweenLabels).setCol(labelColStart).setFont(labelFont).setCellValue("Ward: ________________");

    cellFormatter.addToCol(1).setFont(valueFont).setCellValue(boundaryObj.properties.name.toUpperCase());

    cellFormatter.addToCol(1).setFont(labelFont).setCellValue("LGA: ________________");

    cellFormatter.setFont(valueFont).setCellValue(boundaryParentObj.properties.name.toUpperCase());

    cellFormatter.setFont(labelFont).setCol(labelColStartSecondGroup).setCellValue("Zone: ________________________________________");

    cellFormatter.addToRow(1 + rowsBetweenLabels).setCol(labelColStart)
        .setCellValue("Name of Facility In Charge: __________________________");

    cellFormatter.setCol(labelColStartSecondGroup).setCellValue("Phone Number: ___________________________");

    cellFormatter.addToRow(1 + rowsBetweenLabels).setCol(labelColStart)
        .setBorders({ top: MediumBorder, left: MediumBorder, bottom: MediumBorder, right: MediumBorder })
        .setAlignment({ wrapText: true }).setCellValue("S/N");

    cellFormatter.addToCol(1).setBorders({
        top: MediumBorder,
        left: ThinBorder, bottom: MediumBorder, right: ThinBorder
    }).setCellValue("Services");

    cellFormatter.addToCol(1).setCellValue("Is this facility providing this service? (Yes/No)");
    cellFormatter.addToCol(1).setCellValue("Day of service (e.g. Daily, Mon, Tue, etc.)");
    cellFormatter.addToCol(1).setCellValue("Service Provider");
    cellFormatter.addToCol(1).setCellValue("Qualification")
    cellFormatter.addToCol(1)
        .setBorders({ right: MediumBorder })
        .setCellValue("Phone Number");

    const services: Array<HealthFacilityServices> = [
        'Antenatal Care',
        'Postnatal Care',
        'Delivery',
        'Routine Immunization',
        'Family Planning',
        'HIV/AIDS Prevention',
        'Curative Care and OPD',
        'Newborn Care',
        'IMCI',
        'TB/Leprosy services',
        'Malaria control',
        //In example but not in type
        //'Nutrition'
        "Eye Care",
        'Mental Care',
        'Oral Care',
        'Health Education',
        'Community Engagement',
        'Sanitation'
    ];


    // in type, but not example
    // 'CMAM',
    //     'Growth Monitoring',
    //     'IYCF',
    //     'Referral',


    //The days of service we' ll share the days open
    // hf.properties.operating_hours_stop

    //Starts Monday 
    //let isOpen = hf.properties.operating_hours_stop.map(stop_time => stop_time !== NOT_OPERATING_HOURS);

    let days = formatDaysAsCSL(hf.properties);

    days = days.replace("Monday, Tuesday, Wednesday, Thursday, Friday", "Monday - Friday")

    let snNumber = 0;
    const allThinBorders = { top: ThinBorder, left: ThinBorder, right: ThinBorder, bottom: ThinBorder };
    cellFormatter.setBorders(allThinBorders).setFont(valueFont);
    for (const serviceName of services) {

        snNumber += 1;

        cellFormatter.addToRow(1).setCol(labelColStart).setBorders({ right: ThinBorder });
        cellFormatter.setCellValue(snNumber);

        cellFormatter.addToCol(1).setCellValue(serviceName);

        const hasService = hf.properties.services.includes(serviceName);
        cellFormatter.addToCol(1).setCellValue(hasService ? "YES" : "NO");

        cellFormatter.addToCol(1).setCellValue(hasService ? days : "");

        cellFormatter.addToCol(1).setCellValue("");

        cellFormatter.addToCol(1).setCellValue("");

        cellFormatter.addToCol(1).setBorders({ right: MediumBorder }).setCellValue("");
    }

    //Value from orig. REW sheet
    backgroundAndServices.getColumn(2).width = 5;



    for (let col = 3; col <= 8; col += 1) {
        const excelCol = backgroundAndServices.getColumn(col);
        //excelCol.alignment = { wrapText: true };
        //Value from orig. REW sheet
        excelCol.width = 25;
    }

    //autoWidth(backgroundAndServices);
}

