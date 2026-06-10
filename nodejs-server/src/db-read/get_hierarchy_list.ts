import { pool} from "./common";
import {get_current_version_id} from "./get_current_version";
import {HierarchyList, HierarchyListEntry, HierarchyListEntryBoundary,} from "../server-interfaces/HierarchyList";
import escape from "pg-escape";
import GMT_CONFIG from "../config/gmt.config";

interface HealthFacility {
    global_id: string,
    version_id: number,
    is_deleted: boolean
    name: string,
    boundary_polygon: string,
}

interface Boundary extends HealthFacility {

    code: string,
    level: number,
    xmin: number,
    xmax: number,
    ymin: number,
    ymax: number,
    hf_guids: Array<string>,
    hf_names: Array<string>,
    participating: boolean
}

/*
Retrieves all data for the posted list of boundary global_ids
for the given schema and table.

This is the dashboard hierachy data
 */
export async function handle_get_hierarchy_list(ctx, next) {

    const boundaryFields = ["global_id", "name", "code", "level", "boundary_polygon", "num_pop_squares", "computed_pop", "hf_guids", "hf_names"];

    //Also join the indicator data as a json field

    const indicator_column_query = `
select column_name
from information_schema.columns
where table_schema='indicators'
  and table_name='boundary'
and column_name not in ('boundary_polygon', 'version_id');
    `;
    const {rows: indicator_column_list} = await pool.query(indicator_column_query);

    const indicatorTableColumns = indicator_column_list.map(cl => cl.column_name);
    
    const nonQuotedIndicatorColumns = indicatorTableColumns.map(s => "indicators." + s).join(", ");

    const boundaryFieldsJoined = boundaryFields.join(", ");
    const boundaryFieldPrefixedJoined = boundaryFields.map(s => "boundary_polygons." + s).join(", ");

    const boundary_query = `
        SELECT ${boundaryFieldPrefixedJoined},               
               ST_XMin(box4326)           as xmin,
               ST_XMax(box4326)           as xmax,
               ST_YMin(box4326)           as ymin,
               ST_YMax(box4326)           as ymax,
               boundary_polygons.participating,
               ${nonQuotedIndicatorColumns}
        FROM (
                 SELECT ${boundaryFieldsJoined},
                        ST_SetSrid(Box2D(geom), 4326)                     as box4326,
                        p.properties->'participating' AS participating
                 FROM boundary.polygon_latest p
                 
        ) boundary_polygons 
        LEFT JOIN indicators.boundary indicators on indicators.boundary_polygon = boundary_polygons.global_id
    `;
    const {rows: boundary_rows} = await pool.query(boundary_query);

    const version = await get_current_version_id();


    const globalIdToBoundary = new Map<string, Boundary>();
    const globalIdToBoundaryChildren = new Map<string, Array<string>>();

    const level0List: Array<HierarchyListEntryBoundary> = [];

    //Populate maps for boundaries
    for (const br_row of boundary_rows) {
        const br: Boundary = br_row;

        globalIdToBoundary.set(br.global_id, br);

        if (!br.boundary_polygon || br.level <= 0) {
            continue;
        }

        if (!globalIdToBoundaryChildren.has(br.boundary_polygon)) {
            globalIdToBoundaryChildren.set(br.boundary_polygon, []);
        }

        globalIdToBoundaryChildren.get(br.boundary_polygon).push(br.global_id);
    }



    function toHierarchyEntryBoundary(br: Boundary, boundaryLevel: number): HierarchyListEntryBoundary {
      const indicatorJson = {};
      for(const indColumn of indicatorTableColumns) {
        indicatorJson[indColumn] = br[indColumn];
      }
        return {
            name: br.name,
            type: "boundary",
            global_id: br.global_id,
            children: addChildren(br.global_id, 1 + boundaryLevel),
            indicators: indicatorJson,
            participating: br.participating,
            extent: {
                x_min: br.xmin,
                x_max: br.xmax,
                y_min: br.ymin,
                y_max: br.ymax
            },

        };
    }


    function addChildren(parentGlobalId: string, boundaryLevel: number): Array<HierarchyListEntry> {
        //console.log(`Parent ${parentGlobalId} rec level ${recLevel}`);
        if (boundaryLevel > 1+GMT_CONFIG.maxBoundaryLevel) {
            throw Error("Too deep!");
        }
        if (boundaryLevel <= GMT_CONFIG.maxBoundaryLevel && !globalIdToBoundaryChildren.has(parentGlobalId)) {
            return [];
        }

        const ret: Array<HierarchyListEntry> = [];

        //handle last level and attach health facilities
        if (boundaryLevel == GMT_CONFIG.maxBoundaryLevel + 1) {
            const br = globalIdToBoundary.get(parentGlobalId);

            const hfIdList = br.hf_guids;
            if (!hfIdList || hfIdList.length <= 0) {
                //No health facilities
                return ret;
            }
            for (let i = 0; i < hfIdList.length; ++i) {

                ret.push({
                    name: br.hf_names[i],
                    global_id: br.hf_guids[i],
                    type: "health_facility",
                });
            }

            return ret;
        }

        for (const childGlobalId of globalIdToBoundaryChildren.get(parentGlobalId)) {
            const br = globalIdToBoundary.get(childGlobalId);
            ret.push(toHierarchyEntryBoundary(br, boundaryLevel));
        }

        ret.sort((a, b) => {
            if (a.name > b.name) {
                return 1;
            }
            return -1;
        });

        return ret;

    }

    for (const br_row of boundary_rows) {
        const br: Boundary = br_row;
        if (br.level === 0) {
            level0List.push(toHierarchyEntryBoundary(br, 0))
        }
    }

    //Sort level 1 in alpha order
    level0List.sort((a, b) => {
        if (a.name > b.name) {
            return 1;
        }
        return -1;
    });

    ctx.body = {
        version,
        list: level0List
    } as HierarchyList;

    await next();
}



