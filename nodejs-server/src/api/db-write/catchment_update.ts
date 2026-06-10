
import { COMMON_TASK_OPTIONS } from "../../config/bull.config";
import {catchmentUpdatesQueue} from "../../queues/declarations";
import {
    JOB_NAME_UPDATE_ALL_CATCHMENTS,
} from "../../queues/hook-queue-processes";
import {pool} from "../../db-read/common";
import {Tables} from "../../config/tables.config";
import GMT_CONFIG from "../../config/gmt.config";



export async function handleRequestCatchmentUpdate(ctx, next) {

    try {

        const boundaryGuidList: Array<string> = ctx.request.body;
        const jobInfo = await catchmentUpdatesQueue.add( JOB_NAME_UPDATE_ALL_CATCHMENTS, {
            boundaryGuidList,
            reqId: ctx.state.reqId
        }, { ...COMMON_TASK_OPTIONS, attempts: 0, backoff: 5000 });  // repeat after 5s if job failed

        ctx.body = {jobId: jobInfo?.id};
    } catch (e) {
        console.error("Error from the queues");
        console.log(e)
        ctx.body = e;
        ctx.response.status = 500;
    }

    await next();
}

export async function handleRequestAllCatchmentUpdate(ctx, next) {

    try {
        let startFromIndex = ctx.request.body.startFromIndex ? ctx.request.body.startFromIndex : 0;

        let {rows: allLowestBoundaries} = await pool.query(`SELECT global_id FROM 
                      ${Tables.boundary_latest} 
                      WHERE level=${GMT_CONFIG.maxBoundaryLevel} 
                        AND geom IS NOT NULL
                        AND NOT ST_IsEmpty(geom)
                      ORDER BY global_id ASC`);

        const jobIds: Array<number> = [];


        for(let boundary of allLowestBoundaries.slice(startFromIndex, allLowestBoundaries.length)){
            //console.log(boundary.global_id, 'boundary.global_id and id');

            const jobInfo = await catchmentUpdatesQueue.add( JOB_NAME_UPDATE_ALL_CATCHMENTS, {
                boundaryGuidList: [boundary.global_id],
                reqId: ctx.state.reqId
            }, { ...COMMON_TASK_OPTIONS, attempts: 0, backoff: 5000 });  // repeat after 5s if job failed

            jobIds.push(jobInfo.id);
        }


        ctx.body = {jobIds};
    } catch (e) {
        console.error("Error from the queues");
        console.log(e)
        ctx.body = e;
        ctx.response.status = 500;
    }

    await next();
}
