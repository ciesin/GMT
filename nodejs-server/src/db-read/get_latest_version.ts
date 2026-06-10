import {getPartitionId, pool} from "./common";

import escape from "pg-escape";
import {get_current_version_id} from "./get_current_version";
import {GeoJsonBase, GeoJsonList, PropertyValue} from "../server-interfaces/GeoJson";
import {UPDATABLE_VECTOR_LAYERS_SPLIT, VectorLayerForPermissions} from "../server-interfaces/VectorLayerName";
import {Tables, BasicTableName, SchemaName} from "../config/tables.config";
const pg = require('pg');
//http://localhost:4243/get_latest_version?schema_name=settlement&table_name=polygon_latest&boundary_code=11110


//So we don't query OIDS every single request.  Doesn't change
let OIDS = new Map<string, number>();

async function get_enum_pg_type(enum_type_name: string) : Promise<number> {

    if (OIDS.has(enum_type_name)) {
        const ret = OIDS.get(enum_type_name);

        //console.log(`Returning cached OID: ${ret} for ${enum_type_name}`);
        return ret;
    }


    const query = `
SELECT typname, oid, typarray FROM pg_type WHERE typname = '${enum_type_name}';
    `;
    let {rows} = await pool.query(query);

    if (rows.length <= 0) {
        console.error(`No results for ${query}`);
    }

    //console.log("Rows", rows);

    const ret = rows[0]['typarray'];
    OIDS.set(enum_type_name, ret);

    //console.log(`Returning fetched OID: ${ret} for ${enum_type_name}`);

    return ret;
}

/*
Retrieves all data for the posted list of boundary global_ids
for the given schema and table
 */
export async function handle_get_latest_version(ctx, next) {

    let schema_name = ctx.request.query['schema_name'];
    let table_name = ctx.request.query['table_name'];

    console.log("Body", ctx.request.body);
    const boundaryGuidList: Array<string> = ctx.request.body;


    let ret;
    if (UPDATABLE_VECTOR_LAYERS_SPLIT.find( schema_table => schema_table[0] == schema_name && schema_table[1] == table_name)) {
        ret = await handle_get_latest_version_from_partitions_impl(
        schema_name, table_name, boundaryGuidList );
    } else {
        ret = await handle_get_latest_version_impl(
            schema_name, table_name, boundaryGuidList);
    }
    ctx.body = ret;

    await next();
}

interface RowType {
    [key: string]: PropertyValue
}

/**
Converts the database results into a GeoJson base
 @param rows database rows, indexed by string
 @param propertyKeys Which columns from rows to copy to the properties json
 */
export function convertToReturnRows(rows: Array<RowType>, propertyKeys: Array<string>) : Array<GeoJsonBase> {
    // Make it so we have a single geojson with the properties rolled up
    const ret_rows = [];
    for(const b of rows) {
        const f: GeoJsonBase = {
            "type": "Feature",
            "properties": b.properties as unknown as GeoJsonBase["properties"],
            "geometry" : b.geometry as unknown as GeoJsonBase["geometry"],
        };

        //Non jsonb properties columns/aka the row columns will take priority
        for(const key of propertyKeys) {
            f.properties[key] = b[key];

            delete b[key];
        }

        ret_rows.push(f)
    }
    return ret_rows;
}


export async function handle_get_latest_version_from_partitions_impl(
    schema_name: string, table_name: string,
    boundaryGuidList: Array<string>
    ) : Promise<GeoJsonList> {

    const textType = await get_enum_pg_type("text");

    const arrayEnumTypes = [
    await get_enum_pg_type("sn_problematic"),
    await get_enum_pg_type("hf_staff_position"),
    await get_enum_pg_type("hf_staff_type"),
    await get_enum_pg_type("hf_means_of_transport"),
    await get_enum_pg_type("hf_services")];

    //console.log(`Set type of ${snaType} to ${textType}`);
    //https://github.com/brianc/node-pg-types/issues/56
    //Need to do this for array custom types
    for(const arrayEnumType of arrayEnumTypes) {
      pg.types.setTypeParser(arrayEnumType,  pg.types.getTypeParser(textType));
    }
    //parse bigints like ints, not strings
    pg.types.setTypeParser(20,  pg.types.getTypeParser(23));


    //Note that we are mapping the original schama/table name to partition tables
    const partitionParentTable = schema_name + "_" + table_name

    const col_query = `
select column_name
from information_schema.columns
where table_schema='partitions'
  and table_name=${escape.literal(partitionParentTable)}
and column_name not in ('is_deleted', 'properties');
    `;
    const {rows: column_list} = await pool.query(col_query);

    if (!column_list || column_list.length <= 0) {
        console.error(col_query);
        throw new Error(`No columns for partitions.{partitionParentTable}.  Does the table exist?`);
    }

    const table_columns = column_list.map(cl => cl.column_name);
    //console.log("Table columns", table_columns);
    const nonQuotedColumns = table_columns.filter(s=>s != "geom").map(s => "p." + s).join(", ");

    let all_rows = [];
    if (!boundaryGuidList || boundaryGuidList.length == 0)
    {
        throw Error("Invalid / Empty boundary guid list");
    }

    const retRows: Array<GeoJsonBase> = []
    for(const boundary_guid of boundaryGuidList) {

        //console.log(`boundary guid : ${boundary_guid}`);

        const boundaryPartitionId = await getPartitionId(pool, boundary_guid);
        if (boundaryPartitionId == null) {
          //This is normal since the UI will ask for boundary ids of all levels and not just the
          //operating one (level 3 in Nigeria)
          continue;
        }
        const boundaryRows = await getDataFromPartition(schema_name,table_name,nonQuotedColumns,table_columns,boundaryPartitionId);

        retRows.push(...boundaryRows);
    }

    const version = await get_current_version_id();

    return  {
        version,
        "list": retRows,
    } ;
}

export async function handle_get_latest_version_impl(
    schema_name: string, table_name: string,
    boundary_guid_list: Array<string>
    ) : Promise<GeoJsonList> {

    //parse bigints like ints, not strings
    pg.types.setTypeParser(20,  pg.types.getTypeParser(23));

    //Prevent sql injection
    let escaped_schema_name = escape.ident(schema_name);
    let escaped_table_name = escape.ident(table_name + "_latest");

    const col_query = `
select column_name
from information_schema.columns
where table_schema=${escape.literal(schema_name)}
  and table_name=${escape.literal(table_name)}
and column_name not in ('is_deleted', 'properties');
    `;
    const {rows: column_list} = await pool.query(col_query);

    if (!column_list || column_list.length <= 0) {
        console.error(col_query);
        throw new Error(`No columns for ${schema_name}.${table_name}.  Does the table exist?`);

    }

    const table_columns = column_list.map(cl => cl.column_name);

    //console.log("Table columns", table_columns);
    if (!boundary_guid_list || boundary_guid_list.length == 0)
    {
        throw Error("Invalid / Empty boundary guid list");
    }
    const ret_rows = await getDataFromSimpleTable(escaped_schema_name,escaped_table_name,table_columns,boundary_guid_list);
    const version = await get_current_version_id();
    // Make it so we have a single geojson with the properties rolled up
    return  {
        version,
        "list": ret_rows,
    } ;
}

//Note this returns the latest materialized view, not a table
function getLatestPartitionTableName(schemaName: string, tableName: string, boundaryId: number){
    return escape.ident(schemaName + "_" + tableName + "_" + boundaryId.toString().padStart(5, '0') + "_latest");
}
function getPartitionSchemaName(schemaName: string, tableName: string){
    return escape.ident(`partitions_${schemaName}_${tableName}`);
}

//Note this returns the latest materialized view, not a table
export function getLatestSchemaTableName(schemaName: string, tableName: string, boundaryId: number){
    return `${getPartitionSchemaName(schemaName, tableName)}.${getLatestPartitionTableName(schemaName, tableName, boundaryId)}`;
}

function filterOnlyPrimaryNames(){
    return ' AND p.is_primary != false';
}

async function getDataFromSimpleTable(schemaName: string,                                            
                                      matViewName: string, //Should be one of the _latest views to only fetch the latest version
                                      tableColumns: Array<string>,
                                      boundaryGuidList: Array<string>): Promise<Array<GeoJsonBase>>{
    const dynamicSelectClausePart = tableColumns.filter(s=>s != "geom").map(s => "p." + s).join(", ");
    const escapedBoundaryGuidStr = boundaryGuidList.map( (guid) => escape.literal(guid)).join(", ");

    //console.log(`Retrieving data for Schema name: ${escaped_schema_name} Table name: ${escaped_table_name} Boundary Code: ${escaped_boundary_guid_str}`);

    let geomSql = (!tableColumns.includes("geom")) ? "'{}'::jsonb": "ST_AsGeoJson(p.geom)::jsonb"
    //if we query for some boundary_polygon guids, we want to match the global_id not the parent of
    //the boundary table
    const isBoundaryTable = schemaName == SchemaName.boundary && matViewName == BasicTableName.polygon + "_latest";
    const whereColumn = isBoundaryTable ? "global_id" : "boundary_polygon";
    let whereClause = `WHERE p.${whereColumn} IN (${escapedBoundaryGuidStr})`;

    const sql = `SELECT ${geomSql} as geometry, p.properties, ${dynamicSelectClausePart}
        FROM ${schemaName}.${matViewName} p        
        ${whereClause} ;`;

    const {rows} = await pool.query(sql);
    // console.log("1st row", rows[0], sql);
    return convertToReturnRows(rows, tableColumns.filter(s=>s != "geom"));
}
async function getDataFromPartition(schemaName: string,
                                    tableName: string,
                                    nonQuotedColumns: string,
                                    tableColumns: Array<string>,
                                    boundaryId: number): Promise<Array<GeoJsonBase>> {
    let whereClause = " WHERE 1=1 ";
    if(`${schemaName}.${tableName}` == VectorLayerForPermissions.settlementName) {
        whereClause += filterOnlyPrimaryNames();
    }
    const sql = `SELECT ST_AsGeoJson(p.geom)::jsonb as geometry, p.properties, ${nonQuotedColumns}
        FROM ${getLatestSchemaTableName(schemaName, tableName, boundaryId)} p 
        ${whereClause};`;
    const {rows} = await pool.query(sql);
    // Make it so we have a single geojson with the properties rolled up
    return convertToReturnRows(rows, tableColumns.filter(s => s != "geom"));
}