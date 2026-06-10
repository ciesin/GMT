
import {
    BlendMode,
    layoutMultilineText,
    LineCapStyle,
    PageSizes,
    PDFDocument,
    PDFEmbeddedPage,
    PDFFont,
    PDFImage,
    PDFPage,
    PDFPageDrawImageOptions,
    PDFPageDrawRectangleOptions,
    rgb,
    RGB,
    StandardFonts,
    TextAlignment
} from "pdf-lib";
import "svg2pdf.js";
import { jsPDF } from 'jspdf';
import { Feature, Map as OLMap } from "ol";
import { Context } from "vm";
import { AppConfigService } from 'src/app/utils/app-config.service';
import { Extent } from "ol/extent";
import VectorSource from "ol/source/Vector";
import { Geometry } from "ol/geom";
import html2canvas from "html2canvas";
import {
    Frequency,
    GeoJsonBoundary,
    GeoJsonCatchmentItem,
    GeoJsonHealthFacility,
    GeoJsonSettlementName,
    UNKNOWN,
} from "../server-interfaces/GeoJson";
import { formatPopulation } from "../string-formatting";

import { calcPerc } from "../coords";

import { getCiComputedPop, getCiEstimatedGisPop, getCiEstimatedPopIfExists, getSnEstimatedPop } from "../server-interfaces/utils/indicator.util";
import { VectorLayerName } from "../server-interfaces/VectorLayerName";
import { BoundaryDataClass } from "../../services/geo/BoundaryDataClass";
import { asArray, Color } from "ol/color";
import { ColorLike } from "ol/colorlike";

import { NGXLogger } from "ngx-logger";
import { coveredFixedPostColor, coveredOutreachColor } from "src/app/_shared/map/styles/map-raster-squares";
import { computeCatchmentDistances } from "src/app/services/vector_layer/single-hf.service";

import { ServiceApiFeature } from "@services/map/base/map-events.service";
import { HfMapComponent } from "@components/export-dialog/pdf-maps/hf-map/hf-map.component";
import { ComponentRef, ViewContainerRef } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { LAYER_CATCHMENT_VISUAL, LAYER_HEALTH_FACILITIES_ID } from "@components/export-dialog/pdf-maps/pdf-constants";
import { OverviewMapComponent } from "@components/export-dialog/pdf-maps/overview-map/overview-map.component";
import { compareHfIndex, PdfDataService } from "@components/export-dialog/pdf-maps/pdf-data-service";
import { retrieveItem, storeItem } from "../container";
import _ from "lodash";
import Semaphore from "semaphore-async-await";
import { ExportOptions } from "@components/export-dialog/export-options";
import { ContentLayoutVars } from "./content-layout-vars";

export enum Layout {
    LANDSCAPE = 'landscape',
    PORTRAIT = 'portrait'
}

export interface DocumentOptions {
    layout?: Layout,
    size?: [number, number],
    title?: string,
    subject?: string,
    author?: string,
    creator?: string,
    keywords?: string[]
}

//settings needed by print-microplan.component
export const DocumentPageSettings = {
    PAGE_SIZE: PageSizes.A4,
    PAGE_FORMAT: Layout.LANDSCAPE,
    PAGE_TITLE: 'GMT Microplan',
    PAGE_SUBJECT: 'Microplan',
    PAGE_CREATOR: `Geospatial Microplanning Toolkit (${document.location.hostname})`,
}

// Page setup
export const PageSettings = {
    DOCUMENT_FONT: StandardFonts.Helvetica,
    DOCUMENT_FONT_BOLD: StandardFonts.HelveticaBold,

    //Line thickness of the internal drawn boxes
    LINE_THICKNESS: 1,
    //CONTENT_THICKNESS: 0.5,
    //Total header height, including margins; not sure about line widths
    //HEADER_HEIGHT: 40,
    //HEADER_MARGIN: 4,
    //This is for the overview page
    //CENTER_RATIO: 0.5,
    //HEALTH_FACILITY_DETAIL_LEFT_PANEL_PERC: 0.35,
    TITLE_FONT_SIZE: 16,
    SUBTITLE_FONT_SIZE: 12,
    HEADER_FONT_SIZE: 10,
    CONTENT_FONT_SIZE: 10,

    TABLE_FONT_SIZE: 8,
    //HEADER_LOGO: 'assets/images/gmt_logo.png',
    HEADER_LOGO: 'assets/images/gmt-logo.svg',

    //Initialized later, this is the GMT logo width
    GMT_LOGO_SECTION_WIDTH: 0,
    //HEALTHFACILITY_LOGO: 'assets/icons/map/pois/FixedPostDefault.svg',
    HEALTHFACILITY_LOGO: 'assets/icons/map-markers/fixed_default.svg',
    //OUTREACH_LOGO: 'assets/icons/map/pois/OutreachDefault.svg',
    OUTREACH_LOGO: 'assets/icons/map-markers/outreach_default.svg',
    CAR_LOGO: 'assets/icons/bycar.svg',
    PEDESTRIAN_LOGO: 'assets/icons/byfoot.svg',
    EMPTY_VALUE_PLACEHOLDER: '-',
    MAP_RESOLUTION_FACTOR: 2,
    MAP_RENDER_TIMEOUT: 2000,


    LEGEND_LOGO_ROAD: 'assets/images/legend-road.png',
    LEGEND_LOGO_OUTREACH: 'assets/images/outreach-strategy.png',
    LEGEND_LOGO_MOBILE: 'assets/images/mobile-strategy.png',
    LEGEND_LOGO_MULTIPLE: 'assets/images/multiple-claimed.png',
    LEGEND_LOGO_FIXED: 'assets/images/fixed-post-strategy.png'
};




//export type BoundaryDataVectorSourcesKeys  = typeof LAYER_BOUNDARY_ID | typeof LAYER_SETTLEMENTS_PARTS_ID | typeof LAYER_SETTLEMENTS_NAMES_ID | typeof LAYER_HEALTH_FACILITIES_ID;


export type BoundaryData = {
    //calculated per map, varies between hf detail and all hfs
    vectorSources: Map<VectorLayerName, VectorSource>
    //This shouldn't change per boundary, cached
    data: BoundaryDataClass
    //calculated per map, varies between hf detail and all hfs
    //Done this way in order to reuse the catchment functions
    [LAYER_CATCHMENT_VISUAL]: Array<ServiceApiFeature>
}


const svgCache: { [key: string]: PDFPage } = {};





function olToPdfColor(color: Color | ColorLike): [number, number, number, number] {
    if (Array.isArray(color)) {
        return [
            color[0] / 255,
            color[1] / 255,
            color[2] / 255,
            color[3]
        ];
    } else {
        //this shouldn't happen
        return [0, 0, 0, 0];
    }
}




export async function loadSVG(svgUrl: string): Promise<PDFPage> {
    return new Promise((resolve, _reject) => {
        if (svgCache[svgUrl]) {
            resolve(svgCache[svgUrl]);
        } else {
            fetch(svgUrl).then(response => {
                response.text().then(async text => {
                    const parser = new DOMParser();
                    const svgElement = parser.parseFromString(
                        text.replace(/<!--[\s\S]*?-->/g, ''),
                        "image/svg+xml"
                    ).firstElementChild;
                    // @ts-ignore
                    svgElement.getBoundingClientRect();
                    // @ts-ignore
                    const svgWidth = svgElement.viewBox.animVal.width;
                    // @ts-ignore
                    const svgHeight = svgElement.viewBox.animVal.height;
                    const svgPdf = new jsPDF(svgWidth > svgHeight ? 'l' : 'p', 'pt', [svgWidth, svgHeight]);
                    await svgPdf.svg(svgElement as Element, { width: svgWidth, height: svgHeight });
                    svgCache[svgUrl] = await PDFDocument.load(await svgPdf.output('arraybuffer')).then(pdf => pdf.getPage(0));
                    resolve(svgCache[svgUrl]);
                });
            }).catch(async (_error) => {
                const svgDoc = await PDFDocument.create();
                await svgDoc.addPage([10, 10]);
                // We cannot embed an empty page. There we create a white 10x10 page with content
                svgDoc.getPage(0).drawRectangle({
                    x: 0,
                    y: 0,
                    width: 10,
                    height: 10,
                    color: rgb(1, 1, 1),
                    borderColor: rgb(1, 1, 1)
                });
                svgCache[svgUrl] = svgDoc.getPage(0);
                resolve(svgCache[svgUrl]);
            });
        }
    });
}




export async function createMapImage(map: OLMap, mapWidth: number, mapHeight: number): Promise<HTMLCanvasElement> {
    // Wait a bit to make sure layers finished rendering
    await new Promise(resolve => setTimeout(resolve, PageSettings.MAP_RENDER_TIMEOUT));
    const mapCanvas = document.createElement('canvas');
    if (_.isNil(mapCanvas)) {
        throw new Error("Map cnvas null");
    }
    if (_.isNil(map)) {
        throw new Error("Map is null");
    }
    const mapElement = map.getTarget() as HTMLElement;

    if (_.isNil(map)) {
        throw new Error("Map is null");
    }

    const mapSize = map.getSize() as [number, number];
    if (!_.isArray(mapSize)) {
        //throw new Error(`map size not an array: [${mapSize}]`);
        console.log("Use passed in width/height since mapSize not an array");
        mapCanvas.width = mapWidth;
        mapCanvas.height = mapHeight;
    } else {
        mapCanvas.width = mapSize[0];
        mapCanvas.height = mapSize[1];
    }
    const mapContext = mapCanvas.getContext('2d') as Context;

    if (_.isNil(mapContext)) {
        throw new Error("Map context is null");
    }

    let maxHeight = 0;

    Array.prototype.forEach.call(
        map.getViewport().querySelectorAll('.ol-layer canvas, canvas.ol-layer'),
        function (canvas) {
            if (canvas.width > 0) {
                const opacity =
                    canvas.parentNode.style.opacity || canvas.style.opacity;
                mapContext.globalAlpha = opacity === '' ? 1 : Number(opacity);
                let matrix;
                const transform = canvas.style.transform;
                if (transform) {
                    // Get the transform parameters from the style's transform matrix
                    matrix = transform
                        .match(/^matrix\(([^\(]*)\)$/)[1]
                        .split(',')
                        .map(Number);
                } else {
                    matrix = [
                        parseFloat(canvas.style.width) / canvas.width,
                        0,
                        0,
                        parseFloat(canvas.style.height) / canvas.height,
                        0,
                        0,
                    ];
                }
                // Apply the transform to the export map context
                CanvasRenderingContext2D.prototype.setTransform.apply(
                    mapContext,
                    matrix,
                );
                const backgroundColor = canvas.parentNode.style.backgroundColor;
                if (backgroundColor) {
                    mapContext.fillStyle = backgroundColor;
                    mapContext.fillRect(0, 0, canvas.width, canvas.height);
                }
                mapContext.drawImage(canvas, 0, 0);
            }
        },
    );

    await drawScaleLineCanvas(mapContext, mapElement, maxHeight);

    return mapCanvas;
}

async function drawScaleLineCanvas(mapContext: Context,
    mapElement: HTMLElement,
    maxHeight: number) {
    let node = mapElement.querySelector(".ol-scale-line") as HTMLElement;
    if (node) {
        if (node.children && node.children.length > 0) {
            node.style.background = "rgba(0,60,136,0.5)";
            (node.children[0] as HTMLElement).style.fontSize = "18px";
            (node.children[0] as HTMLElement).style.border = "2px solid #FFFFFF";
            (node.children[0] as HTMLElement).style.borderTop = "none";
            (node.children[0] as HTMLElement).style.color = "#FFFFFF";
        }
        node.style.visibility = 'visible';
        let scaleLineCanvas = await html2canvas(node, { scrollY: -window.scrollY }) as HTMLCanvasElement;
        if (scaleLineCanvas && scaleLineCanvas.width > 0) {
            // 20 is xmin
            mapContext.drawImage(scaleLineCanvas, 20, maxHeight - 45, scaleLineCanvas.width, scaleLineCanvas.height);
        }
    }
}






export async function addImage(
    page: PDFPage,
    image: string | HTMLCanvasElement | ArrayBuffer,
    options: PDFPageDrawImageOptions
) {
    // Load & emed image
    let embeddedImage: PDFImage;
    try {
        if (image instanceof HTMLCanvasElement) {
            embeddedImage = await page.doc.embedPng(image.toDataURL());
        } else if (image instanceof ArrayBuffer) {
            embeddedImage = await page.doc.embedPng(image);
        } else {
            if (image.startsWith('data/image')) {
                embeddedImage = await page.doc.embedPng(image);
            } else {
                const fetchedImage = await fetch(image);
                const buffer = await fetchedImage.arrayBuffer();
                embeddedImage = await page.doc.embedPng(buffer);
            }
        }
    } catch (error) {
        return;
    }
    // Add it to page
    page.drawImage(embeddedImage, options);
}

export function saveFileName(filename: string): string {
    return filename.replace(/[<>:"\/|?*]/g, '.');
}

export async function createDocument(options?: DocumentOptions): Promise<PDFDocument> {
    const pdf = await PDFDocument.create();
    let layout: Layout = Layout.PORTRAIT;
    let size: [number, number] = PageSizes.A4;
    if (options) {
        if (options.layout) {
            layout = options.layout;
        }
        if (options.size) {
            size = options.size;
        }
        if (options.author) {
            pdf.setAuthor(options.author);
        }
        if (options.creator) {
            pdf.setCreator(options.creator);
        }
        if (options.title) {
            pdf.setTitle(options.title);
        }
        if (options.subject) {
            pdf.setSubject(options.subject);
        }
        if (options.keywords) {
            pdf.setKeywords(options.keywords.join(',').replace(/ /g, '').split(','));
        }
    }


    pdf.addPage(layout === Layout.PORTRAIT ? size : [size[1], size[0]] as [number, number]);
    return pdf;
}

export function drawTextBox(
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    font: PDFFont,
    fontSize: number,
    color: RGB,
    boxColor: RGB,
    paddingScale?: number,
): [number, number, number, number] {
    const padding = (paddingScale ? paddingScale : 0.25) * fontSize;
    const boxHeight = fontSize + padding;
    const boxWidth = font.widthOfTextAtSize(text, fontSize) + padding * 2;
    page.drawRectangle({
        x: x - padding,
        y: y - padding,
        width: boxWidth,
        height: boxHeight,
        borderWidth: 3,
        borderColor: boxColor,
        color: boxColor,
        opacity: 1,
        borderOpacity: 1,
        borderLineCap: LineCapStyle.Round,
        blendMode: BlendMode.Normal
    });
    page.drawText(text, {
        x: x,
        y: y,
        font: font,
        size: fontSize,
        color: color
    });
    return [x - padding, y - padding, x - padding + boxWidth, y - padding + boxHeight];
}


export async function embedSVG(pdf: PDFDocument, svg: string): Promise<PDFEmbeddedPage> {
    const svgLoaded = await loadSVG(svg);
    return pdf.embedPage(svgLoaded as PDFPage);
}


export interface BoundaryMapArgs {
    mapImagery: boolean,
    mgrsGrid: boolean,
    drawSettlementNames: boolean,
}


function computePop(catchmentStats: PdfCatchmentStats,
    catchmentsForHF: Array<GeoJsonCatchmentItem>,
    boundaryData: BoundaryData,
    logger: NGXLogger
) {
    let estimatedPop = 0;
    let computedPop = 0;
    let estimatedGisPop = 0;

    for (const ci of catchmentsForHF) {


        const settlementPartId = ci.properties.settlement_part;
        const settlementPart = boundaryData.data.spMap.get(settlementPartId);

        if (!settlementPart) {
            logger.warn(`Settlement part ${settlementPartId} not found`);
            continue;
        }

        const primaryNames = boundaryData.data.getPrimaryNamesForSettlementPart(settlementPartId, true);

        for (const pn of primaryNames) {
            estimatedPop += getCiEstimatedPopIfExists(pn, ci) || 0;
            computedPop += getCiComputedPop(pn, settlementPart, ci);
            estimatedGisPop += getCiEstimatedGisPop(pn, settlementPart, ci);

            catchmentStats.totalCountSettlements += 1;
        }
    }

    catchmentStats.computedPop = computedPop;
    catchmentStats.estimatedGisPop = estimatedGisPop;
    catchmentStats.estimatedPop = estimatedPop;
}


export interface PdfCatchmentStats {
    //gis pop
    computedPop: number,
    //user entered pop, not defaulted
    estimatedPop: number,
    //user entered pop, gis/comptude when null
    estimatedGisPop: number,

    totalCountSettlements: number,

}



/*computedPop: getCiComputedPop(pn, sp, ci),
    estimatedPop: getCiEstimatedPopIfExists(pn, ci),
        estimatedGisPop: getCiEstimatedGisPop(pn, sp, ci),*/

export function computePdfCatchmentStats(boundaryData: BoundaryData,
    hfGlobalId: string,
    ciItems: Array<GeoJsonCatchmentItem>,
    logger: NGXLogger): PdfCatchmentStats {

    const hfJson = boundaryData.data.hfMap.get(hfGlobalId)!;


    //Compute required stats

    const names: Array<GeoJsonSettlementName> = [];

    for (const ci of ciItems) {

        let pnNames = boundaryData.data.getPrimaryNamesForSettlementPart(ci.properties.settlement_part);

        names.push(...pnNames);
    }

    const catchmentStats: PdfCatchmentStats = {
        totalCountSettlements: 0,
        computedPop: 0,
        estimatedGisPop: 0,
        estimatedPop: 0,
    };
    //computeCatchmentDistances(hfJson, names, catchmentStats);

    //Now population, note we will not calculate zonal stats, we assume this has been precalculated

    computePop(catchmentStats, ciItems, boundaryData, logger);

    return catchmentStats;
}

export function computePdfFixedPostCatchmentStats(boundaryData: BoundaryData,
    hfGlobalId: string,
    logger: NGXLogger): [PdfCatchmentStats, PdfCatchmentStats, PdfCatchmentStats] {

    //returns fixed, outreach, total
    const fpCiItems = boundaryData.data.getCatchmentForHf(hfGlobalId, true, true);
    const fpStats = computePdfCatchmentStats(boundaryData, hfGlobalId, fpCiItems, logger);

    const outreachTotal: PdfCatchmentStats = {
        totalCountSettlements: 0,
        computedPop: 0,
        estimatedGisPop: 0,
        estimatedPop: 0,
    };
    const totalStats = _.cloneDeep(fpStats);

    const outreaches = boundaryData.data.hfChildMap.get(hfGlobalId) || [];
    for (const out of outreaches) {
        const outItems = boundaryData.data.getCatchmentForHf(out.properties.global_id, true, true);
        const outStats = computePdfCatchmentStats(boundaryData, out.properties.global_id, outItems, logger);

        outreachTotal.totalCountSettlements += outStats.totalCountSettlements;
        outreachTotal.computedPop += outStats.computedPop;
        outreachTotal.estimatedGisPop += outStats.estimatedGisPop;
        outreachTotal.estimatedPop += outStats.estimatedPop;

        totalStats.totalCountSettlements += outStats.totalCountSettlements;
        totalStats.computedPop += outStats.computedPop;
        totalStats.estimatedGisPop += outStats.estimatedGisPop;
        totalStats.estimatedPop += outStats.estimatedPop;
    }

    return [fpStats, outreachTotal, totalStats];
}




export async function mergeDocuments(
    documents: PDFDocument[],
    destination: PDFDocument | DocumentOptions
): Promise<PDFDocument> {

    // Use existing or create new PDF document
    const mergedPdf: PDFDocument = destination instanceof PDFDocument ? destination : await createDocument(destination);

    // Get a copy of all single documents pages
    const pageCopies: PDFPage[][] = await Promise.all(
        documents.map(async (pdf) => {
            return await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        })
    );

    // Add copied pages to destination document
    return new Promise((resolve, _reject) => {
        pageCopies.forEach((pages) => {
            pages.forEach((page) => {
                mergedPdf.addPage(page);
            });
        });
        // Remove first blank page if we created a new destination document from options
        if (!(destination instanceof PDFDocument)) {
            mergedPdf.removePage(0);
        }
        resolve(mergedPdf);
    });
}

export function getShortFrequencyLabel(freqStr: Frequency | undefined): string {

    switch (freqStr) {

        case "oncePerMonth":
            return "1x/m";
        case "twicePerMonth":
            return "2x/m";
        case "threePerMonth":
            return "3x/m";
        case "oncePerWeek":
            return "1x/w";
        case "twicePerWeek":
            return "2x/w";
        case "threePerWeek":
            return "3x/w";
        case "fourPerWeek":
            return "4x/w";
        case "fivePerWeek":
            return "5x/w";
        case "sixPerWeek":
            return "6x/w";
        case "daily":
            return "7x/w";
        case "other":
            return "Other";
        case UNKNOWN:
        default:
            return "Unk";
    }


}
