
import {
    BlendMode,
    layoutMultilineText,
    LineCapStyle,
    PDFDocument,
    PDFEmbeddedPage,
    PDFFont,
    PDFPage,
    PDFPageDrawImageOptions,
    PDFPageDrawRectangleOptions,
    rgb,
    TextAlignment
} from "pdf-lib";
import "svg2pdf.js";
import { Feature } from "ol";
import { AppConfigService } from 'src/app/utils/app-config.service';
import { Extent } from "ol/extent";
import { Geometry } from "ol/geom";
import {
    GeoJsonBoundary,
    GeoJsonCatchmentItem,
    GeoJsonHealthFacility,
    GeoJsonSettlementName,
} from "../server-interfaces/GeoJson";
import { formatPopulation } from "../string-formatting";

import { calcPerc } from "../coords";

import { BoundaryDataClass } from "../../services/geo/BoundaryDataClass";
import { asArray } from "ol/color";

import { NGXLogger } from "ngx-logger";

import { HfMapComponent } from "@components/export-dialog/pdf-maps/hf-map/hf-map.component";
import { ComponentRef, ViewContainerRef } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { LAYER_HEALTH_FACILITIES_ID } from "@components/export-dialog/pdf-maps/pdf-constants";
import { OverviewMapComponent } from "@components/export-dialog/pdf-maps/overview-map/overview-map.component";
import { compareHfIndex, PdfDataService } from "@components/export-dialog/pdf-maps/pdf-data-service";
import { retrieveItem, storeItem } from "../container";
import _ from "lodash";
import { ExportOptions } from "@components/export-dialog/export-options";
import { addImage, BoundaryData, computePdfCatchmentStats, computePdfFixedPostCatchmentStats, createDocument, createMapImage, DocumentPageSettings, drawTextBox, embedSVG, loadSVG, PageSettings, PdfCatchmentStats } from "./pdf";
import { buildAllVars, ContentLayoutVars, CoordValues, DimVariant, HF_LOGO_SIZE, SectionDimensions } from "./content-layout-vars";
import { BOUNDARY_LEGEND_ITEMS, HF_DETAIL_LEGEND_ITEMS, HF_DETAIL_LEGEND_TITLE } from "./legend-const";
import { getMobileItems } from "src/app/routine-immu/print-microplan/excel-export/sheet-hf-catchment";
import { CatchmentPopulation } from "@services/vector_layer/single-hf-processing.service";
import { MobileMapComponent } from "@components/export-dialog/pdf-maps/mobile-map/mobile-map.component";
import { Map as OLMap, View } from 'ol';

const GLOBAL_ID = "global_id";


export class PdfBuilder {
    private boundaryData: BoundaryData;
    private vars: ContentLayoutVars;

    constructor(
        private boundaryDataClass: BoundaryDataClass,
        private boundaryGuid: string,
        private pdfDataService: PdfDataService,
        private logger: NGXLogger,
        private viewContainerRef: ViewContainerRef,
        private debugMapImageIndexDb: IDBDatabase,
        private exportOptions: ExportOptions,
        private updateTaskCallback: (taskCount: number) => void
    ) {

    }

    /*
        Returns array of boundary global id + pdf doc
    
        Main page, 1 per boundary, showing all Hfs
         */
    public async createBoundaryDocument(

        //throttle: Semaphore
    ): Promise<PDFDocument> {

        const boundary = this.boundaryDataClass.getCurrentBoundary();

        // Create PDF document
        const pdf: PDFDocument = await createDocument({
            layout: DocumentPageSettings.PAGE_FORMAT,
            size: DocumentPageSettings.PAGE_SIZE,
            title: DocumentPageSettings.PAGE_TITLE,
            subject: `${DocumentPageSettings.PAGE_SUBJECT} for ${boundary.properties.name}`,
            creator: DocumentPageSettings.PAGE_CREATOR,
            keywords: [
                'GMT',
                'Microplan',
                `${boundary.properties.name}`
            ]
        });

        // Calculate the catchment data once for all health facilities in a boundary
        this.boundaryData = await this.pdfDataService.calculateMicroplanData(this.boundaryDataClass, null);

        const vectorSourceHfs = this.boundaryData.vectorSources.get(LAYER_HEALTH_FACILITIES_ID)!.getFeatures();

        vectorSourceHfs.sort((hf1, hf2) =>
            compareHfIndex(hf1.get("index"), hf2.get("index")));


        this.vars = await buildAllVars(pdf, pdf.getPage(0));


        let boundaryExtent: Extent = [-180, -90, 180, 90];
        // Create boundary page
        //await throttle.acquire();
        try {
            const [boundaryExtentRet] = await this.createBoundaryPage(
                pdf,

            );
            boundaryExtent = boundaryExtentRet;
        } finally {
            //throttle.release();
            this.updateTaskCallback(1);
        }

        // Add healthfacilities pages
        if (this.exportOptions.hfPage && vectorSourceHfs.length > 0) {
            // Prepare single PDF pages for all healthfacilities, so they stay in order

            const hfPages = initHealthFacilityPages(vectorSourceHfs, pdf);

            const overviewMap = await this.buildHealthFaclityOverviewMap(
                boundaryExtent,

            );

            // Render healthfacilities pages one at a time because boundaryData changes for each
            for (const [hf, page] of hfPages) {
                await this.renderHealthFacilityPages(hf, page,
                    overviewMap, boundaryExtent);
            }


        }

        //mobile [snguid, catchpop]
        if (this.exportOptions.addMobile) {
            const allMobileItems = Array.from(getMobileItems(this.boundaryDataClass));

            const items: Array<[GeoJsonSettlementName, CatchmentPopulation]> = [];
            for (const [snGuid, cp] of allMobileItems) {
                const sn = this.boundaryDataClass.snMap.get(snGuid);

                if (_.isNil(sn)) {
                    continue;
                }

                items.push([sn, cp]);
            }

            items.sort((a, b) => {
                return a[0].properties.name.toLowerCase().localeCompare(b[0].properties.name.toLowerCase());
            });
            const mobilePages = this.initMobilePages(items, pdf);

            for (const [items, page] of mobilePages) {
                await this.addMobilePage(items, page);
            }
        }




        this.enumeratePages(pdf);

        // Return page
        return pdf;
    }


    /**
     * Returns [boundaryExtent, pdf]
     *
     * This is the boundary overview, containing all the HFs in a boundary/ward
     */
    private async createBoundaryPage(
        document: PDFDocument,

    ): Promise<[Extent, PDFDocument]> {

        const boundaryData = this.boundaryData;
        const boundary: GeoJsonBoundary = boundaryData.data.getCurrentBoundary();

        try {
            const page = document.getPage(0);


            const hfFeatures: Array<GeoJsonHealthFacility> = [];

            const hfFeatureGlobalIds = boundaryData.vectorSources.get(LAYER_HEALTH_FACILITIES_ID)!.getFeatures().map(hf => hf.get(GLOBAL_ID));

            for (const hfGuid of hfFeatureGlobalIds) {
                const hf = this.boundaryData.data.hfMap.get(hfGuid);

                if (_.isNil(hf)) {
                    continue;
                }
                hfFeatures.push(hf);
            }



            hfFeatures.sort((hf1, hf2) => {
                return compareHfIndex(hf1.properties.index, hf2.properties.index);
            });


            //Figure out how many pages we need for all the hfs

            //For each hf/outreach, figure out what page, and what position in the page
            //both 0 based
            const hfPositions: Array<{ pageIndex: number, positionInPageIndex: number }> = [];
            let curPage = 0;
            let curPosition = 0;
            for (const [hfIndex, _] of hfFeatures.entries()) {
                hfPositions.push({
                    pageIndex: curPage,
                    positionInPageIndex: curPosition
                });

                curPosition += 1;
                if (curPosition >= this.vars.hfsPerPage) {
                    curPage += 1;
                    curPosition = 0;
                }
            }

            //If no hfs...
            let pageCount = 1;
            if (hfPositions.length > 0) {
                pageCount = 1 + hfPositions[hfPositions.length - 1].pageIndex;
            }
            const pageSectionDims = this.vars.pageSection.dims();
            this.logger.debug(`Boundary overview page # of hf ${hfFeatures.length} hf per page ${this.vars.hfsPerPage} page count ${pageCount}`);
            const pages = [page];
            for (let i = 1; i < pageCount; ++i) {
                const newPage = document.addPage([pageSectionDims.width, pageSectionDims.height]);
                pages.push(newPage);
            }

            const visualizeCatchmentVectorSource = this.pdfDataService.buildVisualizeCatchmentVectorSource(boundaryData);
            const boundaryExtent = this.pdfDataService.calculateBoundaryExtent(boundary, visualizeCatchmentVectorSource);

            const mapDims = this.vars.boundaryMap.dims(DimVariant.BORDER);
            await this.drawBoundaryMap(pages,
                mapDims,
                false,
                null


            );
            await this.drawDefaultPageFrame(pages);

            //This might cover the map, something important
            // await this.drawMapLegend(pages,
            //     mapDims,
            //     {
            //         title: 'Legend',
            //         corner: 'lr'
            //     });
            for (const page of pages) {
                this.drawPageHeaderText(page, null,);
            }

            // 3rd: Draw HF entries to corresponding pages


            for (const [index, hf] of hfFeatures.entries()) {
                const hfGuid = hf.properties.global_id;
                const ciItems = boundaryData.data.getCatchmentForHf(hfGuid, true, true);


                const hfPos = hfPositions[index];
                this.drawHfOnBoundaryPage(
                    pages[hfPos.pageIndex], hf, ciItems, hfPos.positionInPageIndex);
            }

            // Resolve document
            return [boundaryExtent, document];
        } catch (error) {
            console.log('PDF Boundary PAGE ERROR!', error);
            return [[-180, -90, 180, 90], document];
        }

    }



    /**
     * Render the hf detail page
     * @param hf
     * @param page
     * @param boundaryData
     * @param overviewMapImage
     * @param boundaryExtent
     * @param contentLayoutVars
     * @param throttle
     * @private
     */
    private async renderHealthFacilityPages(
        hf: Feature<Geometry>,
        page: PDFPage,

        overviewMapImage: HTMLCanvasElement | string,
        //use the overall boundary extend that has been extended to include all catchment extents
        boundaryExtent: Extent,

    ): Promise<PDFPage> {

        this.boundaryData = await this.pdfDataService.calculateMicroplanData(this.boundaryDataClass, hf.get("global_id"));

        await this.addHealthFacilityPage(
            page,
            hf,
            overviewMapImage,
            boundaryExtent,

        );

        return page;
    }


    /**
     * Draw the HF detail page
     * @param page
     * @param hf
     * @param boundaryData
     * @param overviewMapImage
     * @param boundaryExtent
     * @param contentVars
     * @param vectorLayerService
     * @param boundaryMapArgs
     */
    private async addHealthFacilityPage(
        page: PDFPage,
        hf: Feature<Geometry>,

        overviewMapImage: HTMLCanvasElement | string,
        //use the overall boundary extend that has been extended to include all catchment extents
        boundaryExtent: Extent,

    ): Promise<PDFPage> {

        try {

            const pages = [page];
            const hfGuid: string = hf.get(GLOBAL_ID);
            const ciItems = this.boundaryData.data.getCatchmentForHf(hfGuid, true, true);

            const visualizeCatchmentVectorSource = this.pdfDataService.buildVisualizeCatchmentVectorSource(this.boundaryData);

            const catchmentExtent = this.pdfDataService.calculateCatchmentExtent(boundaryExtent,
                visualizeCatchmentVectorSource,
                hf.getGeometry()!.getExtent()
            );

            await this.drawBoundaryMap(pages, this.vars.detailMap.dims(),
                false,
                hfGuid

            );

            //Needs to be after drawBoundaryMap for some reason, otherwise all extents look the same
            await this.drawDefaultPageFrame(pages);

            //console.log("Draw overview map");
            await this.drawOverviewMap(
                page,
                boundaryExtent,
                catchmentExtent,
                overviewMapImage,
            );

            //console.log("Draw map legend");
            await this.drawMapLegendForHfDetail(page);

            // Add header content
            const hfGeoJson = this.boundaryData.data.hfMap.get(hfGuid);
            if (_.isNil(hfGeoJson)) {
                throw new Error(`Cannot find hf ${hfGuid}`);
            }
            let fixedPostHf: GeoJsonHealthFacility | undefined;
            if (hfGeoJson.properties.type == 'outreach') {
                if (_.isNil(hfGeoJson.properties.parent)) {
                    throw new Error(`Cannot find hf parent ${hfGuid}`);
                }
                fixedPostHf = this.boundaryData.data.hfMap.get(hfGeoJson.properties.parent);
            } else {
                fixedPostHf = hfGeoJson;
            }
            if (_.isNil(fixedPostHf)) {
                throw new Error(`Cannot find hf ${hfGuid}`);
            }

            this.drawPageHeaderText(page, fixedPostHf,);
            this.drawInfoPanelSection(page, hfGeoJson, ciItems,);


        } catch (error) {
            this.logger.error('PDF HF PAGE ERROR!', error);
        }

        return page;
    }

    /**
    
    */
    private async addMobilePage(
        page: PDFPage,
        items: Array<[GeoJsonSettlementName, CatchmentPopulation]>



    ): Promise<PDFPage> {


        const pages = [page];

        //Needs to be after drawBoundaryMap for some reason, otherwise all extents look the same
        await this.drawDefaultPageFrame(pages);

        //use internal, not border
        drawBorder(page, this.vars.detailLeftPanelSection.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS));

        const mapDims = this.vars.detailMap.dims(DimVariant.BORDER);
        await this.drawBoundaryMap(pages,
            mapDims,
            true,
            null
        );

        await this.drawPageHeaderText(page, null);

        const titleHeight = this.vars.infoPanelTitle.height;
        //use info panel  x padding
        const internalDims = this.vars.infoPanel.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS);
        const titleLineMaxY = internalDims.maxY;
        const titleLineMinY = titleLineMaxY - titleHeight;

        //For outreaches we have the outreach icon and name

        //Fixed post
        //or outreach x of y

        const infoSectionTitle = "Mobile Settlements";

        page.drawText(infoSectionTitle, {
            x: internalDims.minX,
            y: titleLineMinY,
            size: this.vars.infoPanelTitle.height,
            font: this.vars.documentFontBold,
            color: rgb(0, 0, 0)
        });

        const subTitleLineMaxY = titleLineMinY - this.vars.infoPanelTitle.margin.bottom - this.vars.infoPanelCatchPopLabel.margin.top;
        const subTitleLineMinY = subTitleLineMaxY - this.vars.infoPanelCatchPopLabel.height;

        page.drawText("Name", {
            x: internalDims.minX,
            y: subTitleLineMinY,
            size: this.vars.infoPanelCatchPopLabel.height,
            font: this.vars.documentFontBold,
            color: rgb(0, 0, 0)
        });
        rightJustifyText(page, "Unc. GIS Pop", this.vars.infoPanelCatchPopLabel.height, internalDims.maxX, subTitleLineMinY, this.vars.documentFontBold);

        for (const [idx, [pn, cp]] of items.entries()) {
            const lineMaxY = subTitleLineMinY - this.vars.infoPanelPopItems.calcItemHeight() * idx;
            const lineMinY = lineMaxY - this.vars.infoPanelPopItems.height;

            page.drawText(truncateText(pn.properties.name, 30), {
                x: internalDims.minX,
                y: lineMinY,
                size: this.vars.infoPanelPopItems.height,
                font: this.vars.documentFont,
                color: rgb(0, 0, 0)
            });

            rightJustifyText(page, formatPopulation(cp.computedPop, undefined, true),
                this.vars.infoPanelPopItems.height, internalDims.maxX, lineMinY, this.vars.documentFont);
        }

        return page;
    }

    /*
    
    Note this boundaryExtent has been extended to include catchments
     */
    private async drawBoundaryMap(
        pages: PDFPage[],
        mapCoords: CoordValues,
        isMobileMap: boolean,
        hfGuid: string | null,


    ): Promise<Array<PDFPage>> {

        //Draw the line on the LHS

        for (const page of pages) {
            page.drawLine({
                start: {
                    x: mapCoords.minX,
                    y: mapCoords.minY
                },
                end: {
                    x: mapCoords.minX,
                    y: mapCoords.maxY
                },
                thickness: PageSettings.LINE_THICKNESS,
                color: rgb(0, 0, 0)
            });
        }

        //Create a VectorSource for the rendered catchment items

        //Needed because we hook into an ol event

        const image = await this.getHfBoundaryMap(mapCoords, isMobileMap, hfGuid,);

        await Promise.all(
            pages.map(page => addImage(page, image, {
                x: mapCoords.minX,
                y: mapCoords.minY,
                width: mapCoords.width,
                height: mapCoords.height,
                blendMode: BlendMode.Multiply
            }))
        );

        //Destroy the open layer map
        this.viewContainerRef.clear();
        return pages;


    }


    private async getHfBoundaryMap(
        mapCoords: CoordValues,
        isMobileMap: boolean,
        hfGuid: string | null,

    ): Promise<HTMLCanvasElement | string> {

        const logger = this.logger;

        let cacheId = _.isNil(hfGuid) ? this.boundaryData.data.boundaryId : hfGuid;
        if (isMobileMap) {
            cacheId += "mobile";
        }

        if (AppConfigService.ENABLE_PDF_DEBUG_MAP_IMAGE_CACHE) {

            logger.info(`Trying cache pdf map image cache for ${cacheId}`);

            const item: string | null = await retrieveItem(cacheId, this.debugMapImageIndexDb);

            if (!_.isNil(item)) {
                logger.info(`cache found pdf map image cache for ${cacheId}`);
                return item;
            } else {
                logger.info(`cache NOT found pdf map image cache for ${cacheId}`);
            }
        }

        logger.info(`Creating Angular hf pdf map component.  hfGuid=[${hfGuid}]`);

        let map: OLMap;

        // Create the component dynamically
        if (isMobileMap) {
            const componentRef: ComponentRef<MobileMapComponent> =
                this.viewContainerRef.createComponent(MobileMapComponent);

            // Pass data to the @Input properties
            componentRef.instance.boundaryGuid = this.boundaryData.data.boundaryId;

            componentRef.instance.width = mapCoords.width;
            componentRef.instance.height = mapCoords.height;

            componentRef.changeDetectorRef.detectChanges(); // ngOnInit will be called 

            map = await firstValueFrom(componentRef.instance.mapLoaded);
        } else {
            const componentRef: ComponentRef<HfMapComponent> =
                this.viewContainerRef.createComponent(HfMapComponent);

            // Pass data to the @Input properties
            componentRef.instance.boundaryGuid = this.boundaryData.data.boundaryId;
            componentRef.instance.hfGuid = hfGuid;
            componentRef.instance.width = mapCoords.width;
            componentRef.instance.height = mapCoords.height;

            componentRef.changeDetectorRef.detectChanges(); // ngOnInit will be called 

            map = await firstValueFrom(componentRef.instance.mapLoaded);
        }
        logger.info(`Angular map component loaded`);

        const image = await createMapImage(map, mapCoords.width, mapCoords.height);

        if (AppConfigService.ENABLE_PDF_DEBUG_MAP_IMAGE_CACHE) {
            logger.info(`Storing pdf map image cache for ${cacheId}`);
            const imageDataUrl = image.toDataURL();
            await storeItem(cacheId, imageDataUrl, this.debugMapImageIndexDb);
        }

        return image;
    }


    //This is the small map on the HF detail pages
    private async buildHealthFaclityOverviewMap(
        boundaryExtent: Extent,

    ): Promise<HTMLCanvasElement | string> {

        const logger = this.logger;

        let cacheId = "overview_" + this.boundaryData.data.boundaryId;

        if (AppConfigService.ENABLE_PDF_DEBUG_MAP_IMAGE_CACHE) {

            logger.info(`Trying cache pdf map image cache for ${cacheId}`);

            const item: string | null = await retrieveItem(cacheId, this.debugMapImageIndexDb);

            if (!_.isNil(item)) {
                logger.info(`cache found pdf map image cache for ${cacheId}`);
                return item;
            } else {
                logger.info(`cache NOT found pdf map image cache for ${cacheId}`);
            }
        }

        const [mapWidth, mapHeight] = this.getOverviewMapWidthHeight(boundaryExtent);

        const componentRef: ComponentRef<OverviewMapComponent> = this.viewContainerRef.createComponent(OverviewMapComponent);

        // Pass data to the @Input properties
        componentRef.instance.boundaryGuid = this.boundaryData.data.boundaryId;

        componentRef.instance.width = mapWidth;
        componentRef.instance.height = mapHeight;

        componentRef.changeDetectorRef.detectChanges(); // ngOnInit will be called 

        const map = await firstValueFrom(componentRef.instance.mapLoaded);

        logger.info(`Angular map component loaded for overview`);

        const image = await createMapImage(map, mapWidth, mapHeight);

        if (AppConfigService.ENABLE_PDF_DEBUG_MAP_IMAGE_CACHE) {
            logger.info(`Storing pdf map image cache for ${cacheId}`);
            const imageDataUrl = image.toDataURL();
            await storeItem(cacheId, imageDataUrl, this.debugMapImageIndexDb);
        }

        return image;
    }


    /**
     * HF item in the left hand side of the boundary pdf (the pdf containing all the HFs)
     * @param index
     * @param pages
     * @param hfFeature
     * @param boundaryData
     * @param ciItems
     */
    private drawHfOnBoundaryPage(

        page: PDFPage,
        hf: GeoJsonHealthFacility,
        ciItems: Array<GeoJsonCatchmentItem>,
        hfPositionIndex: number
    ) {

        const hfBoxDims = this.vars.hfBox.dims(DimVariant.BORDER,
            hfPositionIndex);

        drawBorder(page, hfBoxDims);
        // drawBorder(page, this.vars.hfBox.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS,
        //     hfPositionIndex), [1, 0, 0]);

        if (hf.properties.type == 'outreach') {
            this.drawOutreachPanelSection(page, hf,
                ciItems, this.vars.hfBox.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS,
                    hfPositionIndex),
            )
        } else {

            this.drawFixedPostPanelBoundaryPage(page, hf,
                ciItems, this.vars.hfBox.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS,
                    hfPositionIndex),);
        }

    }


    /*
    Outreach and Fixed posts both show same fixed post header
    
    This is also called for the boundary page
    
    This is the text area to the right of the upper left GMT logo
    */
    private async drawPageHeaderText(page: PDFPage,

        //null if its the boundary page (showing all hfs)
        fixedPostHf: GeoJsonHealthFacility | null,
    ) {


        const documentFontBold = this.vars.documentFontBold;
        const documentFont = this.vars.documentFont;

        //Calculating y related variables

        //y=0 is at bottom of page
        const headerDims = this.vars.header.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS);


        //Then we have a 40% / 60% split between the NIGERIA > KANO > GAYA > BALANA > top row
        //having margin top text margin bottom text margin
        const topRowPerc = 0.4;
        const textBetMargin = 2;
        const textContentSpace = headerDims.height - textBetMargin;
        //and the rest
        const topTextMaxY = headerDims.maxY;
        const topTextMinY = topTextMaxY - _.ceil(topRowPerc * textContentSpace, 0);
        const bottomTextMaxY = topTextMinY - textBetMargin;
        const bottomTextMinY = headerDims.minY;

        const leftPadding = 10;

        //Now x related variabels
        const headerMinX = PageSettings.GMT_LOGO_SECTION_WIDTH + leftPadding;

        const isBoundaryPage = _.isNil(fixedPostHf);

        const labels = this.boundaryData.data.getBoundaryLabels(this.boundaryData.data.boundaryId);

        // Add text
        if (!isBoundaryPage) {
            const hfIconWidth = this.drawHfIcon(page, bottomTextMinY, bottomTextMaxY, headerMinX, fixedPostHf);
            page.drawText(truncateText(fixedPostHf.properties.name, 30), {
                x: headerMinX + hfIconWidth + this.vars.hfIconTextHorizontalGap,
                y: bottomTextMinY,
                size: (bottomTextMaxY - bottomTextMinY),
                font: documentFontBold
            });

        } else {
            //We'll show the boundary label
            const boundaryLabel = labels.pop()!;
            page.drawText(truncateText(boundaryLabel, 30), {
                x: headerMinX + leftPadding,
                y: bottomTextMinY,
                size: (bottomTextMaxY - bottomTextMinY),
                font: documentFontBold
            });
        }

        const textLabel = "NIGERIA > " + labels.join(" > ") + " >"

        page.drawText(textLabel.toUpperCase(), {
            x: headerMinX,
            y: topTextMinY,
            size: (topTextMaxY - topTextMinY),
            font: documentFont
        });

    }

    /*
    This is doing 
    
    the icon - outreach name
    catchement population
    pop                         pop figures
    # of settlements            <# of settlements)

    which is shared in the outreach detail page and the hf overview page
    */
    private drawOutreachPanelSection(page: PDFPage,

        outreachHf: GeoJsonHealthFacility,
        ciItems: Array<GeoJsonCatchmentItem>,
        sectionCoords: CoordValues
    ) {

        const vars = this.vars;
        const documentFontBold = this.vars.documentFontBold;

        //horizonal/vertical space between the border and the content
        const internalPadding = 5;
        //between catchment pop and the lines below
        //const textGap = 4;



        //For outreaches we have the outreach icon and name

        const subTitleMaxY = sectionCoords.maxY;
        //const internalDims = this.vars.infoPanelOutreach.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS);
        const subTitleMinY = subTitleMaxY - this.vars.infoPanelSubTitle.height;

        const outreachIconWidth = this.drawHfIcon(page, subTitleMinY, subTitleMaxY, sectionCoords.minX + internalPadding, outreachHf);

        page.drawText(truncateText(outreachHf.properties.name, 30), {
            x: sectionCoords.minX + internalPadding + outreachIconWidth + vars.hfIconTextHorizontalGap,
            y: subTitleMinY,
            size: this.vars.infoPanelSubTitle.height,
            font: documentFontBold
        });

        const secCoords = _.clone(sectionCoords);
        secCoords.maxY = subTitleMinY - this.vars.infoPanelSubTitle.margin.bottom;

        this.drawInfoPanelCatchmentPopulationSection(page,
            outreachHf, ciItems, secCoords
        );

    }

    private drawInfoPanelCatchmentPopulationSection(page: PDFPage,
        hf: GeoJsonHealthFacility,
        ciItems: Array<GeoJsonCatchmentItem>,
        sectionCoords: CoordValues
    ) {

        const vars = this.vars;


        const documentFontBold = this.vars.documentFontBold;
        const documentFont = this.vars.documentFont;
        const catchmentStats: PdfCatchmentStats = computePdfCatchmentStats(this.boundaryData, hf.properties.global_id, ciItems, this.logger);


        //Now x related variabels

        //horizonal/vertical space between the border and the content
        const internalPadding = 5;
        //between catchment pop and the lines below
        //const textGap = 4;



        //title
        let catchmentPopMaxY = sectionCoords.maxY;
        let catchmentPopMinY = catchmentPopMaxY - this.vars.infoPanelCatchPopLabel.height;

        //Fixed post
        //or outreach x of y

        page.drawText('Catchment Population', {
            x: sectionCoords.minX,
            y: catchmentPopMinY,
            size: this.vars.infoPanelCatchPopLabel.height,
            font: documentFontBold,
            color: rgb(0, 0, 0)
        });

        // 		

        const dataItemLabels = [
            "Geospatial (GIS)",
            "Estimated (EST)",
            "EST+GIS where no EST",

        ];

        const dataItemValues = [
            formatPopulation(catchmentStats.computedPop),
            formatPopulation(catchmentStats.estimatedPop),
            formatPopulation(catchmentStats.estimatedGisPop),
            //
        ]


        //formatPopulation(catchmentStats.population)
        let lastMaxY = 0;
        for (const [labelIdx, label] of dataItemLabels.entries()) {
            const textHeight = this.vars.infoPanelPopItems.height;
            const textGap = this.vars.infoPanelPopItems.verticalGap;
            page.drawText(label, {
                x: sectionCoords.minX,
                //x: 0 + PageSettings.LEFT_PANEL_CONTENT_PADDING * 2 + documentFont.widthOfTextAtSize(catchPopText, PageSettings.SUBTITLE_FONT_SIZE),
                y: catchmentPopMinY - internalPadding - textHeight - labelIdx * (textGap + textHeight),
                size: textHeight,
                font: documentFont,
                color: rgb(0, 0, 0)
            });

            //right justify
            let val = dataItemValues[labelIdx];

            const y = catchmentPopMinY - internalPadding - textHeight - labelIdx * (textGap + textHeight);

            rightJustifyText(page, val, textHeight, sectionCoords.maxX, y, documentFont);

            lastMaxY = y;
        }

        const numOfSetMinY = lastMaxY - vars.infoPanelNumSettlements.height - vars.infoPanelNumSettlements.margin.top;

        page.drawText("Number of Settlements", {
            x: sectionCoords.minX,
            y: numOfSetMinY,
            size: vars.infoPanelNumSettlements.height,
            font: documentFont,
            color: rgb(0, 0, 0)
        });
        rightJustifyText(page, catchmentStats.totalCountSettlements.toString(),
            vars.infoPanelNumSettlements.height, sectionCoords.maxX, numOfSetMinY, documentFont);

        return numOfSetMinY + vars.infoPanelNumSettlements.height;
    }

    //2 variants of the fixed post info, in boundary and detail page
    //This is for the info panel in details page
    private drawFixedPostPanelDetailSection(page: PDFPage,

        fixedPostHf: GeoJsonHealthFacility,
        ciItems: Array<GeoJsonCatchmentItem>,
        sectionCoords: CoordValues
    ) {

        const vars = this.vars;


        const documentFontBold = this.vars.documentFontBold;
        const documentFont = this.vars.documentFont;
        const catchmentStats: PdfCatchmentStats = computePdfCatchmentStats(this.boundaryData, fixedPostHf.properties.global_id, ciItems, this.logger);


        //Now x related variabels

        //horizonal/vertical space between the border and the content


        const lastMaxY = this.drawInfoPanelCatchmentPopulationSection(page,
            fixedPostHf, ciItems, sectionCoords
        );

        const outreachMinY = lastMaxY - 2 * vars.infoPanelNumSettlements.height - vars.infoPanelNumSettlements.margin.top;

        page.drawText("Number of Outreaches", {
            x: sectionCoords.minX,
            //re-use settlements dimenios
            y: outreachMinY,
            size: vars.infoPanelNumSettlements.height,
            font: documentFont,
            color: rgb(0, 0, 0)
        });
        rightJustifyText(page, fixedPostHf.properties.numParentChildren!.toString(),
            vars.infoPanelNumSettlements.height, sectionCoords.maxX,
            outreachMinY, documentFont);


    }

    //2nd variant, showing more catchment pop details
    private drawFixedPostPanelBoundaryPage(page: PDFPage,
        fixedPostHf: GeoJsonHealthFacility,
        ciItems: Array<GeoJsonCatchmentItem>,
        sectionCoords: CoordValues
    ) {

        const vars = this.vars;


        const documentFontBold = this.vars.documentFontBold;
        const documentFont = this.vars.documentFont;
        const stats = computePdfFixedPostCatchmentStats(this.boundaryData, fixedPostHf.properties.global_id, this.logger);

        const titleMaxY = sectionCoords.maxY;
        //resue outreach
        const titleMinY = titleMaxY - this.vars.infoPanelSubTitle.height;

        const hfIconWidth = this.drawHfIcon(page, titleMinY, titleMaxY, sectionCoords.minX, fixedPostHf);

        const catchment_status = this.boundaryData.data.getCatchmentStatus(fixedPostHf);
        const statusText = "[" + (catchment_status !== "Unknown" ? catchment_status : 'Not ready') + "]";

        const subTitelHorTextGap = 7;

        const statusWidth = documentFont.widthOfTextAtSize(statusText, this.vars.infoPanelSubTitle.height) + 10;
        page.drawText(statusText, {
            x: sectionCoords.minX + hfIconWidth + vars.hfIconTextHorizontalGap,
            y: titleMinY,
            size: this.vars.infoPanelSubTitle.height,
            font: documentFontBold
        });

        page.drawText(truncateText(fixedPostHf.properties.name, 27), {
            x: sectionCoords.minX + hfIconWidth + vars.hfIconTextHorizontalGap + statusWidth + subTitelHorTextGap,
            y: titleMinY,
            size: this.vars.infoPanelSubTitle.height,
            font: documentFontBold
        });


        const internalPadding = 5;

        //title
        let catchmentPopMaxY = titleMinY - this.vars.infoPanelSubTitle.margin.bottom - this.vars.infoPanelCatchPopLabel.margin.top;
        let catchmentPopMinY = catchmentPopMaxY - this.vars.infoPanelCatchPopLabel.height;

        //we need 4 columns
        //label, fixed post, outreach, total
        const colWidth = 75;

        const labels = [
            "Catchment Population", "Fixed post", "Outreach", "Total"
        ];
        const colMinX = [
            sectionCoords.minX,
            sectionCoords.maxX - 3 * colWidth,
            sectionCoords.maxX - 2 * colWidth,
            sectionCoords.maxX - 1 * colWidth,
        ]

        for (let i = 0; i < labels.length; ++i) {
            if (i == 0) {
                page.drawText(labels[i], {
                    x: colMinX[i],
                    y: catchmentPopMinY,
                    size: this.vars.infoPanelCatchPopLabel.height,
                    font: documentFontBold,
                    color: rgb(0, 0, 0)
                });
            } else {
                rightJustifyText(page, labels[i], this.vars.infoPanelCatchPopLabel.height, colMinX[i] + colWidth, catchmentPopMinY, documentFont);
            }
        }

        // 		

        const dataItemLabels = [
            "Geospatial (GIS)",
            "Estimated (EST)",
            "EST+GIS where no EST",
        ];

        //formatPopulation(catchmentStats.population)
        let lastMaxY = 0;
        for (const [labelIdx, label] of dataItemLabels.entries()) {
            const textHeight = this.vars.infoPanelPopItems.height;
            const textGap = this.vars.infoPanelPopItems.verticalGap;
            const y = catchmentPopMinY - internalPadding - textHeight - labelIdx * (textGap + textHeight);
            page.drawText(label, {
                x: sectionCoords.minX,
                //x: 0 + PageSettings.LEFT_PANEL_CONTENT_PADDING * 2 + documentFont.widthOfTextAtSize(catchPopText, PageSettings.SUBTITLE_FONT_SIZE),
                y,
                size: textHeight,
                font: documentFont,
                color: rgb(0, 0, 0)
            });

            for (let i = 0; i < 3; ++i) {

                //right justify
                let val = "";
                if (labelIdx == 0) {
                    val = formatPopulation(stats[i].computedPop);
                } else if (labelIdx == 1) {
                    val = formatPopulation(stats[i].estimatedPop);
                }
                else if (labelIdx == 2) {
                    val = formatPopulation(stats[i].estimatedGisPop);
                }

                const y = catchmentPopMinY - internalPadding - textHeight - labelIdx * (textGap + textHeight);

                rightJustifyText(page, val, textHeight, colMinX[i + 1] + colWidth, y, documentFont);

                lastMaxY = y;
            }
        }
        // const numOfSetMinY = lastMaxY - vars.infoPanelNumSettlements.height - vars.infoPanelNumSettlements.margin.top;

        // page.drawText("Number of Settlements", {
        //     x: sectionCoords.minX,
        //     y: numOfSetMinY,
        //     size: vars.infoPanelNumSettlements.height,
        //     font: documentFont,
        //     color: rgb(0, 0, 0)
        // });
        // for (let i = 0; i < 3; ++i) {

        //     rightJustifyText(page, stats[i].totalCountSettlements.toString(),
        //         vars.infoPanelNumSettlements.height, colMinX[i] + colWidth, numOfSetMinY, documentFont);
        // }


    }

    private drawInfoPanelSection(page: PDFPage,

        //Either the outreach or the fixed post
        hf: GeoJsonHealthFacility,
        ciItems: Array<GeoJsonCatchmentItem>,
    ) {

        const vars = this.vars;


        const documentFontBold = this.vars.documentFontBold;
        const documentFont = this.vars.documentFont;
        const catchmentStats: PdfCatchmentStats = computePdfCatchmentStats(this.boundaryData, hf.properties.global_id, ciItems, this.logger);

        //Calculating y related variables

        //y=0 is at bottom of page


        //Now x related variabels

        //horizonal/vertical space between the border and the content
        //const internalPadding = 5;
        //between catchment pop and the lines below

        drawBorder(page, vars.infoPanel.dims(DimVariant.BORDER));


        const titleHeight = vars.infoPanelTitle.height;
        const internalDims = vars.infoPanel.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS);
        const titleLineMaxY = internalDims.maxY;
        const titleLineMinY = titleLineMaxY - titleHeight;

        //For outreaches we have the outreach icon and name

        //Fixed post
        //or outreach x of y

        let infoSectionTitle = "";
        const catchment_status = this.boundaryData.data.getCatchmentStatus(hf);
        if (hf.properties.type == 'fixed_post') {
            infoSectionTitle = "Fixed Post.  Status: " + (catchment_status !== "Unknown" ? catchment_status : 'Not ready');
        } else {
            infoSectionTitle = `Outreach ${hf.properties.childIndex! + 1} of ${hf.properties.numParentChildren}`;
        }

        //const statusText = 'Status:';
        page.drawText(infoSectionTitle, {
            x: internalDims.minX,
            y: titleLineMinY,
            size: (titleLineMaxY - titleLineMinY),
            font: documentFont,
            color: rgb(0, 0, 0)
        });


        const subSectionDims = _.clone(internalDims);
        const subTitleTopMargin = 10;
        subSectionDims.maxY = titleLineMinY - subTitleTopMargin;

        if (hf.properties.type == 'outreach') {

            this.drawOutreachPanelSection(
                page, hf, ciItems,
                subSectionDims
            )
        } else {
            this.drawFixedPostPanelDetailSection(page, hf, ciItems, subSectionDims);

        }

    }


    private async drawDefaultPageFrame(
        pages: PDFPage[],
    ): Promise<PDFPage[]> {


        const loadedLogo = await loadSVG(PageSettings.HEADER_LOGO);

        for (const page of pages) {
            const embeddedPage = await page.doc.embedPage(loadedLogo as PDFPage);
            const headerDims = this.vars.header.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS);
            const logoRatio = headerDims.height / embeddedPage.height;

            const logoMinX = headerDims.minX;
            const logoMaxX = logoMinX + embeddedPage.width * logoRatio;
            //treat padding left as the internal padding right
            PageSettings.GMT_LOGO_SECTION_WIDTH = this.vars.header.padding.left * 2 + (logoMaxX - logoMinX);

            // Draw app logo
            page.drawPage(embeddedPage, {
                x: logoMinX,
                y: headerDims.minY,
                xScale: logoRatio,
                yScale: logoRatio
            });


            // Add frames
            const headerBorder = this.vars.header.dims(DimVariant.BORDER);

            //Line between header and content
            page.drawLine({
                start: {
                    x: headerBorder.minX,
                    y: headerBorder.minY,
                },
                end: {
                    x: headerBorder.maxX,
                    y: headerBorder.minY,
                },
                thickness: PageSettings.LINE_THICKNESS,
                color: rgb(0, 0, 0)
            });

            page.drawLine({
                start: {
                    x: PageSettings.GMT_LOGO_SECTION_WIDTH,
                    y: headerBorder.minY,
                },
                end: {
                    x: PageSettings.GMT_LOGO_SECTION_WIDTH,
                    y: headerBorder.maxY,
                },
                thickness: PageSettings.LINE_THICKNESS,
                color: rgb(0, 0, 0)
            });
            page.drawLine({
                start: {
                    x: page.getWidth() - this.vars.pageCounterWidth,
                    y: headerBorder.minY,
                },
                end: {
                    x: page.getWidth() - this.vars.pageCounterWidth,
                    y: headerBorder.maxY,
                },
                thickness: PageSettings.LINE_THICKNESS,
                color: rgb(0, 0, 0)
            });
            page.drawLine({
                start: {
                    x: page.getWidth() - this.vars.pageCounterWidth - this.vars.dateWidth,
                    y: headerBorder.minY,
                },
                end: {
                    x: page.getWidth() - this.vars.pageCounterWidth - this.vars.dateWidth,
                    y: headerBorder.maxY,
                },
                thickness: PageSettings.LINE_THICKNESS,
                color: rgb(0, 0, 0)
            });

            // Draw user & date
            //const widthCounter = PageSettings.HEADER_HEIGHT * 2.5;
            //const headerDividerY = height - PageSettings.HEADER_HEIGHT * 0.5;

            const now = new Date();
            const dateString = now.toLocaleDateString();
            page.drawText(dateString, {
                x: page.getWidth() - this.vars.pageCounterWidth - this.vars.dateWidth + 4,
                y: headerBorder.minY + 0.25 * headerBorder.height,
                size: 0.5 * headerBorder.height,
                font: this.vars.documentFontBold,
            });
        }

        return pages;
    }


    // private async drawMapLegend(
    //     pages: PDFPage[],
    //     mapDims: CoordValues,
    //     options: {
    //         title: string,
    //         corner: 'll' | 'lr' | 'ul' | 'ur'
    //     }
    // ) {
    //     if (pages.length <= 0) {
    //         return;
    //     }


    //     const vars = this.vars;
    //     const documentFontBold = this.vars.documentFontBold;
    //     const documentFont = this.vars.documentFont;
    //     const maxWidth = vars.legend.dims(DimVariant.INTERNAL).width;

    //     const legend = BOUNDARY_LEGEND_ITEMS;
    //     const legendSpacing = this.vars.legend.padding.left;
    //     const legendMargin = 8;
    //     const legendBorderThickness = PageSettings.LINE_THICKNESS;
    //     const legendIconHeight = documentFontBold.heightAtSize(PageSettings.SUBTITLE_FONT_SIZE) * 1.2;
    //     const legendIconWidth = legendIconHeight * 1.5;
    //     // Initial legend height
    //     let legendHeight = legendIconHeight + legendSpacing * 2;
    //     // Legend width derived by max text length or configured max width
    //     let legendWidth = Math.min(
    //         maxWidth,
    //         legend.map(
    //             //add some spaces to prevent line wrap
    //             c => documentFont.widthOfTextAtSize(c.text + "  ", PageSettings.HEADER_FONT_SIZE)
    //         ).sort(
    //             (a, b) => b - a
    //         )[0] + legendSpacing * 3 + legendIconWidth
    //     );
    //     // Wrap text if required
    //     const legendCategoryText = legend.map(c => layoutMultilineText(c.text, {
    //         alignment: TextAlignment.Left,
    //         font: documentFont,
    //         fontSize: PageSettings.HEADER_FONT_SIZE,
    //         // @ts-ignore
    //         bounds: {
    //             width: legendWidth - 3 * legendSpacing - legendIconWidth,
    //             height: 10000
    //         }
    //     })
    //     );
    //     // Update legend height based on wrapped text
    //     legendCategoryText.forEach(category => {
    //         return legendHeight += (Math.max(
    //             legendIconHeight,
    //             category.lines.length * category.lineHeight + legendIconHeight / 2 - category.lineHeight / 2
    //         ) + legendSpacing);
    //     });
    //     const legendX = ['ll', 'ul'].includes(options.corner) ?
    //         mapDims.minX + legendMargin :
    //         mapDims.maxX - legendMargin - legendWidth;
    //     const legendY = ['lr', 'll'].includes(options.corner) ?
    //         mapDims.minY + legendMargin :
    //         mapDims.maxY - legendMargin - legendHeight;
    //     for (const page of pages) {
    //         page.drawRectangle({
    //             x: legendX,
    //             y: legendY,
    //             width: legendWidth,
    //             height: legendHeight,
    //             borderWidth: legendBorderThickness,
    //             borderLineCap: LineCapStyle.Round,
    //             color: rgb(1, 1, 1),
    //             borderColor: rgb(0, 0, 0)
    //         });
    //         page.drawText(options.title, {
    //             x: legendX + legendSpacing,
    //             y: legendY + legendHeight - legendSpacing - legendIconHeight * 0.5 - PageSettings.SUBTITLE_FONT_SIZE * 0.5,
    //             size: PageSettings.SUBTITLE_FONT_SIZE,
    //             font: documentFontBold
    //         });

    //         let categoryY = legendY + legendHeight - (legendIconHeight * 2 + legendSpacing * 2);

    //         for (const [index, categoryText] of legendCategoryText.entries()) {

    //             const rectOpts: PDFPageDrawRectangleOptions = {
    //                 x: legendX, // + PageSettings.HEADER_MARGIN * 2,
    //                 y: categoryY,
    //                 width: legendIconWidth,
    //                 height: legendIconHeight,
    //                 borderWidth: 1,
    //                 borderLineCap: LineCapStyle.Round,
    //                 borderColor: rgb(0, 0, 0)
    //             }

    //             const category = legend[index];

    //             switch (category.type) {
    //                 case "icon":
    //                     await addImage(page, category.icon, {
    //                         x: legendX, // + PageSettings.HEADER_MARGIN * 2,
    //                         y: categoryY,
    //                         width: legendIconWidth,
    //                         height: legendIconHeight,
    //                         blendMode: BlendMode.Multiply
    //                     });
    //                     break;
    //                 case "color":
    //                     //console.log(`For category ${category.text} color is ${category.color}`);
    //                     rectOpts.color = rgb(category.color[0], category.color[1], category.color[2]);
    //                     rectOpts.opacity = category.color[3];
    //                     break;
    //             }

    //             page.drawRectangle(rectOpts);

    //             categoryText.lines.forEach((l, index) => {
    //                 page.drawText(l.text, {
    //                     x: legendX + legendIconWidth + legendSpacing * 2,
    //                     y: categoryY + legendIconHeight * 0.5 - PageSettings.HEADER_FONT_SIZE * 0.5,
    //                     size: PageSettings.HEADER_FONT_SIZE,
    //                     font: documentFont
    //                 });
    //                 if (categoryText.lines.length > 1) {
    //                     if (index !== categoryText.lines.length - 1) {
    //                         categoryY -= categoryText.lineHeight;
    //                     } else {
    //                         categoryY += 2;
    //                     }
    //                 }
    //             });
    //             categoryY -= legendIconHeight + legendSpacing;

    //         }
    //     }
    // }


    /*
    Overview map on HF detail page
     */
    private async drawOverviewMap(
        page: PDFPage,
        boundaryExtent: Extent,
        catchmentExtent: Extent,
        overviewMapImage: HTMLCanvasElement | string,

    ): Promise<PDFPage> {

        const vars = this.vars;

        //const { leftPanelWidth, leftPanelPadding, overviewBottomY } = vars;
        //const maxMapWidth = leftPanelWidth - 2 * leftPanelPadding;

        const [mapWidth, mapHeight] = this.getOverviewMapWidthHeight(boundaryExtent);

        // Add as image to pages
        //const sectionBoundaryDims = this.vars.overview.dims(DimVariant.BORDER);

        drawBorder(page, vars.overview.dims(DimVariant.BORDER));

        //debugging
        //drawBorder(page, vars.overview.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS), [1, 0, 0]);

        const internalDims = this.vars.overview.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS);

        const overviewMapImageOpts: PDFPageDrawImageOptions = {
            x: internalDims.minX,
            y: internalDims.minY,
            width: mapWidth,
            height: mapHeight,
            blendMode: BlendMode.Multiply
        };

        try {
            await addImage(page, overviewMapImage, overviewMapImageOpts);
        } catch (error) {
            this.logger.error('Could not create map image: ', error);
        }

        //We also want to draw a red square of the catchment extent

        //minX, minY, maxX, maxY

        //First calculate the % within the boundary extent
        const percXStart = calcPerc(boundaryExtent[0], boundaryExtent[2], catchmentExtent[0]);
        const percXStop = calcPerc(boundaryExtent[0], boundaryExtent[2], catchmentExtent[2]);
        const percYStart = calcPerc(boundaryExtent[1], boundaryExtent[3], catchmentExtent[1]);
        const percYStop = calcPerc(boundaryExtent[1], boundaryExtent[3], catchmentExtent[3]);

        const redRectXStart = overviewMapImageOpts.x! + percXStart * overviewMapImageOpts.width!;
        const redRectXStop = overviewMapImageOpts.x! + percXStop * overviewMapImageOpts.width!;
        const redRectYStart = overviewMapImageOpts.y! + percYStart * overviewMapImageOpts.height!;
        const redRectYStop = overviewMapImageOpts.y! + percYStop * overviewMapImageOpts.height!;


        page.drawRectangle({
            x: redRectXStart,
            y: redRectYStart,
            width: redRectXStop - redRectXStart,
            height: redRectYStop - redRectYStart,
            borderWidth: PageSettings.LINE_THICKNESS,
            borderLineCap: LineCapStyle.Round,
            borderColor: rgb(1, 0, 0)
        });

        // Resolve pages
        return page;

    }



    private getOverviewMapWidthHeight(
        boundaryExtent: Extent): [number, number] {
        const boundaryExtentRatio = Math.abs((boundaryExtent[2] - boundaryExtent[0]) / (boundaryExtent[3] - boundaryExtent[1]));

        const maxDims = this.vars.overview.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS);

        //ratio is width / height

        //either we take max width or max height

        //take max width
        const mapWidth1 = maxDims.width;
        const mapHeight1 = mapWidth1 / boundaryExtentRatio;

        //take max height
        const mapHeight2 = maxDims.height;
        const mapWidth2 = mapHeight2 * boundaryExtentRatio;

        if (mapHeight1 <= maxDims.height) {
            return [mapWidth1, mapHeight1];
        } else {
            return [mapWidth2, mapHeight2];
        }

    }



    private async drawMapLegendForHfDetail(
        page: PDFPage,
    ) {

        const vars = this.vars;

        const legendSpacing = this.vars.legend.padding.left;
        //const legendBorderThickness = PageSettings.LINE_THICKNESS;
        const legendIconHeight = this.vars.documentFontBold.heightAtSize(PageSettings.SUBTITLE_FONT_SIZE) * 1.2;
        const legendIconWidth = legendIconHeight * 1.5;

        drawBorder(page, this.vars.legend.dims(DimVariant.BORDER));

        const internalDims = this.vars.legend.dims(DimVariant.INTERNAL);

        let currentY = internalDims.maxY - PageSettings.HEADER_FONT_SIZE;
        page.drawText(HF_DETAIL_LEGEND_TITLE, {
            x: internalDims.minX,
            y: currentY,
            size: PageSettings.SUBTITLE_FONT_SIZE,
            font: this.vars.documentFontBold
        });

        for (const category of HF_DETAIL_LEGEND_ITEMS) {
            //Todo use vertical gap
            currentY -= legendSpacing + legendIconHeight;

            const rectOpts: PDFPageDrawRectangleOptions = {
                x: internalDims.minX,
                y: currentY,
                width: legendIconWidth,
                height: legendIconHeight,
                borderWidth: 1,
                borderLineCap: LineCapStyle.Round,
                borderColor: rgb(0, 0, 0)
            };
            switch (category.type) {
                case "icon":
                    await addImage(page, category.icon, {
                        x: internalDims.minX,
                        y: currentY,
                        width: legendIconWidth,
                        height: legendIconHeight,
                        blendMode: BlendMode.Multiply
                    });
                    break;
                case "color":
                    rectOpts.color = rgb(category.color[0], category.color[1], category.color[2]);
                    rectOpts.opacity = category.color[3];
                    break;
            }
            page.drawRectangle(rectOpts);

            page.drawText(category.text, {
                x: internalDims.minX + legendIconWidth + legendSpacing * 2,
                y: currentY,
                size: PageSettings.HEADER_FONT_SIZE,
                font: this.vars.documentFont
            });

        }

    }


    private drawHfIcon(
        page: PDFPage,
        minY: number, maxY: number,
        minX: number, //maxX: number,
        //circleColor: null | number[],
        //circleText: string,
        hf: GeoJsonHealthFacility
    ) {

        const hfIconEmbedded: PDFEmbeddedPage =
            (hf.properties.type == 'outreach') ? this.vars.outreachIconEmbedded : this.vars.hfIconEmbedded;

        let hfIconHeight = (maxY - minY);
        let yScale = hfIconHeight / hfIconEmbedded.height;
        //0.8 is to make the icon, which is thinner than tall, look less distorted
        let xScale = yScale;
        page.drawPage(hfIconEmbedded, {
            x: minX,
            y: minY,
            xScale,
            yScale,
        });
        //}
        const hfIconWidth = hfIconHeight / hfIconEmbedded.height * hfIconEmbedded.width;
        const circleSize = hfIconWidth / 3;
        const hfColor = asArray(hf.properties.color!);

        //the circle & its label (2a, 3, etc.)
        const circleMinY = maxY - circleSize
        page.drawCircle({
            x: minX + hfIconWidth,
            y: circleMinY,
            size: circleSize,
            color: rgb(hfColor[0] / 255, hfColor[1] / 255, hfColor[2] / 255),
        });
        const numberFontSize = circleSize * 1.3;
        page.drawText(hf.properties.index!, {
            x: minX + hfIconWidth - this.vars.documentFont.widthOfTextAtSize(hf.properties.index!, numberFontSize) * 0.5,
            y: circleMinY - circleSize / 2,
            size: numberFontSize,
            font: this.vars.documentFont,
            color: rgb(1, 1, 1)
        });

        return hfIconWidth;
    }


    private enumeratePages(pdf: PDFDocument) {
        const pageCount = pdf.getPageCount();

        const headerBorder = this.vars.header.dims(DimVariant.BORDER);
        pdf.getPages().forEach((page, index) => {
            const pageNumberText = `${index + 1} / ${pageCount}`;
            page.drawText(pageNumberText, {
                x: page.getWidth() - this.vars.pageCounterWidth + 20,
                y: headerBorder.minY + 0.25 * headerBorder.height,
                size: 0.5 * headerBorder.height,
                font: this.vars.documentFontBold,
            });
        });
    }


    private initMobilePages(
        mobileSettlements: Array<[GeoJsonSettlementName, CatchmentPopulation]>,
        pdf: PDFDocument
    ): Array<[PDFPage, Array<[GeoJsonSettlementName, CatchmentPopulation]>]> {

        //title + subtitle height

        const titleHeights = this.vars.infoPanelTitle.calcItemHeight() + this.vars.infoPanelCatchPopLabel.calcItemHeight();

        const mobileRowHeights = this.vars.infoPanelPopItems.calcItemHeight();

        const mobilePerPage =
            _.floor((this.vars.detailLeftPanelSection.dims(DimVariant.INTERNAL_MINUS_BORDER_THICKNESS).height - titleHeights) / mobileRowHeights);

        let pages = _.ceil(mobileSettlements.length / mobilePerPage);

        if (pages <= 0) {
            pages = 1;
        }

        const ret: Array<[PDFPage, Array<[GeoJsonSettlementName, CatchmentPopulation]>]> = [];

        for (let i = 0; i < pages; ++i) {

            // Add HF page to list for each considered HF
            const boundaryPage = pdf.getPage(0);
            const size = [boundaryPage.getSize().width, boundaryPage.getSize().height] as [number, number];
            const page = pdf.addPage(size);


            const items: Array<[GeoJsonSettlementName, CatchmentPopulation]> = [];

            while (mobileSettlements.length > 0 && items.length < mobilePerPage) {
                items.push(mobileSettlements.shift()!);
            }

            ret.push([page, items]);
        }

        return ret;
    }
}


function initHealthFacilityPages(
    vectorSourceHfs: Array<Feature<Geometry>>,
    pdf: PDFDocument
): Array<[Feature<Geometry>, PDFPage]> {

    const ret: Array<[Feature<Geometry>, PDFPage]> = vectorSourceHfs.map(hf => {
        // Add HF page to list for each considered HF
        const boundaryPage = pdf.getPage(0);
        const size = [boundaryPage.getSize().width, boundaryPage.getSize().height] as [number, number];
        const page = pdf.addPage(size);
        return [hf, page];
    });



    return ret;
}


function truncateText(text: string, max: number) {
    return text.length > max ? `${text.substring(0, max)}...` : text;
}

function rightJustifyText(
    page: PDFPage,
    text: string, textHeight: number, maxX: number, minY: number, documentFont: PDFFont) {
    const minX = maxX - documentFont.widthOfTextAtSize(text, textHeight);
    page.drawText(text, {
        x: minX,
        y: minY,
        size: textHeight,
        font: documentFont,
        color: rgb(0, 0, 0)
    });
}


function drawBorder(
    page: PDFPage,
    coords: CoordValues,
    borderColor = [0, 0, 0]
) {

    page.drawRectangle({
        x: coords.minX,
        y: coords.minY,
        width: coords.width,
        height: coords.height,
        borderWidth: 1,
        borderLineCap: LineCapStyle.Round,
        color: rgb(1, 1, 1),
        borderColor: rgb(borderColor[0], borderColor[1], borderColor[2])
    });
}