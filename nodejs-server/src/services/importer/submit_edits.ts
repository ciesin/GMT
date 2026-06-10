import {CrudAction} from "../../server-interfaces/CrudAction";
import {GeoJsonBase, ProblematicOption} from "../../server-interfaces/GeoJson";
import {Job} from "bull";
import {Pool, PoolClient} from "pg";
import escape from "pg-escape";
import { BOUNDARY_EDITED_LAYER } from "../../server-interfaces/VectorLayerName";
import { saveNewCommit } from "../../models/edits/commit";
import { get_current_version_id } from "../../db-read/get_current_version";
import { Tables } from "../../config/tables.config";
import { getPartitionId } from "../../db-read/common";
import {logAndPrint} from "../logs/add_log";
import _ from "lodash";

//Use a different pool since we are in a bull thread
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PWD,
    port: parseInt(process.env.DB_PORT),
});

// Columns that are standard to all tables
const STANDARD_COLUMNS = ['version_id', 'is_deleted',
    'properties',
    'global_id', 'boundary_polygon', 'geom', 'to_delete'];



export async function submit_edits(job: Job, crudActions: Array<CrudAction>, reqId: string) {

    if (crudActions.length <= 0) {
        return;
    }

    //We want a transaction
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const userName = crudActions[0].geojson_after.properties.user_name || "submitEdits";

        const lastVersionId = await get_current_version_id();
        const versionId = await saveNewCommit(client, userName, "Submit Edits");

        await logAndPrint(job, `Commit id -- new id ${versionId} last id ${lastVersionId}.  Setting indicators.boundary of old version to new since that data is not stale`);

        //We only want the indicators of the boundaries that changed to be recalculated
        //So we set the version_id of the indicators.boundary table to the version we just created, then set it to the old version
        //for anything we need to change.
        //On sync a full indicator update will be requested, and this will recalculate all where indicators.boundary.version_id < current version id (max of master.commits.id)
        //Note for indicators that are definitely out of date, we'll still recalculate those

        //We only want to calculate indicators that are changed
        let result = await client.query(`UPDATE ${Tables.indicators_boundary} SET version_id = ${versionId} WHERE version_id = ${lastVersionId}`);

        await logAndPrint(job, `Set ${result.rowCount} rows to ${versionId} from ${lastVersionId}.  Note affected boundaries will be set back to ${lastVersionId}`);

        const matViewsToUpdate = new Set<string>();
        const boundariesUpdated = new Set<string>();

        for (const [crudIndex, crudAction] of crudActions.entries()) {

            await job.progress(100 * crudIndex / crudActions.length);
            // Look for the partition table

            const [targetSchema, targetTable] = crudAction.changed_layer.split("__");

            await logAndPrint(job, `Inserting into ${targetSchema}.${targetTable} versionId [${versionId}] global_id [${crudAction.geojson_after.properties.global_id}] boundary [${crudAction.geojson_after.properties.boundary_polygon}] isDeleted [${crudAction.geojson_after.properties.to_delete}] `);
            await insertGeojsonIntoDatabase(
                crudAction.geojson_after, client,
                targetSchema, targetTable, versionId, matViewsToUpdate
            );



            boundariesUpdated.add(crudAction.geojson_after.properties.boundary_polygon);
            boundariesUpdated.add(crudAction.geojson_before.properties.boundary_polygon);
            //console.log("Pushing crud action", crudAction.changed_layer, crudAction.geojson_after);
        }

        const sqlChunk = [...boundariesUpdated].map(bId => `'${bId}'`).join(", ");

        //Anything that was updated, we want to reculculate those only.  The UI will request an indicator update normally after sync
        result = await client.query(`UPDATE ${Tables.indicators_boundary} SET version_id = ${lastVersionId} WHERE boundary_polygon IN (${sqlChunk})`);
        await logAndPrint(job, `Set ${result.rowCount} rows from affected boundaries to ${lastVersionId}`);
        
        for (const mvToUp of matViewsToUpdate) {
            await client.query(`REFRESH MATERIALIZED VIEW ${mvToUp}`);
        }

        await client.query("COMMIT");


    } catch (e) {
        await client.query("ROLLBACK");
        await logAndPrint(job, `Error reqId: ${reqId} exception ${e}`);
        throw e;
    } finally {
        client.release();
    }

}

//To fix https://github.com/novelt/GMT/issues/2852 ; not needed permanently
function getFixedProblematic(value: Array<string>): Array<ProblematicOption> {
    if (!_.isArray(value)) {
        return [];
    }

    const ret: Array<ProblematicOption> = [];

    for(const v of value) {
        if (!_.isString(v)) {
            continue;
        }

        if (v == 'Densly Populated') {
            ret.push('Densely Populated');
        } else {
            ret.push(v as ProblematicOption);
        }
    }

    return ret;
}

//Temporary fix for estimated pop with a ,
function getFixedEstimatedPop(value: number | string) : number | null {
    //No fix needed
    if (_.isFinite(value)) {
        return value as number;
    }

    if (!_.isString(value)) {
        return null;
    }

    //strip commas
    let s  = (value as string).replace(/,/g, '');

    //Strip internal whitespace
    s = s.replace(/\s+/g, '');

    let n = _.toNumber(s);

    //We don't want nan nor <= 0
    //est. pop of 0 should be null, not 0, this is because in theory the settlement
    //should be marked as uninhabited, where an est. pop makes no sense
    if (!_.isFinite(n)) {
        return null;
    }

    if (n <= 0) {
        return null;
    }

    return n;
}

async function insertGeojsonIntoDatabase(
    geojson: GeoJsonBase,
    client: PoolClient,
    targetSchema: string,
    targetTable: string,
    versionId: number,
    matViewsToUpdate: Set<string>
) {

    const boundaryGuid = geojson.properties.boundary_polygon;
    const boundaryId = await getPartitionId(client, boundaryGuid);

    const partitionSchema = getEditsSchemaName(targetSchema, targetTable);
    const partitionTable = getEditsTableName(targetSchema, targetTable, boundaryId.toString());

    const stdColsStr = STANDARD_COLUMNS.map(s => escape.literal(s)).join(", ");

    const {rows: column_list} = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = ${escape.literal(partitionSchema)}
          AND table_name = ${escape.literal(partitionTable)}
          AND column_name not in (${stdColsStr});
    `);
    const tableColumns: Array<string> = column_list.map(cl => cl.column_name);

    const afterProps = geojson.properties;
    const extraProps = {};

    const knownColumns = [];
    const knownValues = [];


    for (const propName of Object.keys(afterProps)) {
        if (STANDARD_COLUMNS.includes(propName)) {
            continue;
        }

        //This is an actual column in the target table
        if (tableColumns.includes(propName)) {
            knownColumns.push(propName);

            let value = afterProps[propName];

            //Temp. fix needed for https://github.com/novelt/GMT/issues/2649
            //Once sync happens this can be removed since json should be fine
            if (propName == "estimated_pop") {
                value = getFixedEstimatedPop(value);
            } else if (propName == "problematic") {
                value = getFixedProblematic(value);
            }

            knownValues.push(value);

            continue;
        }

        //Store it to put in the json properties column
        extraProps[propName] = afterProps[propName];
    }

    const geomString = JSON.stringify(geojson.geometry);
    let geomSql = `ST_SetSrid(ST_GeomFromGeoJSON(${escape.literal(geomString)}), 4326)`;

    if (geojson.geometry.type == "Point" && (!Array.isArray(geojson.geometry.coordinates) || geojson.geometry.coordinates.length < 2)) {
        geomSql = "NULL";
    }


    let knownColsStr = knownColumns.join(", ");
    let knownValsStr = knownValues.map(val => {
        if (Array.isArray(val)) {
            return '{' + val.map(v => `"${v}"`).join(", ") + '}';
        }
        if (typeof (val) === 'string') {
            return val;
        }
        if (val != null) {
            return val.toString();
        } else {
            return null;
        }

    }).map(s => escape.literal(s)).join(", ");
    if (knownColsStr.length > 0) {
        knownColsStr = ", " + knownColsStr;
        knownValsStr = ", " + knownValsStr;
    }
    // return knownValsStr;
    const sql = `
        INSERT INTO ${escape.ident(partitionSchema)}.${escape.ident(partitionTable)}
        (global_id,
         version_id,
         boundary_polygon,
         geom,
         is_deleted,
         properties
         ${knownColsStr})
        values (${escape.literal(afterProps.global_id)},
                ${escape.literal(versionId.toString())},
                ${escape.literal(afterProps.boundary_polygon)},
                ${geomSql},
                ${escape.literal(afterProps.to_delete ? '1' : '0')},
                ${escape.literal(JSON.stringify(extraProps))}
                ${knownValsStr});
    `
    // await job.log(sql);
    await client.query(sql);
    matViewsToUpdate.add(`${escape.ident(partitionSchema)}.${escape.ident(partitionTable + "_latest")}`);

}

export function getEditsSchemaName(targetSchema: string, targetTable: string) {
    if (`${targetSchema}__${targetTable}` == BOUNDARY_EDITED_LAYER) {
        return targetSchema;
    } else {
        return `partitions_${targetSchema}_${targetTable}`;
    }
}

export function getEditsTableName(
    targetSchema: string,
    targetTable: string,
    boundaryId: string) {
    if (`${targetSchema}__${targetTable}` == BOUNDARY_EDITED_LAYER) {
        return targetTable;
    } else {
        return `${targetSchema}_${targetTable}_${boundaryId.padStart(5, '0')}`;
    }
}