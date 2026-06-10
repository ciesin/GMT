import { updateCatchmentsProcess} from "../processes/catchment.process";
import {
    catchmentUpdatesQueue, dataChecksQueue,
    dataExportQueue,
    indicatorUpdatesQueue, stateExportsQueue,

    syncingUpdatesQueue
} from "./declarations";
import {dataExportProcess} from "../processes/data-export.process";
import {updateAllIndicatorsProcess, updateBoundaryLeaf} from "../processes/indicator.process";
import {stateExportsProcess} from "../processes/state-exports.process";
import {syncEditsProcess} from "../processes/sync-edits.process";
import {dataChecksProcess} from "../processes/data-checks.process";

export const JOB_NAME_UPDATE_ALL_CATCHMENTS = "update-all-catchments";

export const JOB_NAME_UPDATE_ALL_BOUNDARY_INDICATORS = "update-all-boundary-indicators";

//internal job, child of JOB_NAME_UPDATE_ALL_BOUNDARY_INDICATORS
export const JOB_NAME_UPDATE_LEAF_BOUNDARY_INDICATORS = "update-leaf-boundary-indicators";

export function initializeQueueWorkers() {
    /*
    We want to use queues in both server and queues container
    But to have the workers only on the queues container

    Calling process is the equivalent of creating a worker
    */

    catchmentUpdatesQueue.on('error', e => console.error('err initializing the queue', e.message));
    catchmentUpdatesQueue.process(JOB_NAME_UPDATE_ALL_CATCHMENTS, updateCatchmentsProcess).then();



    dataExportQueue.on('error', e => console.error('err initializing data-export queue', e.message));
    const concurrencyOneAtATime = 1;
    dataExportQueue.process(concurrencyOneAtATime, dataExportProcess).then();


    indicatorUpdatesQueue.on('error', e => console.error('err initializing the queue', e.message));
    indicatorUpdatesQueue.process(JOB_NAME_UPDATE_ALL_BOUNDARY_INDICATORS, updateAllIndicatorsProcess).then();

    indicatorUpdatesQueue.process(JOB_NAME_UPDATE_LEAF_BOUNDARY_INDICATORS, updateBoundaryLeaf).then();

    //Used for both nat view api, excel exports, and perhaps in the future the pdf exports
    //Reason is they use the same schema to consolidate the GMT hf/set/ci data before exporting
    stateExportsQueue.on('error', e => console.error('err initializing state-export queue', e.message));
    stateExportsQueue.process(concurrencyOneAtATime, stateExportsProcess).then();


    syncingUpdatesQueue.on('error', e => console.error('err initializing the queue', e.message));
    syncingUpdatesQueue.process(syncEditsProcess).then();


    dataChecksQueue.on('error', e => console.error('err initializing data-checks queue', e.message));
    dataChecksQueue.process(concurrencyOneAtATime, dataChecksProcess).then();
}