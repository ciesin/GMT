import { coveredFixedPostColor, coveredOutreachColor } from "src/app/_shared/map/styles/map-raster-squares";
import { PageSettings } from "./pdf";


interface LegendCategoryBase {
    text: string,
}

interface LegendCategoryIcon extends LegendCategoryBase {
    icon: string
    type: "icon"
}
interface LegendCategoryColor extends LegendCategoryBase {
    color: [number, number, number, number]
    type: "color"
}
type LegendCategory = LegendCategoryIcon | LegendCategoryColor;

export const HF_DETAIL_LEGEND_TITLE = "Legend";


const COMMON_LEGEND_ITEMS: Array<LegendCategory> = [
    {
        text: 'Outreach',
        color: [...coveredOutreachColor.map(c => c / 255), 0.5] as [number, number, number, number],
        type: "color"
    },
    {
        text: 'Fixed\u00A0post',
        color: [...coveredFixedPostColor.map(c => c / 255), 0.5] as [number, number, number, number],
        type: "color"
    }
];

export const BOUNDARY_LEGEND_ITEMS: Array<LegendCategory> = [
    ...COMMON_LEGEND_ITEMS,

]
export const HF_DETAIL_LEGEND_ITEMS: Array<LegendCategory> = [
    {
        text: 'Road',
        icon: PageSettings.LEGEND_LOGO_ROAD,
        type: "icon"
    },
    ...COMMON_LEGEND_ITEMS
];
