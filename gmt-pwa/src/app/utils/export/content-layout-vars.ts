
import {
    PDFDocument,
    PDFEmbeddedPage,
    PDFFont,
    PDFPage
} from "pdf-lib";
import "svg2pdf.js";




import _ from "lodash";
import { embedSVG, PageSettings } from "./pdf";
import { HF_DETAIL_LEGEND_ITEMS } from "./legend-const";


export class SectionDimensions {
    //For a section that is a line of text, in pdf font size and height seem to be the same
    //this does not include the margins
    //For a section that is a box, this is the height of the box
    //Does NOT include padding, nor margins
    //This is 'internal' height
    height: number = 0;
    width: number | null = null;
    //height between items, not included in height
    verticalGap: number = 0;

    //How  much removed from parent top; note this is done once, even for many items, see verticalGap
    offsetY: number = 0;
    //how much added to parent minx
    offsetX: number = 0;

    //Like css
    margin: DimValues;
    padding: DimValues;

    parent: SectionDimensions | null = null;

    /*
Like CSS

margin top
[if border drawn, this is where it is, like css]
padding top
item 1 --height
padding bottom
[if border drawn, this is where it is, like css]
margin bottom

veritical gap

margin top
padding top
item 2 -- height
padding bottom
[if border drawn, this is where it is, like css]
margin bottom

veritical gap
...
more items

    */
    constructor() {
        this.margin = _.cloneDeep(DEFAULT_DIM_VALUES);
        this.padding = _.cloneDeep(DEFAULT_DIM_VALUES);
    }

    setHeight(v: number): SectionDimensions {

        this.height = v;
        return this;
    }
    setWidth(v: number): SectionDimensions {
        this.width = v;
        return this;
    }
    setAvailableWidth(v: number): SectionDimensions {
        this.width = v - this.padding.left - this.padding.right - this.margin.left - this.margin.right;
        return this;
    }
    setAvailableHeight(v: number): SectionDimensions {
        this.height = v - this.padding.top - this.padding.bottom - this.margin.top - this.margin.bottom;
        return this;
    }
    setVerticalGap(v: number): SectionDimensions {
        this.verticalGap = v;
        return this;
    }

    setMargin(margin: Partial<DimValues>): SectionDimensions {
        _.assign(this.margin, margin);
        return this;
    }
    setOffsetY(v: number): SectionDimensions {
        this.offsetY = v;
        return this;
    }
    setOffsetX(v: number): SectionDimensions {
        this.offsetX = v;
        return this;
    }
    setPadding(padding: Partial<DimValues>): SectionDimensions {
        _.assign(this.padding, padding);
        return this;
    }
    setParent(p: SectionDimensions): SectionDimensions {
        this.parent = p;
        return this;
    }
    setTopBotLeftRightPadding(padding: number): SectionDimensions {
        this.padding.bottom = padding;
        this.padding.left = padding;
        this.padding.right = padding;
        this.padding.top = padding;
        return this;
    }

    //Adds margins/padding too
    calcItemHeight(numItems: number = 1): number {
        if (numItems <= 0) {
            return 0;
        }

        return (this.margin.top + this.margin.bottom +
            this.padding.top + this.padding.bottom + this.height)
            * numItems + (numItems - 1) * this.verticalGap;
    }


    calcBorderCoordsTopAdj(
        parentCoords: CoordValues,
        topAdj: number): CoordValues {

        if (!_.isNil(this.width)) {
            throw new Error("This should NOT have width as we are using parent width");
        }

        const maxY = parentCoords.maxY - this.margin.top - topAdj - this.offsetY;
        return new CoordValues({
            maxY,
            minY: maxY - this.padding.top - this.height - this.padding.bottom,
            minX: parentCoords.minX + this.margin.left,
            maxX: parentCoords.maxX - this.margin.right,
        })

    }

    //where border is, between margin & padding
    // absBorderCoords(): CoordValues {
    //     if (_.isNil(this.width)) {
    //         throw new Error("No width");
    //     }
    //     return new CoordValues({
    //         maxY: this.margin.bottom + this.padding.bottom + this.height + this.padding.top,
    //         minY: this.margin.bottom,
    //         minX: this.margin.left,
    //         maxX: this.margin.left + this.padding.left + this.width + this.padding.right
    //     })
    // }

    //Item position including margin
    dims(variant: DimVariant = DimVariant.TOTAL_SPACE, numIndex: number = 0): CoordValues {
        //Root should be page section
        if (_.isNil(this.parent)) {

            if (_.isNil(this.width)) {
                throw new Error("width nil");
            }
            const minY = this.margin.bottom + this.padding.bottom;
            const minX = this.margin.left + this.padding.left;
            return new CoordValues({
                maxY: minY + this.height,
                minY,
                minX,
                maxX: minX + this.width
            });
        }
        if (_.isNil(this.parent) || _.isNil(this.parent.width)) {
            throw new Error("no parent width")
        }

        const parentPos = this.parent.dims(DimVariant.INTERNAL);
        const topAdj = numIndex < 1 ? 0 : this.calcItemHeight(numIndex) + this.verticalGap;
        const maxY = parentPos.maxY - this.offsetY - topAdj;


        const totalSpaceCoords = new CoordValues({
            maxY: maxY,
            minY: maxY - this.calcItemHeight(),
            minX: parentPos.minX + this.offsetX,
            maxX: parentPos.maxX
        });

        //If we have a width, then use it
        if (!_.isNil(this.width)) {
            totalSpaceCoords.maxX = totalSpaceCoords.minX + this.padding.left + this.padding.right + this.margin.left + this.margin.right + this.width
        }

        //3 variants, with padding/margin, padding, just content
        if (variant == DimVariant.TOTAL_SPACE) {
            return totalSpaceCoords
        } else if (variant == DimVariant.BORDER) {
            return new CoordValues({
                minX: totalSpaceCoords.minX + this.margin.left,
                maxX: totalSpaceCoords.maxX - this.margin.right,
                minY: totalSpaceCoords.minY + this.margin.bottom,
                maxY: totalSpaceCoords.maxY - this.margin.top
            });
        } else if (variant == DimVariant.INTERNAL) {
            return new CoordValues({
                minX: totalSpaceCoords.minX + this.margin.left + this.padding.left,
                maxX: totalSpaceCoords.maxX - this.margin.right - this.padding.right,
                minY: totalSpaceCoords.minY + this.margin.bottom + this.padding.bottom,
                maxY: totalSpaceCoords.maxY - this.margin.top - this.padding.top
            });
        }
        else if (variant == DimVariant.INTERNAL_MINUS_BORDER_THICKNESS) {
            return new CoordValues({
                minX: totalSpaceCoords.minX + this.margin.left + this.padding.left + PageSettings.LINE_THICKNESS,
                maxX: totalSpaceCoords.maxX - this.margin.right - this.padding.right - PageSettings.LINE_THICKNESS,
                minY: totalSpaceCoords.minY + this.margin.bottom + this.padding.bottom + PageSettings.LINE_THICKNESS,
                maxY: totalSpaceCoords.maxY - this.margin.top - this.padding.top - PageSettings.LINE_THICKNESS
            });
        }
        else {
            throw new Error(`Unknown variant ${variant}`);
        }
    }

    //returns relative values to a top left corner
    //uses width from parent
    // calcBorderCoords(
    //     parentCoords: CoordValues,
    //     numIndex: number): CoordValues {

    //     if (!_.isNil(this.width)) {
    //         throw new Error("This should NOT have width as we are using parent width");
    //     }

    //     let topAdj = 0;

    //     if (numIndex > 0) {
    //         topAdj = this.calcItemHeight(numIndex) + this.verticalGap
    //     }
    //     return this.calcBorderCoordsTopAdj(parentCoords, topAdj);

    // }

}

export enum DimVariant {
    //with padding/margin
    TOTAL_SPACE = 0,
    //just padding
    BORDER = 1,
    //just data
    INTERNAL = 2,

    //not sure if needed, but to account for border thickness too
    INTERNAL_MINUS_BORDER_THICKNESS = 3,
}


export class CoordValues {
    maxY: number = 0
    minX: number = 0
    maxX: number = 0
    //y = 0 is the bottom of the page
    minY: number = 0

    constructor(initVals: {
        maxY: number
        minX: number,
        maxX: number,
        //y = 0 is the bottom of the page
        minY: number
    }) {
        this.maxX = initVals.maxX;
        this.maxY = initVals.maxY;
        this.minX = initVals.minX;
        this.minY = initVals.minY;
    }

    //depending on which variant this could be internal/border/total
    get height(): number {
        return this.maxY - this.minY;
    }

    get width(): number {
        return this.maxX - this.minX;
    }
}

interface DimValues {
    top: number
    left: number
    right: number
    bottom: number
}
const DEFAULT_DIM_VALUES: DimValues = {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0
}

export interface ContentLayoutVars {
    //legendIconHeight: number;

    //Includes internal padding
    //leftPanelWidth: number;


    //legendHeight: number;
    //y=0 is bottom of page, this is the top of legend
    //legendY: number;

    //Distance vertical/horizontal between left panel internal borders and actual left panel boundary
    //leftPanelPadding: number;

    //Vertical Distance between the label section, the overview map, and the legend
    //leftPanelInternalPadding: number;


    hfIconEmbedded: PDFEmbeddedPage;
    outreachIconEmbedded: PDFEmbeddedPage;
    //width between icon and text to the right
    hfIconTextHorizontalGap: number;

    logoHeight: number;

    //page height, note y=0 is the bottom of the page
    pageSection: SectionDimensions;

    //These take into account the marigns between left panel edges and the boxes
    detailLeftPanelSection: SectionDimensions;

    //In the page listing all hf pages
    boundaryLeftPanelSection: SectionDimensions;

    detailMap: SectionDimensions,
    boundaryMap: SectionDimensions,

    //these are in order, these take into account the padding between left panel edges and the boxes
    legend: SectionDimensions;

    //some padding between

    overview: SectionDimensions;

    infoPanel: SectionDimensions;

    header: SectionDimensions;

    documentFontBold: PDFFont;
    documentFont: PDFFont;

    //How many hfs to put on the non detail pdf
    hfsPerPage: number;

    //in main hf over page, width per fp / outreach
    //does not include space between
    hfBox: SectionDimensions;




    //In info section panels (both detail pages)
    //icon + label line
    //reused this for fixed post in detail tab too
    infoPanelSubTitle: SectionDimensions
    //catchment pop label line
    infoPanelCatchPopLabel: SectionDimensions
    infoPanelPopItems: SectionDimensions

    //reused for num of outreaches too
    infoPanelNumSettlements: SectionDimensions


    pageCounterWidth: number,
    dateWidth: number,


    //used in mobile, and info panel
    //eg. outreach 1/4; fixed post complete, and mobile settlements 
    infoPanelTitle: SectionDimensions


}



export const HF_LOGO_SIZE = PageSettings.SUBTITLE_FONT_SIZE * 1.3;

//export const HF_BOX_HEIGHT = PageSettings.LEFT_PANEL_CONTENT_PADDING * 4 + PageSettings.CONTENT_FONT_SIZE * 3;

//In non detail page, how much vertical space per health facility (fixed post/outreach use the same amount)
//export const HF_ENTRY_PAGE_MARGIN = 10;
//export const HF_ENTRY_PAGE_SPACE_BETWEEN = 7;
//export const HF_ENTRY_HEIGHT = HF_LOGO_SIZE + 1.5 * PageSettings.LEFT_PANEL_CONTENT_PADDING + PageSettings.CONTENT_FONT_SIZE + HF_BOX_HEIGHT;

export async function buildAllVars(pdf: PDFDocument, page: PDFPage,): Promise<ContentLayoutVars> {

    const width = page.getWidth();
    const height = page.getHeight();

    const pageSection = new SectionDimensions().setHeight(height).setWidth(width);

    // Embed default fonts
    const documentFont = await pdf.embedFont(PageSettings.DOCUMENT_FONT);
    const documentFontBold = await pdf.embedFont(PageSettings.DOCUMENT_FONT_BOLD);


    //these are where the sub boxes start on the left-hand side  [pageMargin space] then [frame] then [page margin space]

    const legendIconHeight = documentFontBold.heightAtSize(PageSettings.SUBTITLE_FONT_SIZE) * 1.2;

    const legendNumIcons = HF_DETAIL_LEGEND_ITEMS.length;
    //Todo use section calcs
    const legendHeight = (6 + legendIconHeight) * legendNumIcons +
        PageSettings.HEADER_FONT_SIZE + 3 * 6;

    // Load & embed icons
    const svgs = [
        PageSettings.HEALTHFACILITY_LOGO,
        PageSettings.OUTREACH_LOGO,
        PageSettings.PEDESTRIAN_LOGO,
        PageSettings.CAR_LOGO,
    ];
    const icons = await Promise.all(svgs.map(async svg => {
        return [svg, await embedSVG(page.doc, svg)];
    }));




    //const sectionVerticalSpace = PageSettings.LEFT_PANEL_CONTENT_PADDING / 2;

    //take height, take away header and legend and spilt the rest
    const overviewMapHeightPerc = 0.40;


    const header = new SectionDimensions().setHeight(40).setTopBotLeftRightPadding(4)
        .setParent(pageSection);

    const detailLeftPanelSection = new SectionDimensions()
        .setParent(pageSection)
        .setTopBotLeftRightPadding(4)
        .setAvailableHeight(height - header.calcItemHeight())
        .setAvailableWidth(_.ceil(width * 0.35))
        .setVerticalGap(5)
        .setOffsetY(header.dims().height);

    const detailMapSection = new SectionDimensions()
        .setParent(pageSection)
        .setAvailableWidth(width - detailLeftPanelSection.dims().width)
        .setOffsetX(detailLeftPanelSection.dims().width)
        .setHeight(detailLeftPanelSection.calcItemHeight())
        .setOffsetY(detailLeftPanelSection.offsetY);

    const boundaryLeftPanelSection = new SectionDimensions()
        .setParent(pageSection)
        .setTopBotLeftRightPadding(4)
        .setAvailableHeight(height - header.calcItemHeight())
        .setAvailableWidth(_.ceil(width * .50))
        .setOffsetY(header.dims().height);

    const boundaryMapSection = new SectionDimensions()
        .setParent(pageSection)
        .setAvailableWidth(width - boundaryLeftPanelSection.dims().width)
        .setOffsetX(boundaryLeftPanelSection.dims().width)
        .setHeight(boundaryLeftPanelSection.calcItemHeight())
        .setOffsetY(boundaryLeftPanelSection.offsetY);

    const legend = new SectionDimensions().setHeight(legendHeight).setParent(detailLeftPanelSection).setTopBotLeftRightPadding(6);

    //2 gaps for 3 items
    const availableHeight = detailLeftPanelSection.dims(DimVariant.INTERNAL).height - legend.calcItemHeight() - 2 * detailLeftPanelSection.verticalGap;
    const overviewHeight = _.round(overviewMapHeightPerc * availableHeight);
    const infoPanelHeight = availableHeight - overviewHeight;

    const infoPanel = new SectionDimensions()
        .setParent(detailLeftPanelSection)
        .setTopBotLeftRightPadding(5)
        .setAvailableHeight(infoPanelHeight)
        .setOffsetY(0);

    const overview = new SectionDimensions()
        .setParent(detailLeftPanelSection)
        .setTopBotLeftRightPadding(5)
        .setAvailableHeight(overviewHeight)
        .setOffsetY(infoPanel.calcItemHeight() + detailLeftPanelSection.verticalGap);

    legend.setOffsetY(overview.offsetY + overview.dims().height + detailLeftPanelSection.verticalGap);

    //internal 2, total 0, border 1
    //debugger;


    //Where the hfs (excluding header, a margin, and a bottom margin)


    const infoPanelOutreach = new SectionDimensions().setHeight(18).setMargin({
        bottom: 6
    });
    //also subttile (settlement name or catchment pop)
    const infoPanelCatchPopLabel: SectionDimensions = new SectionDimensions().setHeight(12).setMargin({
        bottom: 4
    });
    const infoPanelPopItems: SectionDimensions = new SectionDimensions().setHeight(12).setVerticalGap(2);
    const infoPanelNumSettlements: SectionDimensions = new SectionDimensions().setHeight(12).setMargin({
        top: 8
    });
    const infoPanelTitle: SectionDimensions = new SectionDimensions().setHeight(16).setMargin({
        bottom: 5
    });

    const hfBoxHeight = infoPanelOutreach.calcItemHeight(1) +
        infoPanelCatchPopLabel.calcItemHeight(1) +
        infoPanelPopItems.calcItemHeight(3) +
        infoPanelPopItems.verticalGap * 2 +
        infoPanelNumSettlements.calcItemHeight(1);

    const hfBox = new SectionDimensions()
        .setHeight(hfBoxHeight).setMargin({ top: 7, bottom: 7 })
        .setVerticalGap(5)
        .setTopBotLeftRightPadding(5)
        .setParent(boundaryLeftPanelSection)
        ;


    //Calculate how many hfs we can put on the pdf
    //Add HF_ENTRY_PAGE_SPACE_BETWEEN because we need # of hfs - 1 of that space
    const hfHeightOne = hfBox.calcItemHeight(1);
    const hfHeightAdditional = hfBox.calcItemHeight(2) - hfHeightOne;
    //assume we have space for at least one
    const hfsPerPage: number = 1 + _.floor((boundaryLeftPanelSection.dims(DimVariant.INTERNAL).height - hfHeightOne) / hfHeightAdditional);

    const hfIconTextHorizontalGap = 8;

    return {
        pageSection,
        documentFont,
        documentFontBold,
        header,
        infoPanel,
        boundaryLeftPanelSection,
        boundaryMap: boundaryMapSection,
        detailLeftPanelSection,
        detailMap: detailMapSection,
        overview,
        legend,
        hfIconEmbedded: (icons.find(([u, _p]) => u === PageSettings.HEALTHFACILITY_LOGO) as [string, PDFEmbeddedPage])[1],
        outreachIconEmbedded: (icons.find(([u, _p]) => u === PageSettings.OUTREACH_LOGO) as [string, PDFEmbeddedPage])[1],
        logoHeight: PageSettings.TITLE_FONT_SIZE * 1.2,

        hfsPerPage,
        infoPanelSubTitle: infoPanelOutreach,
        //we'll reuse this for set name
        infoPanelCatchPopLabel,
        infoPanelNumSettlements,
        infoPanelPopItems,
        hfBox,
        hfIconTextHorizontalGap,
        pageCounterWidth: 100,
        dateWidth: 130,
        infoPanelTitle
    };
}
