import { Fill, Style } from "ol/style"; // , Text, Stroke
import { Options as StyleOptions } from "ol/style/Style";
import { asArray } from "ol/color";
import { getRGBColorFromCSS } from "./map-styles";
/**
 * ==================================
 * ====== All cached styles =========
 * ==================================
 */
const SMALLEST_POPULATION = 0;
const SMALL_POPULATION = 1;
const LARGE_POPULATION = 2;
const LARGEST_POPULATION = 3;

const WITH_POP_VALUE = 1;
const WITHOUT_POP_VALUE = 0;

//Note for the pdf, that code expects arrays here
export const uninhabitedColor = getRGBColorFromCSS('--population-density');
export const notCoveredColor = getRGBColorFromCSS('--population-density');
//matches visualizeHfCatchment which is what is drawing the catchment polygons
export const coveredFixedPostColor = getRGBColorFromCSS('--catchment-fixed');
export const coveredOutreachColor = getRGBColorFromCSS('--catchment-outreach');
export const problematicColor = getRGBColorFromCSS('--settlements-special');


function generateRasterSquareStyle(color: number[] | string, withPop: boolean): Style {
    const options: StyleOptions = {
        fill: new Fill({
            color: Array.from(asArray(color))
        }),
    };
    return new Style(options);
}
// const popRasterStroke = new Stroke({
//   color: 'black',
//   width: 0,
// });
//
// const popRasterTextFill = new Fill({
//   color: '#000000'
// });
//
// const popRasterTextStroke = new Stroke({
//   color: '#FFFF99',
//   width: 3.5
// });

// const popRasterStyle: StyleFunction = (feature: FeatureLike, _resolution: number): Style => {
//   let popValue = feature.get("value");
//   if (isFloat(popValue) && popValue > 0) {
//     popValue = Math.round(popValue).toString();
//     //popValue = popValue.toFixed(3);
//   }
//
//   return new Style({
//     stroke: popRasterStroke,
//     text: new Text({
//       text: popValue,
//       scale: 1.3,
//       fill: popRasterTextFill,
//       stroke: popRasterTextStroke,
//     })
//   });
// };

const notCoveredRasterStyle: { [key: string]: { [key: number]: Style } } = {
    [SMALLEST_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(notCoveredColor.concat([0.05]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(notCoveredColor.concat([0.05]), false),
    },
    [SMALL_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(notCoveredColor.concat([0.15]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(notCoveredColor.concat([0.15]), false),
    },
    [LARGE_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(notCoveredColor.concat([0.3]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(notCoveredColor.concat([0.3]), false),
    },
    [LARGEST_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(notCoveredColor.concat([0.4]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(notCoveredColor.concat([0.4]), false),
    },
};

const problematicRasterStyle: { [key: string]: { [key: number]: Style } } = {
    [SMALLEST_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(problematicColor.concat([0.05]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(problematicColor.concat([0.05]), false),
    },
    [SMALL_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(problematicColor.concat([0.15]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(problematicColor.concat([0.15]), false),
    },
    [LARGE_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(problematicColor.concat([0.3]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(problematicColor.concat([0.3]), false),
    },
    [LARGEST_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(problematicColor.concat([0.4]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(problematicColor.concat([0.4]), false),
    },
};

const fixedPostRasterStyle: { [key: string]: { [key: number]: Style } } = {
    [SMALLEST_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(coveredFixedPostColor.concat([0.05]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(coveredFixedPostColor.concat([0.05]), false),
    },
    [SMALL_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(coveredFixedPostColor.concat([0.15]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(coveredFixedPostColor.concat([0.15]), false),
    },
    [LARGE_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(coveredFixedPostColor.concat([0.3]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(coveredFixedPostColor.concat([0.3]), false),
    },
    [LARGEST_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(coveredFixedPostColor.concat([0.4]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(coveredFixedPostColor.concat([0.4]), false),
    },
};

const outreachRasterStyle: { [key: string]: { [key: number]: Style } } = {
    [SMALLEST_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(coveredOutreachColor.concat([0.05]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(coveredOutreachColor.concat([0.05]), false),
    },
    [SMALL_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(coveredOutreachColor.concat([0.15]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(coveredOutreachColor.concat([0.15]), false),
    },
    [LARGE_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(coveredOutreachColor.concat([0.3]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(coveredOutreachColor.concat([0.3]), false),
    },
    [LARGEST_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(coveredOutreachColor.concat([0.4]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(coveredOutreachColor.concat([0.4]), false),
    },
};
const uninhabitedRasterStyle: { [key: string]: { [key: number]: Style } } = {
    [SMALLEST_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(uninhabitedColor.concat([0]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(uninhabitedColor.concat([0]), false),
    },
    [SMALL_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(uninhabitedColor.concat([0]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(uninhabitedColor.concat([0]), false),
    },
    [LARGE_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(uninhabitedColor.concat([0]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(uninhabitedColor.concat([0]), false),
    },
    [LARGEST_POPULATION]: {
        [WITH_POP_VALUE]: generateRasterSquareStyle(uninhabitedColor.concat([0]), true),
        [WITHOUT_POP_VALUE]: generateRasterSquareStyle(uninhabitedColor.concat([0]), false),
    },
};

/**
 * ==================================
 * ==== End All cached styles =======
 * ==================================
 */

function getPopulationGroupFromPopValueAndMean(popValue: number, popMean: number) {
    if (popValue < popMean / 2) {
        return SMALLEST_POPULATION;
    } else if (popValue >= popMean / 2 && popValue < popMean) {
        return SMALL_POPULATION;
    } else if (popValue >= popMean && popValue < popMean * 2) {
        return LARGE_POPULATION;
    } else {
        return LARGEST_POPULATION
    }
}
/**
 * Checks catchment properties and selects the right style to display.
 * should be passed to this function.
 *
 * Note that properties this time are passed as a parameters and not retrieved from the feature
 * because it could be retrieved differently for HF and settlement cases
 * @param params: RasterSquareParams
 */
export function rasterSquareStyleFunction(params: RasterSquareParams): Style {
    let style;
    const popGroup = getPopulationGroupFromPopValueAndMean(params.popValue!, params.popMean!);
    if (params.isProblematic) {
        style = problematicRasterStyle[Number(popGroup)][Number(params.includePopText)];
    } else if (params.isUninhabited) {
        style = uninhabitedRasterStyle[Number(popGroup)][Number(params.includePopText)];
    } else if (params.isFixedPost) {
        style = fixedPostRasterStyle[Number(popGroup)][Number(params.includePopText)];
        // style = {visibility: 'hidden'};
        style.display = 'none';
        style.fillOpacity = 0;
        style.strokeOpacity = 0;
    } else if (params.isOutreach) {
        //not fixed post will always be outreach as there is no explicit mobile style
        style = outreachRasterStyle[popGroup][Number(params.includePopText)];
    } else {
        style = notCoveredRasterStyle[popGroup][Number(params.includePopText)];
    }
    return style;
}

export interface RasterSquareParams {
    includePopText: boolean;
    isFixedPost: boolean;
    isOutreach: boolean;
    isProblematic: boolean;
    isUninhabited: boolean;
    popValue?: number;
    popMean?: number;
}
