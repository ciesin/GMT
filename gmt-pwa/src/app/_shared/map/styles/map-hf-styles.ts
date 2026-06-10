import { Fill, Icon, Stroke, Style, Text } from "ol/style";
import { MultiPolygon, Point } from "ol/geom";
import { StyleFunction } from "ol/style/Style";
import { FeatureLike } from "ol/Feature";
import { getFontStyle, getHexColorFromCSS, getLabelText } from "./map-styles";
import { getSizeFromResolution } from "./map-poi-styles";
import { isHfRiForOlFeature } from "src/app/utils/data/data-filter.util";
import { getMarkerSVGPath, labelBuild, labelMarker } from "./map-design";

/**
 * ==================================
 * ====== All cached styles =========
 * ==================================
 */

const DEFAULT_ANCHOR = [0.5, 1];
const SELECTED_Z_INDEX = 0.00000001; // smaller z-index - higher priority in declutter https://github.com/openlayers/openlayers/issues/8126
const MUTED_STATE = 'muted';
const SELECTED_STATE = 'selected';
const INACTIVE_STATE = 'inactive';

const HF_TEXT_COLOR = "#184F67";

// ::
// :: Markers
// ::
const HF_ACTIVE_IMG = getMarkerSVGPath('fixed_active');
const HF_INACTIVE_IMG = getMarkerSVGPath('fixed_default');
const OUTREACH_ACTIVE_IMG = getMarkerSVGPath('outreach_active');
const OUTREACH_INACTIVE_IMG = getMarkerSVGPath('outreach_default');
// TODO: these should be removed, this is a hack
const PRIVATE_HF_ACTIVE_IMG = getMarkerSVGPath('fixed_active');
const PRIVATE_HF_INACTIVE_IMG = getMarkerSVGPath('fixed_default');

const ICON_MUTED = 0.5;
const ICON_INACTIVE = 0.9;
const ICON_ACTIVE = 1;

// TODO: scaling here causes odd defects in svg
// the actual icon have their appropriate sizes
const ICON_SM = 1;
const ICON_LG = 1;

// according to Thomas, we need these constants for them to be cached
const hfMutedStyleTemplate = {
    anchor: DEFAULT_ANCHOR,
    opacity: ICON_MUTED,
    src: HF_INACTIVE_IMG,
};
const healthFacilitiesMuted = new Style({ image: new Icon(hfMutedStyleTemplate) });
const healthFacilitiesMutedSmall = new Style({ image: new Icon({ ...hfMutedStyleTemplate, scale: ICON_SM }) });
const healthFacilitiesMutedLarge = new Style({ image: new Icon({ ...hfMutedStyleTemplate, scale: ICON_LG }) });

const hfMutedPrivateStyleTemplate = {
    anchor: DEFAULT_ANCHOR,
    opacity: ICON_MUTED,
    src: PRIVATE_HF_INACTIVE_IMG,
};
const healthFacilitiesMutedPrivate = new Style({ image: new Icon(hfMutedPrivateStyleTemplate) });
const healthFacilitiesMutedPrivateSmall = new Style({ image: new Icon({ ...hfMutedPrivateStyleTemplate, scale: ICON_SM }) });
const healthFacilitiesMutedPrivateLarge = new Style({ image: new Icon({ ...hfMutedPrivateStyleTemplate, scale: ICON_LG }) });

const hfStyleTemplate = {
    anchor: DEFAULT_ANCHOR,
    opacity: ICON_INACTIVE,
    src: HF_INACTIVE_IMG,
}
export const healthFacilities = new Style({ image: new Icon(hfStyleTemplate) });
const healthFacilitiesSmall = new Style({ image: new Icon({ ...hfStyleTemplate, scale: ICON_SM }) });
const healthFacilitiesLarge = new Style({ image: new Icon({ ...hfStyleTemplate, scale: ICON_LG }) });

const hfPrivateStyleTemplate = {
    anchor: DEFAULT_ANCHOR,
    opacity: ICON_INACTIVE,
    src: PRIVATE_HF_INACTIVE_IMG,
}
const healthFacilitiesPrivate = new Style({ image: new Icon(hfPrivateStyleTemplate) });
const healthFacilitiesPrivateSmall = new Style({ image: new Icon({ ...hfPrivateStyleTemplate, scale: ICON_SM }) });
const healthFacilitiesPrivateLarge = new Style({ image: new Icon({ ...hfPrivateStyleTemplate, scale: ICON_LG }) });

const hfSelectedStyleTemplate = {
    anchor: DEFAULT_ANCHOR,
    opacity: ICON_ACTIVE,
    src: HF_ACTIVE_IMG,
};
const healthFacilitiesSelectedStyle = new Style({ image: new Icon(hfSelectedStyleTemplate), zIndex: SELECTED_Z_INDEX });
const healthFacilitiesSelectedSmall = new Style({ image: new Icon({ ...hfSelectedStyleTemplate, scale: ICON_SM }), zIndex: SELECTED_Z_INDEX });
const healthFacilitiesSelectedLarge = new Style({ image: new Icon({ ...hfSelectedStyleTemplate, scale: ICON_LG }), zIndex: SELECTED_Z_INDEX });

const hfSelectedPrivateStyleTemplate = {
    anchor: DEFAULT_ANCHOR,
    opacity: ICON_ACTIVE,
    src: PRIVATE_HF_ACTIVE_IMG,
};
const healthFacilitiesSelectedPrivate = new Style({ image: new Icon(hfSelectedPrivateStyleTemplate), zIndex: SELECTED_Z_INDEX });
const healthFacilitiesSelectedPrivateSmall = new Style({ image: new Icon({ ...hfSelectedPrivateStyleTemplate, scale: ICON_SM }), zIndex: SELECTED_Z_INDEX });
const healthFacilitiesSelectedPrivateLarge = new Style({ image: new Icon({ ...hfSelectedPrivateStyleTemplate, scale: ICON_LG }), zIndex: SELECTED_Z_INDEX });

const outreachStyleTemplate = {
    anchor: DEFAULT_ANCHOR,
    opacity: ICON_INACTIVE,
    src: OUTREACH_INACTIVE_IMG,
};
export const outreach = new Style({ image: new Icon(outreachStyleTemplate) });
const outreachSmall = new Style({ image: new Icon({ ...outreachStyleTemplate, scale: ICON_SM }) });
const outreachLarge = new Style({ image: new Icon({ ...outreachStyleTemplate, scale: ICON_LG }) });

const outreachSelectedStyleTemplate = {
    anchor: DEFAULT_ANCHOR,
    opacity: ICON_ACTIVE,
    src: OUTREACH_ACTIVE_IMG,
};
const outreachSelected = new Style({ image: new Icon(outreachSelectedStyleTemplate), zIndex: SELECTED_Z_INDEX });
const outreachSelectedSmall = new Style({ image: new Icon({ ...outreachSelectedStyleTemplate, scale: ICON_SM }), zIndex: SELECTED_Z_INDEX });
const outreachSelectedLarge = new Style({ image: new Icon({ ...outreachSelectedStyleTemplate, scale: ICON_LG }), zIndex: SELECTED_Z_INDEX });

const outreachMutedStyleTemplate = {
    anchor: DEFAULT_ANCHOR,
    opacity: ICON_MUTED,
    src: OUTREACH_INACTIVE_IMG,
};

const outreachMuted = new Style({ image: new Icon(outreachMutedStyleTemplate) });
const outreachMutedSmall = new Style({ image: new Icon({ ...outreachMutedStyleTemplate, scale: ICON_SM }) });
const outreachMutedLarge = new Style({ image: new Icon({ ...outreachMutedStyleTemplate, scale: ICON_LG }) });


const hfIcon: { [key: string]: { [key: number]: Style } } = {
    [MUTED_STATE]: {
        1.5: healthFacilitiesMutedSmall,
        4: healthFacilitiesMutedSmall,
        6: healthFacilitiesMuted,
        8: healthFacilitiesMutedLarge
    },
    [SELECTED_STATE]: {
        1.5: healthFacilitiesSelectedSmall,
        4: healthFacilitiesSelectedSmall,
        6: healthFacilitiesSelectedStyle,
        8: healthFacilitiesSelectedLarge
    },
    [INACTIVE_STATE]: {
        1.5: healthFacilitiesSmall,
        4: healthFacilitiesSmall,
        6: healthFacilities,
        8: healthFacilitiesLarge
    }
};

const hfPrivateIcon: { [key: string]: { [key: number]: Style } } = {
    [MUTED_STATE]: {
        1.5: healthFacilitiesMutedPrivateSmall,
        4: healthFacilitiesMutedPrivateSmall,
        6: healthFacilitiesMutedPrivate,
        8: healthFacilitiesMutedPrivateLarge
    },
    [SELECTED_STATE]: {
        1.5: healthFacilitiesSelectedPrivateSmall,
        4: healthFacilitiesSelectedPrivateSmall,
        6: healthFacilitiesSelectedPrivate,
        8: healthFacilitiesSelectedPrivateLarge
    },
    [INACTIVE_STATE]: {
        1.5: healthFacilitiesPrivateSmall,
        4: healthFacilitiesPrivateSmall,
        6: healthFacilitiesPrivate,
        8: healthFacilitiesPrivateLarge
    }
};

const outreachIcon: { [key: string]: { [key: number]: Style } } = {
    [MUTED_STATE]: {
        1.5: outreachMutedSmall,
        4: outreachMutedSmall,
        6: outreachMuted,
        8: outreachMutedLarge
    },
    [SELECTED_STATE]: {
        1.5: outreachSelectedSmall,
        4: outreachSelectedSmall,
        6: outreachSelected,
        8: outreachSelectedLarge
    },
    [INACTIVE_STATE]: {
        1.5: outreachSmall,
        4: outreachSmall,
        6: outreach,
        8: outreachLarge
    }
};

/**
 * ==================================
 * ==== End All cached styles =======
 * ==================================
 */
function getTextStyleProperties(
    feature: FeatureLike,
    resolution: number,
    opacity: number = 1.0,
    satelliteImagery: boolean
) {
    let labelFillColor: undefined | string = undefined;
    let strokeColor: undefined | string = undefined;
    if (satelliteImagery) {
        labelFillColor = '--base-light';
        strokeColor = '--base-dark';
    }

    return new Text({
        textAlign: 'center',
        textBaseline: 'middle',
        font: getFontStyle(),
        text: getLabelText(feature, resolution, {
            labelKey: 'name',
            maxResolution: 10
        }),
        // backgroundFill: new Fill({color: colorWithAlpha(HF_ELEMENTS_COLOR, opacity)}),
        // padding: [2, 2, 0, 2],
        // this is a nasty hacky approach for now
        ...labelMarker,
        ...labelBuild(labelFillColor, opacity, strokeColor, opacity === ICON_MUTED ? 0 : opacity),
    });
}
function hfNameStyle(feature: FeatureLike, resolution: number, opacity: number = 1.0): Style {
    return new Style({
        text: getTextStyleProperties(feature, resolution, opacity = 1.0, false)
    });
}

function hfIconMarkerStyle(feature: FeatureLike): Style[] {
    // let color = feature.get('color');
    // TODO should we keep color logic?
    // let colorCircle = new Style({
    //   image: new Circle({
    //                       // fill: new Fill({color: color}),
    //                       radius: 10,
    //                       // displacement: [14, (getSizeFromResolution(resolution) <= 4) ? 40 : 52],
    //                       displacement: [-7, -5],
    //                     }),
    // });
    let styleList: Array<Style> = [];
    // add id on the corner of hf icon
    let id = feature.get('index');
    const isRI = isHfRiForOlFeature(feature);
    if (!isRI) {
        // colorCircle.setText(
        styleList = [
            new Style({
                text: new Text({
                    textAlign: 'center',
                    font: getFontStyle(),
                    textBaseline: 'middle',
                    text: "X",
                    stroke: new Stroke({ color: HF_TEXT_COLOR }),
                    // fill: new Fill({color: GUIDES_COLOR}),
                    offsetX: -7,
                    offsetY: -5//(getSizeFromResolution(resolution) <= 4) ? -40 : -51,
                })
            })
        ];//);
    } else if (id) {
        // colorCircle.setText(
        //   new Text({
        //              textAlign: 'center',
        //              font: getFont(),
        //              textBaseline: 'middle',
        //              text: id.toString(),
        //              fill: new Fill({color: HF_TEXT_COLOR}),
        //              stroke: new Stroke({color: 'white', width: 3}),
        //              offsetX: -7,
        //              offsetY: -5//(getSizeFromResolution(resolution) <= 4) ? -40 : -52,
        //            }));
        styleList = [
            new Style({
                text: new Text({
                    textAlign: 'center',
                    font: getFontStyle(),
                    textBaseline: 'middle',
                    text: id.toString(),
                    fill: new Fill({ color: HF_TEXT_COLOR }),
                    stroke: new Stroke({ color: 'white', width: 5 }),
                    offsetX: -7,
                    offsetY: -5
                })
            })
        ];
    }
    return styleList;
}

function getIcon(iconStyleSet, muted: boolean, selected: boolean, iconSize: number) {
    if (muted) {
        return iconStyleSet[MUTED_STATE][iconSize];
    } else if (selected) {
        return iconStyleSet[SELECTED_STATE][iconSize];
    } else {
        return iconStyleSet[INACTIVE_STATE][iconSize];
    }
}

/**
 * Repeated with healthFacilitiesStyleFunction but otherwise some properties would be calculated twice
 * @param selected
 * @param muted
 */
export function getHfIconStyle(selected: boolean, muted: boolean) {
    return (feature: FeatureLike, resolution: number) => {
        let iconStyle: Style;
        const iconSize = getSizeFromResolution(resolution);
        const isOutreach = feature.get('type') == "outreach";
        const isRI = isHfRiForOlFeature(feature);
        const isPrivate = feature.get('ownership') == 'Private';

        if (!isRI && muted !== false) {
            muted = true;
        }
        if (isOutreach) {
            iconStyle = getIcon(outreachIcon, muted, selected, iconSize);
        } else if (isPrivate) {
            iconStyle = getIcon(hfPrivateIcon, muted, selected, iconSize);
        } else {
            iconStyle = getIcon(hfIcon, muted, selected, iconSize);
        }
        return [iconStyle];
    }
}

// export function getHfIconStyle(feature: FeatureLike, resolution: number, selected: boolean, muted: boolean){
//   let iconStyle: Style;
//   const iconSize = getSizeFromResolution(resolution);
//   const isOutreach = feature.get('type') == "outreach";
//   const isRI = isHfRiForOlFeature(feature);
//   const isPrivate = feature.get('ownership') == 'Private';
//
//   if (!isRI && muted !== false) {
//     muted = true;
//   }
//   if (isOutreach) {
//     iconStyle = getIcon(outreachIcon, muted, selected, iconSize);
//   } else if (isPrivate) {
//     iconStyle = getIcon(hfPrivateIcon, muted, selected, iconSize);
//   } else {
//     iconStyle = getIcon(hfIcon, muted, selected, iconSize);
//   }
//   return [iconStyle];
// }

export function getHfTextStyle(selected: boolean, muted: boolean, satelliteImagery: boolean) {
    return (feature: FeatureLike, resolution: number) => {
        const setTextOpacity = muted ? ICON_MUTED : undefined;
        return [new Style({ text: getTextStyleProperties(feature, resolution, setTextOpacity, satelliteImagery) })];
    }
}

/**
 * DEPRECATED
 * Checks HF properties and selects the right style and the right
 * resolution to display. Only properties that are not part of the feature (like "selected")
 * should be passed to this function
 * @param muted
 * @param selected
 * @param satelliteImagery
 */
export function healthFacilitiesStyleFunction(selected: boolean, muted: boolean, satelliteImagery: boolean = false) {
    return (feature: FeatureLike, resolution: number) => {
        let iconStyle: Style;
        const iconSize = getSizeFromResolution(resolution);
        const isOutreach = feature.get('type') == "outreach";
        const isRI = isHfRiForOlFeature(feature);
        const isPrivate = feature.get('ownership') == 'Private';

        if (!isRI && muted !== false) {
            muted = true;
        }
        if (isOutreach) {
            iconStyle = getIcon(outreachIcon, muted, selected, iconSize);
        } else if (isPrivate) {
            iconStyle = getIcon(hfPrivateIcon, muted, selected, iconSize);
        } else {
            iconStyle = getIcon(hfIcon, muted, selected, iconSize);
        }
        const setTextOpacity = muted ? ICON_MUTED : undefined;
        iconStyle.setText(getTextStyleProperties(feature, resolution, setTextOpacity, satelliteImagery));
        return [iconStyle]
        // .concat([hfNameStyle(feature, resolution)])
        // .concat(hfIconMarkerStyle(feature));
        // .concat([hfPoint[getSizeFromResolution(resolution)]]);
    }
}

/**
 * getHfTextStyle() + handles cases that are outside boundary or are inside boundary but
 * not intersecting the boundary shape
 * @param boundaryId
 * @param satelliteImagery
 * @param focusedHfs
 */
export function healthFacilitiesTextScoped(
    boundaryId: string,
    satelliteImagery: boolean,
    focusedHfs: string[] | boolean
): StyleFunction {
    return (feature: FeatureLike, resolution: number) => {
        let muted = false;
        if (focusedHfs !== false) {
            const isOutreach = feature.get('type') == "outreach";
            if (isOutreach) {
                muted = !(focusedHfs as string[]).includes(feature.get('parent'));
            } else {
                muted = !(focusedHfs as string[]).includes(feature.get('global_id'));
            }
        }
        if (feature.get('boundary_polygon') === boundaryId) {
            return getHfTextStyle(false, muted, satelliteImagery)(feature, resolution);
        } else {
            return [hfNameStyle(feature, resolution, 0.5),];
        }
    };
}

/**
 * getHfIconStyle() + handles cases that are outside boundary or are inside boundary but
 * not intersecting the boundary shape
 * @param boundaryId
 * @param focusedHfs
 */
export function healthFacilitiesIconScoped(
    boundaryId: string,
    focusedHfs: string[] | boolean
): StyleFunction {
    return (feature: FeatureLike, resolution: number) => {
        const isOutreach = feature.get('type') == "outreach";
        let muted = false;
        if (focusedHfs !== false) {
            if (isOutreach) {
                muted = !(focusedHfs as string[]).includes(feature.get('parent'));
            } else {
                muted = !(focusedHfs as string[]).includes(feature.get('global_id'));
            }
        }
        if (feature.get('boundary_polygon') === boundaryId) {
            return getHfIconStyle(false, muted)(feature, resolution);
        } else {
            return [isOutreach ? outreachMuted : healthFacilitiesMutedSmall];
        }
    };
}
