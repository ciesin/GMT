import {Job} from "bull";
import { RequestAllIndicatorParameters } from "../api/db-write/indicator_update";
import { COMMON_TASK_OPTIONS } from "../config/bull.config";
import GMT_CONFIG from "../config/gmt.config";
import { Tables } from "../config/tables.config";
import { pool } from "../db-read/common";
import { saveNewCommit } from "../models/edits/commit";


import {
  allIndicatorEnums,
  getEnumMap,
    getOperatingBoundariesToProcess,
    IndicatorEnumName,
    initEntries,
    pruneTable,
    updateNonLeafLevel,
    updateOperatingBoundary
} from "../services/indicators/update_indicators";
import {indicatorUpdatesQueue} from "../queues/declarations";
import {JOB_NAME_UPDATE_LEAF_BOUNDARY_INDICATORS} from "../queues/hook-queue-processes";

export function updateAllIndicatorsProcess(job: Job, done: any) {
    updateAllIndicatorsProcessAsync(job, done).then();
}
async function updateAllIndicatorsProcessAsync(job: Job, done: any) {
    try {
        const jobParameters: RequestAllIndicatorParameters = job.data;
        await pruneTable(job);

        await initEntries(job);

        //Picked just to have a small number.  This progress is visible only to the bull dashboard
        const initialProgress = 3;
        await job.progress(initialProgress);

        const leafBoundaryIdsToProcess = await getOperatingBoundariesToProcess(job, jobParameters);

        const progressPerLeaf = (100 - initialProgress) / (leafBoundaryIdsToProcess.length || 1);

        await job.log(`leafBoundaryIdsToProcess length=${leafBoundaryIdsToProcess.length}`);

        const promiseList = [];
        let progCount = 0;
        for (const leafBoundaryId of leafBoundaryIdsToProcess) {

            const jobInfo = await indicatorUpdatesQueue.add(JOB_NAME_UPDATE_LEAF_BOUNDARY_INDICATORS, {leafBoundaryId}, {
                ...COMMON_TASK_OPTIONS,
                attempts: 2,
                backoff: 5000
            });  // repeat after 5s if job failed

            promiseList.push(jobInfo.finished());

            progCount += 1;
            await job.progress(Math.round(10 * (initialProgress + progCount * progressPerLeaf)) / 10.0);
            // if (promiseList.length > 3) {
            //     break;
            // }
        }

        await Promise.all(promiseList);

        await job.log("All boundary leaf entries updated");

        let level = GMT_CONFIG.maxBoundaryLevel - 1;

        while (level >= 0) {
            await updateNonLeafLevel(job, level);
            level -= 1;
        }

        //Now, if requested, we create a version entry
        if (jobParameters.updateCommitVersion) {
            await job.log("Updating commit version");
            const client = await pool.connect();
            try {
                const versionId = await saveNewCommit(client, "Indicator Update", "Indicators fully updated, saving new version to trigger dashboard download");
                await job.log(`Updating commit version finished -- ${versionId}`);

                //We actually don't want to inadvertantly force indicators to be recalculated, so we set the indicators to the version we just created
                await job.log(`Setting all ${Tables.indicators_boundary} versionId = ${versionId}`);
                await client.query(`
            UPDATE ${Tables.indicators_boundary}
            SET version_id = ${versionId}`);
            } finally {
                await client.release();
            }
        }

        await job.progress(100);

        await job.log("All level entries updated");

    } catch (e) {
        await job.log("Error from updateIndicators request.");
        await job.log(e);
        done(new Error("Error from updateIndicators request"));
    }

    done();
}


//Side job generated when updating all leaf boundaries
export function updateBoundaryLeaf(job: Job, done: any) {
    updateBoundaryLeafAsync(job, done).then();
}
async function updateBoundaryLeafAsync(job: Job, done: any) {
    try {
        const {leafBoundaryId} = job.data;

        //Don't cache in case we want to add values without restarting node, and because the perf penalty shouldn't be too bad
        //This method is only used when recalculating all indicators, something that should be in development or some rare db maintenance 
        const enumMap : Map<IndicatorEnumName, Map<string, number>> = new Map();
        
        for(const enumName of allIndicatorEnums) {
          enumMap.set(enumName, await getEnumMap(enumName));
        }

        await updateOperatingBoundary(job, leafBoundaryId, enumMap);
    } catch (e) {
        await job.log("Error from updateIndicators request.");
        await job.log(e);
        done(new Error("Error from updateIndicators request"));
    }

    done();
}
