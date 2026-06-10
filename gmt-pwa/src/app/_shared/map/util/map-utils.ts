import { Extent as olExtent } from "ol/extent"
import { Extent } from "../../../utils/server-interfaces/GeoJson";
import VectorSource from "ol/source/Vector";
import { convertToOpenlayers, convertToTurf } from "../../../utils/features";
import {
    bboxPolygon,
    difference,
    Feature as TurfFeature,
    MultiPolygon as TurfMultiPolygon,
    Polygon as TurfPolygon
} from "@turf/turf";
import { BBox as TurfBBox } from "@turf/helpers/dist/js/lib/geojson";
import { Feature } from "ol";


export function bufferExtent(
    extent: Extent | olExtent | [number, number, number, number],
    //Adjustment is a percentage.  1 == 100%, 1.25 == 125%, 0.75 = 75%, etc.
    adjustment: number
): Extent {
    if (adjustment === 0) {
        return extent as Extent;
    }

    const width = Math.abs(extent[2] - extent[0]);
    const height = Math.abs(extent[3] - extent[1]);
    //to get a buffer that is 125%, then we need to add 25%, so 1.25 - 1 = 0.25
    const bufferX = (width * (adjustment - 1.0)) / 2;
    const bufferY = (height * (adjustment - 1.0)) / 2;
    return [
        extent[0] - bufferX,
        extent[1] - bufferY,
        extent[2] + bufferX,
        extent[3] + bufferY,
    ] as Extent;

}


export const createPolygonMask = (source: VectorSource, extent_adjustment: number = 10) => {
    let boundaryMask: TurfFeature = bboxPolygon(
        bufferExtent(
            source.getExtent(),
            extent_adjustment
        ) as TurfBBox
    );
    source.getFeatures().forEach(f => {
        boundaryMask = difference(
            boundaryMask as TurfFeature<TurfPolygon>,
            convertToTurf(f)?.geometry as TurfMultiPolygon
        ) as TurfFeature;
    });
    source.addFeature(convertToOpenlayers(boundaryMask) as Feature);
}
