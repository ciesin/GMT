import { FeatureLike } from "ol/Feature";
import { StyleFunction } from "ol/style/Style";
import { Fill, Stroke, Style, Text } from 'ol/style';

import { getLabelText, getFontStyle, getHexColorFromCSS as hexClr, getRGBColorFromCSS as rgbClr } from "./map-styles";
import { NO_MANS_LAND } from "src/app/utils/server-interfaces/VectorLayerName";
import { labelBuild, mapStyles } from "./map-design";
// import { BoundaryMapComponent } from "@components/dashboard/map/boundary-map.component";
import { NO_BASEMAP, OSM_CACHED, SATELLITE_MAP } from "src/app/constants/basemap-names";
import { MicroplanBoundaryMapComponent } from "src/app/routine-immu/microplan-boundary-map/microplan-boundary-map.component";

const boundaries_text_cache: { [key: string]: Text } = {};

export const boundaryStyle = new Style({
    stroke: new Stroke({
        color: '#0000ff',
        width: 4,
    }),
});

const editedBoundaryStyle = [
    new Style({
        stroke: new Stroke({
            color: hexClr('--accent-dark'),
            width: 7,
        }),
    }),
    new Style({
        fill: new Fill({
            color: `rgba(${rgbClr('--settlements-base')}, 0.5)`,
        }),
        stroke: new Stroke({
            color: hexClr('--settlements-base'),
            width: 3,
        }),
    })
];
export const boundaryEditSuggestionStyle = [
    new Style({
        stroke: new Stroke({
            color: 'red',
            width: 10,
        }),
    }),
    new Style({
        fill: new Fill({
            color: 'rgba(32, 129, 14, 0.3)',//'#2081D6',
        }),
        stroke: new Stroke({
            color: '#FF8000',
            width: 6,
        }),
    })];
export const boundaryEditUnionSuggestionStyle = [
    new Style({
        stroke: new Stroke({
            color: 'green',
            width: 10,
        }),
    }),
    new Style({
        fill: new Fill({
            color: 'rgba(60,179,113, 0.3)',
        }),
        stroke: new Stroke({
            color: 'rgba(60,179,113)',
            width: 6,
        }),
    })];
export const boundaryEditDifferenceSuggestionStyle = boundaryEditSuggestionStyle;
const noMansLandBoundaryStyle = [
    new Style({
        stroke: new Stroke({
            color: '#2081D6',
            width: 12,
        }),
    }),
    new Style({
        fill: new Fill({
            color: 'rgba(253, 100, 0, 0.5)',//'#2081D6',
        }),
        stroke: new Stroke({
            color: '#F5D716',
            width: 8,
        }),
    })];

function getBoundariesText(
    feature: FeatureLike,
    resolution: number,
    isActive: boolean,
): Text {
    const text = feature.get('name');
    // defaults (active)
    let textColor: string = '--base-base';
    let strokeColor: string = '--base-white';
    let strokeOpacity: number = 0.5;

    if (!isActive) {
        strokeOpacity = 0;
    }

    if (boundaries_text_cache[`${resolution}_${text}`] === undefined) {
        boundaries_text_cache[`${resolution}_${text}`] = new Text({
            textAlign: 'center',
            textBaseline: 'middle',
            font: getFontStyle(1.25),
            text: getLabelText(feature, resolution, {
                labelKey: 'name'
            }),
            offsetX: 0,
            offsetY: 0,
            placement: 'point',
            maxAngle: 0.7853981633974483,
            overflow: true,
            rotation: 0,
            ...labelBuild(textColor, 0.65, strokeColor, strokeOpacity)
        });
    }
    return boundaries_text_cache[`${resolution}_${text}`];
};


export function boundariesScopedSatelliteExample(boundaryMap: MicroplanBoundaryMapComponent, feature: FeatureLike, resolution: number) {

    //Here we have the currently selected basemap.  It's typed to one of the names in basemap-names
    //If boundaryMap is undefined we assume its the default
    const baseMap = boundaryMap ? boundaryMap.getBaseLayerName() : OSM_CACHED;
    const boundaryId = boundaryMap.bvService.data.boundaryId;

    const isActiveBoundary = feature.get('global_id') === boundaryId;
    //console.log(`EEE baseMap ${baseMap} active boundary? ${isActiveBoundary}`);
    let style;

    if (isActiveBoundary) {
        if (baseMap == SATELLITE_MAP) {
            style = mapStyles.bounds.focusedStrokeSatellite;
        } else {
            style = mapStyles.bounds.focusedStroke;
        }
    } else {
        if (baseMap == SATELLITE_MAP) {
            style = mapStyles.bounds.adjacentBoundsOverlaySatellite;
        } else {
            style = mapStyles.bounds.adjacentBoundsOverlay;
        }
    }

    style.setText(getBoundariesText(feature, resolution, isActiveBoundary));

    return style;
}


export function boundariesScoped(boundary_id: string): StyleFunction {
    return (feature: FeatureLike, resolution: number) => {
        const isActive = feature.get('global_id') === boundary_id;
        const style = isActive ?
            mapStyles.bounds.focusedStroke :
            mapStyles.bounds.adjacentBoundsOverlay;

        const text = getBoundariesText(feature, resolution, isActive);
        //text.setText(`333 active? ${isActive}` + text.getText());
        style.setText(text);

        return style;
    };
}

/**
 * Checks edited boundary properties and selects the right style
 * should be passed to this function
 */
export function editedBoundariesStyleFunction(boundaryId: string) {
    return (feature: FeatureLike, resolution: number) => {
        if (feature.get('boundary_polygon') !== boundaryId) {
            return null;
        }
        const noMansLand = feature.get('code') == NO_MANS_LAND;
        const isEdit = feature.get('is_edit');
        if (isEdit) {
            return null;
        }
        //boundary.properties.resolved === true || boundary.properties.resolved === false
        if (noMansLand) {
            return noMansLandBoundaryStyle;
        } else {
            return editedBoundaryStyle;
        }
    }
}
