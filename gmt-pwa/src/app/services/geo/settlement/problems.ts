import {
    SettlementNameProblemTypes,
    SettlementProblemArgs,
    SettlementProblems,
    SettlementProblemSingleArgs,
} from "../WorkerInterface";

import {
    formatPercentage,
    getNumberOrDefault,
    isMachineGenerated,
    isNullOrWhitespace
} from "../../../utils/string-formatting";
import { GeoJsonSettlementName, GeoJsonSettlementPart } from "../../../utils/server-interfaces/GeoJson";
import { bbox } from "@turf/turf";
import RBush from "rbush";
import { BBox2d } from "@turf/helpers/dist/js/lib/geojson";
import { BoundaryDataClass } from "../BoundaryDataClass";
import { geometryIntersects, isEmpty } from "../../../utils/server-interfaces/utils/geom.util";
import { doRastersIntersect, manuallyPopulateSettlementPartFieldsIfNeeded } from "../Rasterize";
import { fromSpOrHf } from "../RasterStats";
import { roundPosition } from "../../../utils/coords";


interface RBushItem {
    minX: number
    minY: number
    maxX: number
    maxY: number
    id: string
}

interface InternalState {
    data: BoundaryDataClass

    //https://github.com/mourner/rbush
    tree: RBush<RBushItem>,
}

const stateMap = new Map<number, InternalState>();

function indexSettlementParts(spList: Array<GeoJsonSettlementPart>): RBush<RBushItem> {

    //First lets make sure we have a bounding box for all settlement parts
    for (const sp of spList) {

        //In case if in the future bbox is actually defined by the server
        if (Array.isArray(sp.properties.bbox) && sp.properties.bbox.length == 4) {
            continue;
        }


        //If we still don't have an extent, then calculate it
        //[minX, minY, maxX, maxY]
        sp.properties.bbox = bbox(sp) as BBox2d;
    }

    //Next build the items
    const treeItems: Array<RBushItem> = [];

    for (const sp of spList) {
        treeItems.push({
            minX: sp.properties.bbox![0],
            minY: sp.properties.bbox![1],
            maxX: sp.properties.bbox![2],
            maxY: sp.properties.bbox![3],
            id: sp.properties.global_id
        });
    }

    //An optional argument to RBush defines the maximum number of entries in a tree node. 9 (used by default) is a reasonable choice for most applications. Higher value means faster insertion and slower search, and vice versa.
    const tree = new RBush<RBushItem>(5);

    //console.log(`Loading Rtree for ${treeItems.length} settlement parts`);
    tree.load(treeItems);

    return tree;
}

export async function initSettlementProblems(args: SettlementProblemArgs): Promise<boolean> {
    //console.log(`${LOG_PREFIX}: Initializing settlement problems`);

    const tree = indexSettlementParts(Array.from(args.data.spMap.values()));
    stateMap.set(args.cacheKey, {
        data: BoundaryDataClass.fromPlainObject(args.data),
        tree,

    });

    return true;
}

export async function cleanupSettlementProblems(cacheKey: number): Promise<boolean> {
    stateMap.delete(cacheKey);

    //console.log(`${LOG_PREFIX}: Cleanup settlement problems -- ${deleted}`);

    return true;
}

//
// function timeout(ms: number): Promise<void> {
//   return new Promise(resolve => setTimeout(resolve, ms));
// }


//
// export async function getSettlementProblems(args: SettlementProblemSingleArgs): Promise<SettlementProblems> {
//   const ret: SettlementProblems = {
//     intersectingPartsWithName: [],
//     messages: [],
//     associatedPrimaryNames: [],
//     problems: [],
//     resolutions: {},
//     settlementPart: null,
//     settlementNameId: args.settlementNameId,
//     settlementPartId: args.settlementPartId,
//     //Not used for settlement names for now...
//     intersectingNames: [],
//     intersectingPartsWithPart: []
//   };
//   const state = stateMap.get(args.cacheKey)!;
//
//   const settlementNameId = args.settlementNameId;
//   const settlementName = state.data.snMap.get(settlementNameId);
//   const settlementPart = state.data.spMap.get(args.settlementPartId);
//
//   //This can happen for unnamed settlement parts
//   if (!settlementName) {
//
//     ret.intersectingNames = state.data.snList.filter(
//       sn => {
//         return geometryIntersects(settlementPart!, sn);
//       }
//     );
//
//     //Also add always the problem that this thing is unnabed
//     ret.messages.push("The settlement does not have any primary name points associated with it");
//     ret.problems.push(SettlementNameProblemTypes.NO_SETTLEMENT_NAME)
//
//     return ret;
//   }
//
//   //console.log(`${LOG_PREFIX}: get settlement problems for ${settlementName.properties.name}`);
//
//   if (isEmpty(settlementName.geometry)) {
//     ret.messages.push(`\"${settlementName.properties.name}\" has empty/null geometry`);
//     ret.problems.push(SettlementNameProblemTypes.EMPTY_OR_NULL_GEOMETRY);
//     return ret;
//   }
//
//   ret.intersectingPartsWithName = [];
//   const bboxIntersections = state.tree.search({
//     minX: settlementName.geometry.coordinates[0],
//     minY: settlementName.geometry.coordinates[1],
//     maxX: settlementName.geometry.coordinates[0],
//     maxY: settlementName.geometry.coordinates[1],
//   });
//   ret.intersectingPartsWithName.push(...bboxIntersections.map(ri => state.data.spMap.get(ri.id)!).filter(sp => {
//     //handles null with both arguments
//     return geometryIntersects(sp, settlementName!);
//   }));
//
//   //console.log(`${LOG_PREFIX}: get settlement problems for ${settlementName.properties.name} -- total sps ${ret.intersectingPartsWithName.length}`);
//
//   const settlementPartGuid = settlementName.properties.settlement_part;
//
//   if (settlementPartGuid) {
//     if (!checkSettlementPartProblems(state, ret, settlementName)) {
//       return ret;
//     }
//   } else {
//     //Deal with no settlement part
//
//     //Either we intersect 0, 1, or many (rare)
//
//
//     console.debug(`Settlement name ${settlementName.properties.name} / ${settlementName.properties.global_id} intersects ${ret.intersectingPartsWithName.length} settlement parts`);
//
//     ret.messages.push(`Settlement name "${settlementName.properties.name}" not assigned to a settlement part`);
//     ret.problems.push(SettlementNameProblemTypes.NO_SETTLEMENT_PART);
//
//   }
//
//
//   //Check boundary coherence
//   const boundary = state.data.bMap.get(settlementName.properties.boundary_polygon);
//
//   if (boundary && !geometryIntersects(boundary, settlementName)) {
//     ret.messages.push(`\"${settlementName.properties.name}\" does not intersect its assigned boundary \"${boundary.properties.name}\"`);
//     ret.problems.push(SettlementNameProblemTypes.NAME_OUTSIDE_BOUNDARY);
//   }
//
//   //Check machine generated name
//   if (isMachineGenerated(settlementName.properties.name)) {
//     ret.messages.push(`\"${settlementName.properties.name}\" has a machine generated name. Please rename it`);
//     ret.problems.push(SettlementNameProblemTypes.MACHINE_GENERATED_NAME);
//   }
//
//   if (isNullOrWhitespace(settlementName.properties.name)) {
//     ret.messages.push(`This settlement needs a name.  Please rename it to provide one.`);
//     ret.problems.push(SettlementNameProblemTypes.EMPTY_NAME);
//   }
//
//   return ret;
// }

export async function getSettlementProblemsNameRelated(args: SettlementProblemSingleArgs): Promise<SettlementProblems | null> {
    const ret: SettlementProblems = {
        intersectingPartsWithName: [],
        messages: [],
        associatedPrimaryNames: [],
        problems: [],
        resolutions: {},
        settlementPart: null,
        settlementNameId: args.settlementNameId,
        settlementPartId: args.settlementPartId,
        //Not used for settlement names for now...
        intersectingNames: [],
        intersectingPartsWithPart: []
    };
    const state = stateMap.get(args.cacheKey)!;
    const settlementNameId = args.settlementNameId;
    const settlementName = state.data.snMap.get(settlementNameId);

    //This can happen for unnamed settlement parts
    if (!settlementName) {
        // this error is handled in the geometry issues
        return null;
    }
    //Check machine generated name
    if (isMachineGenerated(settlementName.properties.name)) {
        ret.messages.push(`\"${settlementName.properties.name}\" has a machine generated name. Please rename it`);
        ret.problems.push(SettlementNameProblemTypes.MACHINE_GENERATED_NAME);
    }

    if (isNullOrWhitespace(settlementName.properties.name)) {
        ret.messages.push(`This settlement needs a name.  Please rename it to provide one.`);
        ret.problems.push(SettlementNameProblemTypes.EMPTY_NAME);
    }

    return ret;
}

// export async function getSettlementProblemsPopulation(args: SettlementProblemSingleArgs): Promise<Array<string>> {
//   // TODO implement
//   return [];
// }
export async function getSettlementProblemsGeometry(args: SettlementProblemSingleArgs): Promise<SettlementProblems> {
    const ret: SettlementProblems = {
        intersectingPartsWithName: [],
        messages: [],
        associatedPrimaryNames: [],
        problems: [],
        resolutions: {},
        settlementPart: null,
        settlementNameId: args.settlementNameId,
        settlementPartId: args.settlementPartId,
        //Not used for settlement names for now...
        intersectingNames: [],
        intersectingPartsWithPart: []
    };
    const state = stateMap.get(args.cacheKey)!;

    const settlementNameId = args.settlementNameId;
    const settlementName = state.data.snMap.get(settlementNameId);
    // const settlementPart = state.data.spMap.get(args.settlementPartId);

    //This can happen for unnamed settlement parts
    // if (!settlementName) {
    //
    //   ret.intersectingNames = state.data.snList.filter(
    //     sn => {
    //       return geometryIntersects(settlementPart!, sn);
    //     }
    //   );
    //
    //   //Also add always the problem that this thing is unnabed
    //   ret.messages.push("The settlement does not have any primary name points associated with it");
    //   ret.problems.push(SettlementNameProblemTypes.NO_SETTLEMENT_NAME)
    //
    //   return ret;
    // }

    //console.log(`${LOG_PREFIX}: get settlement problems for ${settlementName.properties.name}`);

    // if (isEmpty(settlementName.geometry)) {
    //   ret.messages.push(`\"${settlementName.properties.name}\" has empty/null geometry`);
    //   ret.problems.push(SettlementNameProblemTypes.EMPTY_OR_NULL_GEOMETRY);
    //   return ret;
    // }

    // ret.intersectingPartsWithName = [];
    // const bboxIntersections = state.tree.search({
    //   minX: settlementName.geometry.coordinates[0],
    //   minY: settlementName.geometry.coordinates[1],
    //   maxX: settlementName.geometry.coordinates[0],
    //   maxY: settlementName.geometry.coordinates[1],
    // });
    // ret.intersectingPartsWithName.push(...bboxIntersections.map(ri => state.data.spMap.get(ri.id)!).filter(sp => {
    //   //handles null with both arguments
    //   return geometryIntersects(sp, settlementName!);
    // }));

    //console.log(`${LOG_PREFIX}: get settlement problems for ${settlementName.properties.name} -- total sps ${ret.intersectingPartsWithName.length}`);

    const settlementPartGuid = settlementName?.properties.settlement_part;

    if (settlementPartGuid) {
        if (!checkSettlementPartProblems(state, ret, settlementName)) {
            return ret;
        }
    }
    // else {
    //   //Deal with no settlement part
    //
    //   //Either we intersect 0, 1, or many (rare)
    //   console.debug(`Settlement name ${settlementName.properties.name} / ${settlementName.properties.global_id} intersects ${ret.intersectingPartsWithName.length} settlement parts`);
    //   ret.messages.push(`Settlement name "${settlementName.properties.name}" not assigned to a settlement part`);
    //   ret.problems.push(SettlementNameProblemTypes.NO_SETTLEMENT_PART);
    // }

    // //Check boundary coherence
    // const boundary = state.data.bMap.get(settlementName.properties.boundary_polygon);
    //
    // if (boundary && !geometryIntersects(boundary, settlementName)) {
    //   ret.messages.push(`\"${settlementName.properties.name}\" does not intersect its assigned boundary \"${boundary.properties.name}\"`);
    //   ret.problems.push(SettlementNameProblemTypes.NAME_OUTSIDE_BOUNDARY);
    // }
    return ret;
}

/**
 * return false to short circuit
 * Most of the problems were commented out after the meeting https://github.com/novelt/GMT/issues/1656#issuecomment-1437116259
 * @private
 */
function checkSettlementPartProblems(state: InternalState, ret: SettlementProblems, settlementName: GeoJsonSettlementName): boolean {
    const settlementPartGuid = settlementName.properties.settlement_part!;

    //Check which settlement part and that there is an intersection
    const matchingSettlementPart = state.data.spMap.get(settlementPartGuid)!;

    // if (!matchingSettlementPart) {
    //
    //   ret.messages.push(`Settlement name "${settlementName.properties.name}" does not have a valid settlement geometry`);
    //   ret.problems.push(SettlementNameProblemTypes.INVALID_SETTLEMENT_PART);
    //   return false;
    // }

    // if (matchingSettlementPart.properties.boundary_polygon != settlementName.properties.boundary_polygon) {
    //   const settlementPartBoundary = state.data.getBoundaryLabels(matchingSettlementPart.properties.boundary_polygon).join(" > ");
    //   const settlementNameBoundary = state.data.getBoundaryLabels(settlementName.properties.boundary_polygon).join(" > ");
    //   ret.messages.push(`Settlement part is assigned to boundary ${settlementPartBoundary} but the name is assigned to ${settlementNameBoundary}`);
    //   ret.problems.push(SettlementNameProblemTypes.PART_BOUNDARY_ATTRIBUTE_MISMATCH);
    // }

    ret.settlementPart = matchingSettlementPart;
    if (!isMachineGenerated(settlementName.properties.name)) {
        const intersects = geometryIntersects(matchingSettlementPart, settlementName!);

        if (!intersects) {
            ret.messages.push(`Settlement name "${settlementName.properties.name}" does not intersect settlement part`);
            ret.problems.push(SettlementNameProblemTypes.NO_INTERSECT_FK_SETTLEMENT_PART);
        }
    }

    //Check intersection problems
    // These are not needed by the UI, so don't calculate them
    // try {
    //   const bspIntersection = intersect(state.data.getCurrentBoundary(), matchingSettlementPart);
    //
    //   if (!bspIntersection) {
    //     ret.messages.push("Settlement border is outside of it's boundary");
    //     ret.problems.push(SettlementNameProblemTypes.PART_OUTSIDE_BOUNDARY);
    //   } else {
    //     const areaInt = area(bspIntersection);
    //     const areaSp = area(matchingSettlementPart);
    //
    //     if (Math.abs(areaInt - areaSp) > INTERSECTION_4326_AREA_THRESHOLD) {
    //       ret.messages.push("Settlement border is partially outside of it's boundary");
    //       ret.problems.push(SettlementNameProblemTypes.PART_PARTIALLY_OUTSIDE_BOUNDARY);
    //     }
    //   }
    // } catch (e) {
    //   console.error("Error when calculating intersection", e);
    // }

    //Intersect with other settlement parts
    // ret.intersectingPartsWithPart = [];
    // try {
    //   const bboxIntersections = state.tree.search({
    //     minX: matchingSettlementPart.properties.bbox[0],
    //     minY: matchingSettlementPart.properties.bbox[1],
    //     maxX: matchingSettlementPart.properties.bbox[2],
    //     maxY: matchingSettlementPart.properties.bbox[3],
    //   });

    //const allItems = state.tree.all();

    //console.log(`${LOG_PREFIX} number of items in RTree ${allItems.length}`, allItems);

    //console.log(`${LOG_PREFIX} checking intersection of bounding box intersections for ${bboxIntersections.length} for ${settlementName.properties.name}`);

    //  manuallyPopulateSettlementPartFieldsIfNeeded(matchingSettlementPart);
    //
    //  const matchingRasterStats = fromSpOrHf(matchingSettlementPart);

    //   for (const bboxInt of bboxIntersections) {
    //     const sp = state.data.spMap.get(bboxInt.id);
    //
    //     if (!sp) {
    //       continue;
    //     }
    //
    //     if (sp.properties.global_id == matchingSettlementPart.properties.global_id) {
    //       continue;
    //     }
    //
    //     if (sp.properties.boundary_polygon != matchingSettlementPart.properties.boundary_polygon) {
    //       continue;
    //     }
    //
    //     manuallyPopulateSettlementPartFieldsIfNeeded(sp);
    //
    //     const spRasterStats = fromSpOrHf(sp);
    //
    //     //Don't do a geometry intersection, slow and too sensitive, so we check any overlapping raster squares
    //     //in the same boundary
    //     if (!doRastersIntersect(matchingSettlementPart, matchingRasterStats, sp, spRasterStats)) {
    //       continue;
    //     }
    //
    //     ret.intersectingPartsWithPart.push(sp);
    //   }
    //
    //
    //   if (ret.intersectingPartsWithPart.length > 0) {
    //     ret.problems.push(SettlementNameProblemTypes.OVERLAPS_OTHER_SETTLEMENT);
    //     ret.messages.push(`Overlaps another settlement`);
    //   }
    //
    // } catch (e) {
    //   console.error("Error when calculating intersection", e);
    // }

    // //check if we the pop % is not 100 when having multiple primary names per settlement part
    //
    // ret.associatedPrimaryNames = state.data.getPrimaryNamesForSettlementPart(ret.settlementPart.properties.global_id);
    //
    // if (ret.associatedPrimaryNames.length > 1) {
    //   ret.messages.push(`This settlement has multiple primary names`)
    //   ret.problems.push(SettlementNameProblemTypes.MULTIPLE_PN);
    // }


    return true;
}
