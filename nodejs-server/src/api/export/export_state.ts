import {APIError, HttpStatusCode, HttpStatusName} from "../../utils/errors/errors";

import GMT_CONFIG from "../../config/gmt.config";
import { COMMON_TASK_OPTIONS } from '../../config/bull.config';

import fs from "fs";
import {pool} from "../../db-read/common";
import {stateExportsQueue} from "../../queues/declarations";
const jwt = require('jsonwebtoken');

/**
 * Triggers job that will redo all the state exports that create the gdb / csv zip files
 * to feed the data for the natview api
 */
export async function handleTriggerStateExport(ctx, next) {


    ctx.body = {success: false, jobId: -1};
    try {
        const stateGuidCodes = await pool.query(`Select b1.global_id, b1.code FROM boundary.polygon_latest b1 where b1.level=1 order by b1.code`);

        const jobCounts = await stateExportsQueue.getJobCounts();
        let jobCount = 0;
        for(const jobStatus in jobCounts) {
            if (['active', 'completed', 'failed'].includes(jobStatus)) {
                continue;
            }
            jobCount += jobCounts[jobStatus];
        }
        console.log(`Pending job count for any state: [${jobCount}]`, jobCounts);


        const statesThatAreRunning: Map<string, boolean> = new Map();

        const jobs = await stateExportsQueue.getJobs()
        for (const job of jobs) {
            const stateCode = job.data.stateCode;
            const jobStatus = await job.getState();

            if (['active', 'completed', 'failed'].includes(jobStatus)) {
                continue;
            }
            console.log(`Found existing job ${job.id} for state [${stateCode}]`);
            statesThatAreRunning.set(stateCode, true);
        }
        const jobIds = [];

        const now = new Date();
        const target = new Date(now);
        target.setUTCHours(23, 0, 0, 0); // 11:00 PM UTC

        // If it's already past today, set it for tomorrow
        if (target < now) {
          target.setUTCDate(target.getUTCDate() + 1);
        }

        const delayMs = target.getTime() - now.getTime();

        for(const [index, guidCode] of stateGuidCodes.rows.entries()) {
            if (statesThatAreRunning.get(guidCode['code'])) {
                console.log(`State [${guidCode['code']}] already running`, guidCode);
                continue;
            }
            console.log(`Queuing job for state [${guidCode['code']}]`, guidCode);

            const jobInfo = await stateExportsQueue.add({
                reqId: ctx.state.reqId,
                stateCode: guidCode['code'],
                stateGuid: guidCode['global_id'],
            },
            { ...COMMON_TASK_OPTIONS, attempts: 2, backoff: 5000, timeout: 900 * 60 * 1000, delay: delayMs});

            console.log(`Added job ${jobInfo.id} for state ${guidCode['code']} with delay ${delayMs/60000}m`);
            jobIds.push(jobInfo.id);
        }



        ctx.body = {success: true, jobIds};
    } catch (err) {
        console.log(err,'err');
       throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER, true, err?.response?.statusText);
    }
    await next();
}

/**
 * Streams the already prepared csv file
 */
export async function handleDownloadStateCsv(ctx, next) {
    await handleDownloadCommon(ctx, next, true);
}

/**
 * Streams the already prepared csv file
 */
export async function handleDownloadStateGdb(ctx, next) {
    await handleDownloadCommon(ctx, next, false);
}

async function handleDownloadCommon(ctx, next, isCsv: boolean) {
    let stateCode = ctx.request.params.code;
    if (!stateCode || stateCode.length != 2) {
        throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST, true,["State code must be 2 characters"]);
    }
    stateCode = stateCode.toUpperCase();

    const key = process.env.API_TOKEN_SECRET_KEY;

    const authHeader = ctx.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new APIError(ctx, HttpStatusName.UNAUTHENTICATED, HttpStatusCode.UNAUTHENTICATED, true, [
            "Missing or invalid Authorization header"
        ]);
    }

    const token = authHeader.split(' ')[1];
    let decoded: any;

    try {
        decoded = jwt.verify(token, key);
    } catch (err) {
        throw new APIError(ctx, HttpStatusName.UNAUTHENTICATED, HttpStatusCode.UNAUTHENTICATED, true, [
            "Invalid or expired token"
        ]);
    }

    //console.log(decoded);
    //Check tokenName and userId exist in the database
    const db_res = await pool.query(`
        SELECT hash_id, "name", user_id, use_count, expire_date
        FROM auth.api_token_hash
        WHERE user_id = $1 AND name = $2;
    `, [decoded.userId, decoded.tokenName]);

    if (db_res.rowCount == 0) {
        throw new APIError(ctx, HttpStatusName.FORBIDDEN_CLIENT_ERROR, HttpStatusCode.FORBIDDEN_CLIENT_ERROR, true, [
            "Token not registered with GMT"
        ]);
    }

    const hash_id = db_res.rows[0].hash_id;
    //console.log(`Incrementing use count for [${hash_id}] user [${decoded.userId}] and token [${decoded.tokenName}]`);

    const update_res = await pool.query(`
        UPDATE auth.api_token_hash
        SET use_count = use_count + 1
        WHERE hash_id = $1;
    `, [hash_id]);

    //console.log(`Updated ${update_res.rowCount} rows for use count`);

    try {
        let zipName = `GMT_${stateCode}_` + (isCsv ? "CSV" : "GEOM") + ".zip";

        console.log(`Downloading zip ${zipName}`);

        ctx.body = fs.createReadStream(`${GMT_CONFIG.stateExportPath}${stateCode}/${zipName}`);
        ctx.set('Content-disposition', `attachment; filename=${zipName}`);
        ctx.set('Content-type', 'application/zip');
        ctx.set('Access-Control-Expose-Headers', 'Filename');
        ctx.set('Filename', `${zipName}`);
    } catch (err) {
       throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER, true, err?.response?.statusText);
    }
    await next();
}
