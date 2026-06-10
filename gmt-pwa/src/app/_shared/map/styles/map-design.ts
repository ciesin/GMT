import { Fill, Stroke, Style } from "ol/style";
import { getRGBColorFromCSS as cssvar } from "./map-styles";
import { colorWithAlpha } from "./service-api-styles";

// the stroke for boundaries should be consistent by design
const boundStroke = 2;

// Base marker label style (or general label)
// Idea is to keep param customization to a minimum
export const labelBuild = (
    fillColor: string = '--base-dark',
    fillOpacity: number = 1,
    strokeColor: string = '--base-light',
    strokeOpacity: number = 0.9,
) => {
    return {
        fill: new Fill({ color: `rgba(${cssvar(fillColor)}, ${fillOpacity}` }),
        stroke: new Stroke({
            color: `rgba(${cssvar(strokeColor)}, ${strokeOpacity}`,
            width: 2
        }),
    };
}

export const mapLayerOrder = {
    stl: 10,
    stlLabel: 12,
    poi: 11,
    hf: 13,
    hfIcon: 14,
}

export const labelMarker = {
    ...labelBuild(),
    offsetY: 12,
}

export const getMarkerSVGPath = (fileName: string) => {
    return `assets/icons/map-markers/${fileName}.svg`;
}

// Operation Boundary Styles
export const mapStyles = {
    /*
     * Settlements
     */
    STL: {
        polygon: new Style({
            stroke: new Stroke({
                color: cssvar('--base-base'),
                width: 1,
                lineDash: [2, 3],
            }),
            //Note!  For settlement parts to be clickable/selectable, this needs to exist
            fill: new Fill({
                color: 'rgba(255,255,255, 0)'
            })
        })
    },
    /*
     * Health Facilities
     */
    HF: {
        connectToPoint: new Style({
            stroke: new Stroke({
                color: `rgba(${cssvar('--base-base')}, 0.75)`,
                width: 2,
                lineDash: [4, 6],
                lineDashOffset: 4
            })
        }),
        connectToPointAlt: new Style({
            stroke: new Stroke({
                color: `rgba(${cssvar('--accent-medium')}, 0.8)`,
                width: 2,
                lineDash: [4, 8],
                lineDashOffset: 6
            })
        }),
    },
    // OR: {
    //   fixedFill: colorWithAlpha(cssvar('--catchment-fixed'), 0.1),
    //   fixedStroke: colorWithAlpha(cssvar('--catchment-fixed'), 0.5),
    //   outreachFill: colorWithAlpha(cssvar('--catchmet-outreach'), 0.2),
    //   outreachStroke: colorWithAlpha(cssvar('--catchmet-outreach'), 0.7),
    // },
    /*
     * Boundaries (operational)
     */

    bounds: {
        label: labelBuild(undefined, 0.65),
        fill: new Fill({
            color: `rgba(${cssvar('--base-pure-white')}, 0.1)`
        }),
        // Border of OPB
        focusedStroke: new Style({
            stroke: new Stroke({
                color: `rgba(${cssvar('--base-dark')}, 0.65)`,
                width: boundStroke
            }),
            zIndex: 100
        }),
        // Overlay covering neighboring boundaries
        adjacentBoundsOverlay: new Style({
            stroke: new Stroke({
                color: `rgba(${cssvar('--base-dark')}, 0.25)`,
                width: boundStroke
            }),
            fill: new Fill({
                color: `rgba(${cssvar('--base-dark')}, 0.2)`
                //color: `rgba(255, 0, 0, 1)`,
            }),
            zIndex: 10
        }),
        //Andres FYI
        //An example showing how to have a style used when the satellite basemap is selected
        focusedStrokeSatellite: new Style({
            stroke: new Stroke({
                color: `rgba(${cssvar('--base-dark')}, 0.65)`,
                width: boundStroke
            }),
            zIndex: 100
        }),
        // Overlay covering neighboring boundaries, when Satellite basemap is active
        adjacentBoundsOverlaySatellite: new Style({
            stroke: new Stroke({
                color: `rgba(${cssvar('--base-base')}, 0.65)`,
                width: boundStroke
            }),
            fill: new Fill({
                color: `rgba(${cssvar('--base-pale')}, 0.65)`
            }),
            zIndex: 10
        }),
    }
}
