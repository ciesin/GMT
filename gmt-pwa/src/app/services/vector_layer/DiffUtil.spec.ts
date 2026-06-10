import { changedProperties } from "./DiffUtil";
import { booleanEqual } from "@turf/turf";

import { GeoJsonBase, GeoJsonSettlementName, GeoJsonSettlementPart, PropertyValue } from "../../utils/server-interfaces/GeoJson";

describe('DeepDiffer', () => {


    it('should diff properties', () => {
        const results = changedProperties(
            { "same": 3, "different": "hey", "same2": "what", "different2": 7.2, "different3": 4 },
            { "same": 3, "different": "hey 1", "same2": "what", "different2": null },
        );
        expect(results).toEqual(["different", "different2", "different3"]);
    });

    it('should arrays', () => {

        const F1: GeoJsonBase = {
            "type": "Feature",
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [[
                    [[100.0, 0.0], [101.0, 0.0], [101.0, 1.0],
                    [100.0, 1.0], [100.0, 0.0]]
                ]]
            },
            "properties": {
                "global_id": "4",
                "name": "value0",
                "boundary_polygon": "value0",
                "prop1": 3,
                "version_id": 3
            }
        } as GeoJsonBase;

        const F2: GeoJsonBase = {
            "type": "Feature",
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [[
                    [[100.0, 0.0], [101.0, 0.0], [101.0, 1.0],
                    //only point that is different
                    [100.000001, 1.0],
                    [100.0, 0.0]]
                ]]
            },
            "properties": {
                "global_id": "4",
                "boundary_polygon": "value0",
                "name": "value0",
                "prop1": 3,
                "version_id": 3
            }
        } as GeoJsonBase;


        expect(booleanEqual(F1.geometry, F1.geometry)).toBeTrue();
        expect(booleanEqual(F2.geometry, F2.geometry)).toBeTrue();


        expect(booleanEqual(F1.geometry, F2.geometry)).toBeFalse();
    });
});
