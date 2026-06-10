import GMT_CONFIG from "../../config/gmt.config";
import {
    CATCHMENT_STATUS_NOT_STARTED,
    PARTICIPATING_PROPERTY, UNKNOWN,
    USER_ID_PROPERTY,
    USER_NAME_PROPERTY
} from "../../server-interfaces/GeoJson";
import { BasicTableName, SchemaName, Tables } from "../../config/tables.config";
import { getPartitionId, pool } from "../../db-read/common";
import escape from "pg-escape";
import { PoolClient } from "pg";
import { getEditsSchemaName, getEditsTableName } from "../importer/submit_edits";
import { saveNewCommit } from "../../models/edits/commit";

export async function registerBoundaryParticipation(userName: string,
    userId: string,
    boundaryGuidList: string[]
): Promise<boolean> {
    const client = await pool.connect();
    let versionId = -1;
    if (boundaryGuidList.length <= 0) {
        return false;
    }
    try {
        // await client.query("BEGIN");

        //41094;//
        //Don't create a new version id since that would involve a full indicator recalculation, which we want to avoid
        //Note in the UI, the indicators are refreshed afterwards with the option to create a new version
        console.log(`registerBoundaryParticipation beginning with ${boundaryGuidList.length} guids.  The relevant ones will have their participating flag set and the indicator version set to 0`);
        //versionId = await saveNewCommit(client, userName, "Update boundary participation");
        for (let boundaryGuid of boundaryGuidList) {
            let sql = await getRelevantBoundaryGuids(boundaryGuid);
            // await insertGeojsonIntoDatabase(crudAction.geojson_after, client, SchemaName.boundary, BasicTableName.polygon, versionId, matViewsToUpdate);
            const { rows } = await pool.query(sql);
            const relatedGlobalIds = rows.map(row => row.global_id);
            //console.log(`registerBoundaryParticipation relatedGlobalIds len ${relatedGlobalIds.length} `);
            await registerBoundaryParticipationForBoundaries(client, relatedGlobalIds, userId, userName);
        }
        await updateCatchmentStatusWithoutNewVersion(boundaryGuidList, CATCHMENT_STATUS_NOT_STARTED, client);
        console.log(`registerBoundaryParticipation refresh mat view`);
        await client.query(`REFRESH MATERIALIZED VIEW ${Tables.boundary_all}_latest`);
        // await client.query("COMMIT");
    } catch (e) {
        // await client.query("ROLLBACK");

        throw e;
    } finally {
        client.release()
    }

    return versionId > 0;
}

export async function resetMicroplan(userName: string,
    userId: string,
    boundaryGuidList: string[]
): Promise<boolean> {
    if (boundaryGuidList.length <= 0) {
        return false;
    }
    const client = await pool.connect();
    let versionId = -1;
    try {
        versionId = await saveNewCommit(client, userName, "Reset Microplan");
        for (let boundaryGuid of boundaryGuidList) {
            let sql = await getRelevantBoundaryGuids(boundaryGuid);
            const { rows } = await pool.query(sql);
            const relatedGlobalIds = rows.map(row => row.global_id);
            await resetMicroplanForBoundaries(userName, userId, relatedGlobalIds, versionId);
        }
    } catch (e) {
        throw e;
    } finally {
        client.release();
    }

    return versionId > 0;
}

//These should only be operating level boundaries
async function resetMicroplanForBoundaries(userName: string,
    userId: string,
    boundaryGuids: string[],
    versionId: number): Promise<void> {
    for (const boundaryGuid of boundaryGuids) {

        const boundaryPartitionId = await getPartitionId(pool, boundaryGuid);
        if (boundaryPartitionId == null) {
            //This is normal since the UI will ask for boundary ids of all levels and not just the
            //operating one (level 3 in Nigeria)
            continue;
        }


        const schemaName = getEditsSchemaName("health_facility", "point");
        const tableName = getEditsTableName("health_facility", "point", boundaryPartitionId.toString());

        // copy latest row to the new with updated version with updated MP status
        const query = `INSERT INTO ${schemaName}.${tableName} 
    (version_id, mp_status, properties, global_id, is_deleted, boundary_polygon, geom, name, synonyms, 
     equipment, services, level_of_care, maturity_level, primary_type, 
     operating_hours_start, operating_hours_stop, staff_names, staff_positions,
     staff_types, parent, transport, frequency, type, private, raster_width,
     raster_height, origin_x, origin_y, catchment_raster)
                       SELECT ${versionId}, '${CATCHMENT_STATUS_NOT_STARTED}',
     properties || '{"${USER_ID_PROPERTY}": "${userId}", "${USER_NAME_PROPERTY}": "${userName}"}',
     global_id, is_deleted, boundary_polygon, geom, name, synonyms, 
     equipment, services, level_of_care, maturity_level, primary_type, 
     operating_hours_start, operating_hours_stop, staff_names, staff_positions,
     staff_types, parent, transport, frequency, type, private, raster_width,
     raster_height, origin_x, origin_y, catchment_raster
       FROM ${schemaName}.${tableName} t
       WHERE EXISTS (SELECT 1
                     FROM ${schemaName}.${tableName}_latest v
                     WHERE v.version_id = t.version_id AND 
                           v.global_id = t.global_id);`;


        await pool.query(query);
        await pool.query(`REFRESH MATERIALIZED VIEW  ${schemaName}.${tableName}_latest;`);
    }

    //The indicator stats would need to be recalculated
    await pool.query(`
        UPDATE ${Tables.indicators_boundary}
        SET version_id = 0
        WHERE boundary_polygon IN ('${boundaryGuids.join("','")}')`);
}

//Sets all participating flags to false
export async function unregisterAllParticipatingBoundaries(username: string): Promise<boolean> {
    const client = await pool.connect();
    let versionId = -1;
    try {
        //The indicator stats would need to be recalculated
        let result = await client.query(`
            UPDATE ${Tables.indicators_boundary}
            SET version_id = 0
            WHERE boundary_polygon IN (SELECT global_id
                                       FROM ${Tables.boundary_all} b
                                       WHERE (b.properties ->>'${PARTICIPATING_PROPERTY}')::boolean
      );
        `);
        console.log("Result resetBoundaryParticipation", result.rowCount);

        //now reset them
        result = await client.query(`
            UPDATE ${Tables.boundary_all}
            SET properties = jsonb_set(properties, '{${PARTICIPATING_PROPERTY}}', 'false')
            WHERE (properties ->>'${PARTICIPATING_PROPERTY}')::boolean;
        `);

        console.log("Result 2 resetBoundaryParticipation", result.rowCount);

        console.log(`Refreshing ${Tables.boundary_all}_latest view`);
        await client.query(`REFRESH MATERIALIZED VIEW ${Tables.boundary_all}_latest`);

        versionId = await saveNewCommit(client, username, "Unregister all participating boundaries");
        // I don't like this solution, but that is the quickest way to do it
        const allBoundaryGuidsList = await getAllBoundaryGuids(client);
        await updateCatchmentStatusWithoutNewVersion(allBoundaryGuidsList, UNKNOWN, client);
    } catch (e) {
        await client.query("ROLLBACK");
        client.release();
        throw e;
    }
    return versionId > 0;
}

/**
 * 1. Find most recent version for each boundary
 * 2. Copy those rows and update version
 * 3. Update participating flag and username, user id
 * 4. Reset indicators version id
 * @param client
 * @param boundaryGuids
 * @param versionId
 * @param userId
 * @param userName
 */
async function registerBoundaryParticipationForBoundaries(client: PoolClient,
    boundaryGuids: string[],
    userId: string,
    userName: string): Promise<void> {

    if (!Array.isArray(boundaryGuids) || boundaryGuids.length <= 0) {
        //Note this can happen with the France/Suisse testing data
        console.warn("registerBoundaryParticipationForBoundaries called with no boundaryGuids.  Perhaps a boundary is not configured correctly");
        return;
    }

    /*
    boundaryGuids.forEach(async (bId: string) => {
        const query = `INSERT INTO ${Tables.boundary_all} (version_id,
                                                           global_id, is_deleted, boundary_polygon, geom, name,
                                                           code, level,
                                                           properties, num_pop_squares, computed_pop, hf_guids,
                                                           hf_names, bbox)
                       SELECT ${versionId},
                              global_id,
                              False,
                              boundary_polygon,
                              geom,
                              name,
                              code,
                              level,
                              properties,
                              num_pop_squares,
                              computed_pop,
                              hf_guids,
                              hf_names,
                              bbox
                       FROM ${Tables.boundary_latest}
                       WHERE global_id = '${bId}'`;
        await client.query(query);
    });
    */

    // SET properties = jsonb_set(properties, '{${PARTICIPATING_PROPERTY}}', 'true'),
    const updateQuery = `UPDATE ${Tables.boundary_all}
                         SET properties = properties || '{"${PARTICIPATING_PROPERTY}": true, "${USER_ID_PROPERTY}": "${userId}", "${USER_NAME_PROPERTY}": "${userName}"}'
                         WHERE global_id IN ('${boundaryGuids.join("','")}') `;

    await client.query(updateQuery);
    //AND version_id = ${versionId}`;

    //The indicator stats need to be recalculated, on a full indicator refresh, the entries in indicators.boundary with a lower version_id
    //than the committed one will be reset    
    await client.query(`
        UPDATE ${Tables.indicators_boundary}
        SET version_id = 0
        WHERE boundary_polygon IN ('${boundaryGuids.join("','")}')`);
}
/**
 *  Dynamically flatten recursive boundary tables to get all related boundary ids
 *  that are the same level or lower than the boundary id passed in
 */
async function getRelevantBoundaryGuids(boundaryGuid: string): Promise<string> {
    /**
     * Knowing boundary level can speed up the query
     * from 17s to 0.5s depending on the level
     * @param lowest_admin_b
     */
    async function getBoundaryLevel() {
        const { rows } = await pool.query(`SELECT level
                                         FROM ${Tables.boundary_latest}
                                         WHERE global_id = '${boundaryGuid}'`);
        if (rows.length > 0) {
            return rows[0].level;
        } else {
            return false
        }
    }

    function filterRelevantBoundaries(boundaryLevel: number) {
        let whereQuery = `WHERE boundary_${GMT_CONFIG.maxBoundaryLevel}.level = ${GMT_CONFIG.maxBoundaryLevel} `
        // filter by level
        for (let level = boundaryLevel; level < GMT_CONFIG.maxBoundaryLevel; level++) {
            whereQuery += ` AND boundary_${level}.level = ${level} `
        }
        whereQuery += ` AND ( boundary_${GMT_CONFIG.maxBoundaryLevel}.global_id = '${boundaryGuid}' `
        // filter by global ids
        for (let level = boundaryLevel; level < GMT_CONFIG.maxBoundaryLevel; level++) {
            whereQuery += ` OR boundary_${level}.global_id = '${boundaryGuid}' `
        }
        whereQuery += " ) "
        return whereQuery
    }

    function generateDynamicallyHierarchicalQueryWithFilter(boundaryLevel: number) {
        let selectQuery = `SELECT DISTINCT boundary_all.*
                           FROM ${Tables.boundary_latest} boundary_${GMT_CONFIG.maxBoundaryLevel}`
        let joinQuery = ""

        // 1. this will iterate all levels except the lowest one
        // form all joins
        for (let level = GMT_CONFIG.maxBoundaryLevel - 1; level >= boundaryLevel; level--) {
            let higherLevel = level + 1;
            joinQuery += ` INNER JOIN ${Tables.boundary_latest} AS boundary_${level} on boundary_${level}.global_id=boundary_${higherLevel}.boundary_polygon `
        }

        // join all rows from boundaries table
        joinQuery += ` FULL OUTER JOIN ${Tables.boundary_latest} boundary_all ON 1=1 `

        // 2. filter only relevant boundaries
        let whereQuery = filterRelevantBoundaries(boundaryLevel)

        // 2. filter "boundary_all" rows by those relevant boundaries
        whereQuery += "AND ("
        for (let level = boundaryLevel; level <= GMT_CONFIG.maxBoundaryLevel; level++) {
            if (level != boundaryLevel) {
                whereQuery += " OR ";
            }
            whereQuery += `boundary_all.global_id = boundary_${level}.global_id `;
        }
        whereQuery += ")"
        return selectQuery + joinQuery + whereQuery
    }

    let boundaryLevel = await getBoundaryLevel();
    if (boundaryLevel !== false) {
        return generateDynamicallyHierarchicalQueryWithFilter(boundaryLevel);
    }
}

async function updateCatchmentStatusWithoutNewVersion(boundaryGuids: string[],
    catchmentStatus: string,
    pool: PoolClient) { // : Promise<void>
    for (const boundaryGuid of boundaryGuids) {
        const boundaryPartitionId = await getPartitionId(pool, boundaryGuid);

        if (boundaryPartitionId == null) {
            //This is normal since the UI will ask for boundary ids of all levels and not just the
            //operating one (level 3 in Nigeria)
            continue;
        }
        const schemaName = getEditsSchemaName("health_facility", "point");
        const tableName = getEditsTableName("health_facility", "point", boundaryPartitionId.toString());

        // copy latest row to the new with updated version with updated MP status
        const query = `UPDATE ${schemaName}.${tableName} t
            SET mp_status='${catchmentStatus}'
            WHERE EXISTS (SELECT 1
                     FROM ${schemaName}.${tableName}_latest v
                     WHERE v.version_id = t.version_id AND 
                           v.global_id = t.global_id);`;
        await pool.query(query);
        await pool.query(`REFRESH MATERIALIZED VIEW  ${schemaName}.${tableName}_latest;`);
    }

    //The indicator stats would need to be recalculated
    await pool.query(`
        UPDATE ${Tables.indicators_boundary}
        SET version_id = 0
        WHERE boundary_polygon IN ('${boundaryGuids.join("','")}')`);
}

async function getAllBoundaryGuids(client: PoolClient): Promise<string[]> {
    const { rows } = await client.query(`SELECT global_id FROM ${Tables.boundary_latest}
                                     WHERE level = ${GMT_CONFIG.maxBoundaryLevel}`);
    if (rows.length > 0) {
        return rows.map(x => x.global_id);
    } else {
        return []
    }
}