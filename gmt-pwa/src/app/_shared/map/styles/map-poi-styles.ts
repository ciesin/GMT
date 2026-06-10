import { Icon, Stroke, Style } from "ol/style";
import { StyleFunction } from "ol/style/Style";
import { FeatureLike } from "ol/Feature";
import { getMarkerSVGPath } from "./map-design";


// NOTE: this is a cleaner approach, perhaps one more step
// and have the svg path as one variable
const emptyStyle = new Style();
const poiStyleCache: Map<string, Style> = new Map();
// TODO: we are missing POIs?
const poiIconsList = [
    ['Mosque', 'mosque'],
    ['Church', 'church'],
    ['Market', 'market'],
    ['School', 'school'],
];
const poiIconsMap: Map<string, string> = new Map([
    ['Mosque', 'mosque_default'],
    ['Church', 'church_default'],
    ['Market', 'market_default'],
    ['School', 'school_default'],
]);


const DEFAULT_ANCHOR = [0.5, 1];
const SELECTED_STATE = 'selected';
const INACTIVE_STATE = 'inactive';

const ICON_INACTIVE = 0.9;
const ICON_ACTIVE = 1;

// according to Thomas, we need these constants for them to be cached
const poiStyleTemplates = {};
poiIconsList.map(([category, icon]) => {
    poiStyleTemplates[category] = new Style({
        image: new Icon({
            anchor: DEFAULT_ANCHOR,
            opacity: ICON_INACTIVE,
            src: getMarkerSVGPath(`poi_${icon}_default`),
        })
    })
});
const poiSelectedStyleTemplates = {};
poiIconsList.map(([category, icon]) => {
    poiSelectedStyleTemplates[category] = new Style({
        image: new Icon({
            anchor: DEFAULT_ANCHOR,
            opacity: ICON_ACTIVE,
            src: getMarkerSVGPath(`poi_${icon}_active`),
        })
    })
});
const poiIconsStyleSet: { [key: string]: { [key: number]: Style } } = {
    [SELECTED_STATE]: poiSelectedStyleTemplates,
    [INACTIVE_STATE]: poiStyleTemplates
};
function getPoiStyle(category: string) {

    //console.log(`getPoiStyle ${category}`);

    if (!poiIconsMap.has(category)) {
        return emptyStyle;
    }

    if (!poiStyleCache.has(category)) {
        poiStyleCache.set(category, new Style({
            image: new Icon({
                anchor: [0.5, 0.5],
                src: getMarkerSVGPath(`poi_${poiIconsMap.get(category)}`)
            })
        }));
    }
    return poiStyleCache.get(category);
}
export const poi: StyleFunction = (feature: FeatureLike, _resolution: number): Style => {
    return getPoiStyle(feature.get('type')!)!;
};
/**
 * Selects the right style and the right
 * resolution to display. Only properties that are not part of the feature (like "selected")
 * should be passed to this function
 * @param muted
 * @param selected
 */
export function poiStyleFunction(selected: boolean) {
    return (feature: FeatureLike, resolution: number) => {
        let iconStyle: Style;
        if (selected) {
            iconStyle = poiIconsStyleSet[SELECTED_STATE][feature.get('type')];
        } else {
            iconStyle = poiIconsStyleSet[INACTIVE_STATE][feature.get('type')];
        }
        if (!iconStyle) {
            return emptyStyle;
        }
        return iconStyle;
    }
}
export const roads: Style = new Style({
    stroke: new Stroke({
        color: 'rgba(224, 55, 43, 0.5)',
        width: 2,
        lineDash: [10, 5]
    })
});

export const getSizeFromResolution = (resolution: number) => {
    return resolution > 20 ? 1.5 : resolution > 8 ? 4 : resolution > 6 ? 6 : 8;
}
