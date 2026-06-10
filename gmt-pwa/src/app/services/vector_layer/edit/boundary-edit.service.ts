import { Injectable } from "@angular/core";
import difference from '@turf/difference';
import intersect from "@turf/intersect";
import union from "@turf/union";
import { NGXLogger } from "ngx-logger";
import { v4 as uuidv4 } from "uuid";
import { BOUNDARY_EDITED_LAYER, NO_MANS_LAND } from "src/app/utils/server-interfaces/VectorLayerName";
import { BoundaryVectorLayersService } from "src/app/services/boundary-vector-layers.service";
import { CrudLayerService } from 'src/app/services/vector_layer/crud-layer.service';
import { IsLoadingService } from "src/app/services/is-loading.service";
import { MessageService } from "src/app/services/shared/notifications/message.service";
import { UserContextService } from "src/app/services/user-context.service";
import { geometryIntersects } from "src/app/utils/server-interfaces/utils/geom.util";
import {
    GeoJsonBoundary,
    GeoJsonBoundaryEdited,
    MultiPolygon,
    Polygon,
    Position
} from "src/app/utils/server-interfaces/GeoJson";
import Feature from "ol/Feature";
import _ from "lodash";

export interface BoundaryUpdateDataToResolve {
    drawn_geometry: MultiPolygon,
    union: boolean,
    comment: null | string,
}

export interface BoundaryUpdateData {
    global_id?: string,
    drawn_geometry?: MultiPolygon | null,
    resolved?: boolean,
    union: boolean,
    comment: null | string,
    is_edit?: boolean,
}

// See PR comments in https://github.com/novelt/GMT/pull/2635, pasted below

/*
The original boundaries are in boundary.polygon[_latest]

Boundary editions do not touch that table.

We have 3 type of boundary editions in boundary.polygon_edited.

Note this table is seeded from boundary.polygon

1)  When a user creates a boundary suggestion (either a union/diff)

This geojsons/row has the geometry of the latest resolved version (there should be only 1 at all times)
The edit is stored as the drawn field in properties

global_id is generated (so will never be == to the boundary polygon)
boundary_polygon is set to the boundary global_id we are editing

2)  When a user resolves a boundary suggestion

The drawn polygon is applied to the geometry and stored, with is_edit==true and is_resolved==true

3)  The current edited boundary with all resolved union/diffs applied

This is identified because the global_id will be == to the boundary_polygon field


UNIONS

When resolved, Unions will automatically subtract the additional polygon from all other adjacent polygons.

DIFFS

Because we don't know which adj. boundary this should be added to, a special no man's land entry is created.

This won't be visible to the user in the UI -- see https://github.com/novelt/GMT/issues/2229

Permissions

A user can edit all adj. boundaries.  Note there is a theoretical problem if you add a union to the extreme
sides of the adj. boundaries because the adj. boundary data won't be complete.

Remarks

As long as the user is only editing the boundary of their checked out boundaries (which may be the adj. boundaries),
and only uses unions, in theory, the topilogical correctness (overlaps / holes) will be maintained

*/

@Injectable({
    providedIn: 'root'
})
export class BoundaryEditService {
    public drawnPolygon: Polygon;

    constructor(
        public bvService: BoundaryVectorLayersService,
        public crudLayerService: CrudLayerService,
        private logger: NGXLogger,
        private messageService: MessageService,
        public userContextService: UserContextService,
        public isLoadingService: IsLoadingService) {
    }

    /* this is saving a user entered (from the wizard) boundary edit suggestion
    which means it is not changing the global_id==boundary_polygon entry in the boundary edits table
    */
    async saveEditSuggestion(boundaryUpdateData: BoundaryUpdateData) {
        const currentEditedBoundary = this.getCurrentEditedBoundary();

        if (_.isNil(currentEditedBoundary)) {
            this.logger.warn("no current edit boundary");
            return;
        }
        await this.createBoundaryUpdateSuggestion(currentEditedBoundary, boundaryUpdateData);
    }

    /*
    Returns the entry containing all the applied edits (aka suggestions),
    the current result of all edits (initialized to the boundary shape)
    */
    public getCurrentEditedBoundary(): GeoJsonBoundaryEdited | null {
        //The merged boundary (boundary original + all edits) is where global_id == boundary_polygon
        //the edits are where global_id != boundary_polygon
        const currentBoundary = this.bvService.boundaryInfo.boundary;
        for (const editedBoundary of this.bvService.data.bEditedList) {
            if (currentBoundary.properties.global_id != editedBoundary.properties.boundary_polygon) {
                continue;
            }
            if (editedBoundary.properties.is_edit === true) {
                continue;
            }
            if (editedBoundary.properties.boundary_polygon != editedBoundary.properties.global_id) {
                continue;
            }

            return editedBoundary;
        }

        return null;
    }

    /*
    This is resolving a suggestion, where it will modify the global_id == boundary_polygon
    entry for the current ward (see comment in getCurrentEditedBoundary)
    */
    async saveEdits(issue: GeoJsonBoundaryEdited) {
        // update initial boundary
        const boundaryUpdateData: BoundaryUpdateDataToResolve = {
            union: issue.properties.union!,
            drawn_geometry: issue.properties.drawn_geometry!,
            comment: issue.properties.comment!
        };

        if (issue.properties.code == NO_MANS_LAND) {
            //With https://github.com/novelt/GMT/issues/2229 this should no longer be visible
            await this.saveEditsForNoMansLand(issue);
        } else if (issue.properties.union) {
            await this.saveEditsForUnion(boundaryUpdateData, issue);
        } else {
            await this.saveEditsForDifference(boundaryUpdateData, issue)
        }
    }

    private async saveEditsForNoMansLand(issue: GeoJsonBoundaryEdited) {
        const actionId = uuidv4();
        try {
            let editBoundary = this.getEditedBoundaryById(issue.properties.global_id);

            if (_.isNil(editBoundary)) {
                this.logger.warn("no current edit boundary");
                return;
            }
            editBoundary.properties.resolved = true;
            // do separately and notify only for the last change
            await this.updateEachBoundaryVectorData(editBoundary, true, actionId);
        } catch (e) {
            this.logger.error(e);
            this.isLoadingService.setLoading(false);
        }
    }

    private async saveEditsForUnion(boundaryUpdateData: BoundaryUpdateDataToResolve, issue: GeoJsonBoundaryEdited) {
        const actionId = uuidv4();
        try {
            //Boundary with all resolved edits applied
            const boundaryWithResolvedEditsApplied = this.getCurrentEditedBoundary();

            if (_.isNil(boundaryWithResolvedEditsApplied)) {
                this.logger.warn("no current edit boundary");
                return;
            }

            //This stores all the geojson's / CRUDs we want to save
            let mergedGeometryJsonList: GeoJsonBoundary[] = [];

            //This updates the main/applied version of the boundary
            this.updateCurrentBoundary(boundaryWithResolvedEditsApplied, mergedGeometryJsonList, boundaryUpdateData);

            //Not clear if this is different than "issue" passed in
            let editBoundary = this.getEditedBoundaryById(issue.properties.global_id);

            if (_.isNil(editBoundary)) {
                this.logger.warn("no current edit boundary");
                return;
            }

            //This is the resolved version of the edit (which is the union/diff applied to the edited boundary
            //as it was when the issue was created
            this.updateCurrentBoundary(editBoundary, mergedGeometryJsonList, {
                ...boundaryUpdateData,
                global_id: issue.properties.global_id,
                is_edit: true
            });

            const currentBoundary = this.bvService.boundaryInfo.boundary;

            //Update adjacent boundaries
            for (let i = 0; i < this.bvService.data.bEditedList.length; i++) {
                let boundary = this.bvService.data.bEditedList[i];
                if (currentBoundary.properties.global_id == boundary.properties.boundary_polygon) {
                    continue;
                }

                //We only want the "main/applied" version
                if (boundary.properties.global_id != boundary.properties.boundary_polygon) {
                    continue;
                }

                if (boundary.properties.is_edit) {
                    continue;
                }

                this.updateAdjacentBoundary(boundary, mergedGeometryJsonList, boundaryUpdateData);

            }
            // do separately and notify only for the last change
            for (let i = 0; i < mergedGeometryJsonList.length; i++) {
                await this.updateEachBoundaryVectorData(mergedGeometryJsonList[i], i == mergedGeometryJsonList.length - 1, actionId);
            }
        } catch (e) {
            this.logger.error(e);
            this.isLoadingService.setLoading(false);
        }
    }

    private async saveEditsForDifference(boundaryUpdateData: BoundaryUpdateDataToResolve, issue: GeoJsonBoundaryEdited) {
        const actionId = uuidv4();
        try {
            //Boundary with all resolved edits applied
            const boundaryWithResolvedEditsApplied = this.getCurrentEditedBoundary();

            if (_.isNil(boundaryWithResolvedEditsApplied)) {
                this.logger.warn("no current edit boundary");
                return;
            }

            //The discussion is that to process the edited boundaries and make new boundaries,
            //we would like need a topology checker anyway, so any "holes" (which no man's land is supposed to signal)
            //would be found then.  We still create it though for the record but with resolved==true
            await this.createNoMansLandZone(boundaryWithResolvedEditsApplied, actionId, boundaryUpdateData);

            //This stores all the geojson's / CRUDs we want to save
            let mergedGeometryJsonList: GeoJsonBoundary[] = [];

            //This updates the main/applied version of the boundary
            this.updateCurrentBoundary(boundaryWithResolvedEditsApplied, mergedGeometryJsonList, boundaryUpdateData);

            //Not clear if this is different than "issue" passed in
            let editBoundary = this.getEditedBoundaryById(issue.properties.global_id);

            if (_.isNil(editBoundary)) {
                this.logger.warn("no current edit boundary");
                return;
            }

            //This is the resolved version of the edit (which is the union/diff applied to the edited boundary
            //as it was when the issue was created
            this.updateCurrentBoundary(editBoundary, mergedGeometryJsonList, {
                ...boundaryUpdateData,
                global_id: issue.properties.global_id,
                is_edit: true
            });
            // do separately and notify only for the last change
            for (let i = 0; i < mergedGeometryJsonList.length; i++) {
                await this.updateEachBoundaryVectorData(mergedGeometryJsonList[i], i == mergedGeometryJsonList.length - 1, actionId);
            }
        } catch (e) {
            this.logger.error(e);
            this.isLoadingService.setLoading(false);
        }
    }

    private getEditedBoundaryById(boundaryGlobalId: string): GeoJsonBoundaryEdited | null {
        for (let i = 0; i < this.bvService.data.bEditedList.length; i++) {
            let boundary = this.bvService.data.bEditedList[i];//takes boundary without edits
            if (boundary.properties.global_id == boundaryGlobalId) {
                return boundary;
            }
        }
        return null;
    }

    private async createBoundaryUpdateSuggestion(boundary: GeoJsonBoundaryEdited,
        boundaryUpdateData: BoundaryUpdateData): Promise<void> {
        const actionId = uuidv4();
        const intersects = geometryIntersects(boundary.geometry, this.drawnPolygon);
        if (!intersects) {
            this.messageService.add({
                summary: "Shape validation error",
                detail: "Your shape does not intersect with the boundary you are trying to edit.",
                severity: 'warning',
            });
            return;
        }
        // convert Polygon to MultiPolygon
        let drawnPolygon = {
            type: 'MultiPolygon',
            coordinates: [this.drawnPolygon.coordinates] as Array<Array<Array<Position>>>
        };
        let editSuggestion = {
            geometry: boundary.geometry,
            properties: {
                ...boundary.properties,
                global_id: (boundaryUpdateData.global_id) ? boundaryUpdateData.global_id : uuidv4(),
                resolved: false,
                union: boundaryUpdateData.union,
                is_edit: true,
                drawn_geometry: drawnPolygon as MultiPolygon,
                comment: boundaryUpdateData.comment,
            },
            type: "Feature" as "Feature"
        };
        if (boundaryUpdateData.global_id) {
            await this.crudLayerService.updateItem(BOUNDARY_EDITED_LAYER, editSuggestion, true, true, actionId);
        } else {
            await this.crudLayerService.createItem(BOUNDARY_EDITED_LAYER, editSuggestion, true, true, actionId);
        }
    }

    private updateCurrentBoundary(boundary: GeoJsonBoundaryEdited,
        mergedGeometryJsonList: GeoJsonBoundaryEdited[],
        boundaryUpdateData: BoundaryUpdateData): boolean {
        let mergedGeometryJson = this.createBoundaryUpdateGeoJson(
            boundary, boundaryUpdateData.union, true, boundaryUpdateData);
        if (!mergedGeometryJson) {
            return false;
        }
        mergedGeometryJsonList.push(mergedGeometryJson);

        return true;
    }


    /**
     * Similar to updateCurrentBoundary, but for surrounding boundaries only
     * @param boundary
     * @param mergedGeometryJsonList
     * @param userSelectedUnion
     * @param boundaryUpdateData
     * @private
     */
    private updateAdjacentBoundary(boundary: GeoJsonBoundaryEdited,
        mergedGeometryJsonList: GeoJsonBoundaryEdited[],
        boundaryUpdateData: BoundaryUpdateData): boolean {
        // if user requested difference, we should NOT apply union to the surrounding boundary
        if (!boundaryUpdateData.union) {
            return false;
        }
        let shouldApplyUnion = !boundaryUpdateData.union;

        let mergedGeometryJson = this.createBoundaryUpdateGeoJson(boundary, shouldApplyUnion, false, boundaryUpdateData);
        if (!mergedGeometryJson) {
            return false;
        }
        mergedGeometryJsonList.push(mergedGeometryJson);
        return true;
    }

    private createBoundaryUpdateGeoJson(
        boundary: GeoJsonBoundaryEdited,
        shouldApplyUnion: boolean,
        mustIntersect: boolean,
        boundaryUpdateData: BoundaryUpdateData
    ): GeoJsonBoundaryEdited | null {
        const intersects = geometryIntersects(boundary.geometry, boundaryUpdateData.drawn_geometry!);
        if (!intersects) {
            if (mustIntersect) {
                this.messageService.add({
                    summary: "Shape validation error",
                    detail: "Your shape does not intersect with the boundary you are trying to edit.",
                    severity: 'warning',
                });
            }
            return null;
        }
        let mergedGeometry: MultiPolygon | null = handleMergeBoundaryAndPolygon(boundary.geometry, boundaryUpdateData.drawn_geometry!,
            shouldApplyUnion,
            this.logger);

        return {
            geometry: mergedGeometry!,
            properties: {
                ...boundary.properties,
                global_id: (boundaryUpdateData.global_id) ? boundaryUpdateData.global_id : boundary.properties.global_id,
                resolved: true,
                is_edit: boundaryUpdateData.is_edit,
                union: shouldApplyUnion,
                drawn_geometry: boundaryUpdateData.drawn_geometry as MultiPolygon,
                comment: (boundary.properties.comment) ? boundary.properties.comment + ". " + boundaryUpdateData.comment : boundaryUpdateData.comment,
            },
            type: "Feature"
        };
    }

    /**
     * When user asks for polygon difference, it is not clear how to subdivide this region for surrounding
     * regions, so we leave the area (the area that was subtracted from the current boundary) not assigned to the
     * surrounding boundaries. To highlight these conflicts we create new temp boundary polygons with the
     * code = NO_MANS_LAND to visualize them differently.
     * @param boundary
     * @param actionId
     * @param boundaryUpdateData
     * @private
     */
    private async createNoMansLandZone(boundary: GeoJsonBoundaryEdited, actionId: string, boundaryUpdateData: BoundaryUpdateData) {
        const intersection = intersect(boundary.geometry, boundaryUpdateData.drawn_geometry!);

        if (!intersection || (intersection.geometry.type != "MultiPolygon" && intersection.geometry.type != "Polygon")) {
            this.messageService.add({
                summary: "Invalid shape while attempting to create intersecting polygon",
                severity: 'error'
            });
            return;
        }
        let notAssignedIntersectionJson = {
            geometry: boundary.geometry,
            type: "Feature",
            properties: {
                boundary_polygon: boundary.properties.boundary_polygon,
                bbox: boundary.properties.bbox,
                global_id: uuidv4(),
                //For https://github.com/novelt/GMT/issues/2229 we set resolved=true
                //so user does not see the entry
                resolved: true,
                union: boundaryUpdateData.union,
                is_edit: true,
                drawn_geometry: boundaryUpdateData.drawn_geometry as MultiPolygon,
                comment: `No man's land: ${boundaryUpdateData.comment}`,
                code: NO_MANS_LAND // Very important, without this , this makes it different from the other edits
            },
        } as GeoJsonBoundaryEdited;
        await this.crudLayerService.createItem(BOUNDARY_EDITED_LAYER, notAssignedIntersectionJson, true, true, actionId);
    }

    private async updateEachBoundaryVectorData(mergedGeometryJson: GeoJsonBoundaryEdited, notify: boolean = false, actionId: string) {
        await this.crudLayerService.updateItem(BOUNDARY_EDITED_LAYER, mergedGeometryJson, notify, notify, actionId);
    }
}

function handleMergeBoundaryAndPolygon(
    boundary: MultiPolygon, polygon: MultiPolygon,
    is_union: boolean,
    logger: NGXLogger): MultiPolygon | null {
    let multiPoly: MultiPolygon = boundary;
    try {
        const unionMulti = is_union ? union(multiPoly, polygon) : difference(multiPoly, polygon);
        if (!unionMulti) {
            return null;
        }

        if (unionMulti.geometry.type == "Polygon") {
            multiPoly.coordinates = [unionMulti.geometry.coordinates as Array<Array<Position>>];
        } else {
            //multipolygon
            multiPoly.coordinates = unionMulti.geometry.coordinates as Array<Array<Array<Position>>>;
        }
    } catch (e) {
        logger.error(e);
        return null;
    }
    return multiPoly;
}

