import {pool} from "./common";
import escape from "pg-escape";
import {get_current_version_id} from "./get_current_version";
import {GeoJsonBase, GeoJsonList} from "../server-interfaces/GeoJson";
import {convertToReturnRows} from "./get_latest_version";


//http://localhost:4243/get_latest_version?schema_name=settlement&table_name=polygon_latest&boundary_code=11110


// Retrieves all boundary data.  This is for maps at different levels
// Used to get the simplified geometry
export async function handle_get_boundaries(ctx, next) {

    // Configs
    const BOUNDARY_SCHEMA: string = 'boundary';
    const BOUNDARY_LATEST_TABLE: string = 'polygon_simplified_latest';
    // const BOUNDARY_LATEST_TABLE: string = 'polygon';
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


    // Retrieve boundary data
    let all_rows = [];
    const query = `
        SELECT
            ST_AsGeoJson(p.geom)::jsonb as geometry, 
            jsonb_build_object() AS properties,
            p.name, p.global_id, p.level, p.boundary_polygon,
            ${nonQuotedIndicatorColumns}
        FROM
            ${BOUNDARY_SCHEMA}.${BOUNDARY_LATEST_TABLE} p   
        LEFT JOIN indicators.boundary indicators 
          ON indicators.boundary_polygon = p.global_id
        ORDER BY
            p.level
    `;
    const {rows} = await pool.query(query);
    all_rows = rows;

    // Make it so we have a single geojson with the properties rolled up
    const version = await get_current_version_id();
    const ret_rows: Array<GeoJsonBase> = convertToReturnRows(all_rows, ["name", "global_id", "level", "boundary_polygon"].concat(indicatorTableColumns) );

    // Build the return body
    ctx.body = {
        version,
        "list": ret_rows,
    } as GeoJsonList;

    await next();
}


