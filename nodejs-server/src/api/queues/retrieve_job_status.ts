import {APIError, HttpStatusCode, HttpStatusName} from "../../utils/errors/errors";
import {
    catchmentUpdatesQueue, dataChecksQueue,
    dataExportQueue,
    indicatorUpdatesQueue,
    syncingUpdatesQueue
} from "../../queues/declarations";



export async function get_sync_updates_queue_job_status(ctx, next) {
    await get_queue_job_status(syncingUpdatesQueue, ctx, next);
}

export async function get_indicator_queue_job_status(ctx, next) {
    await get_queue_job_status(indicatorUpdatesQueue, ctx, next);
}

export async function get_catchment_queue_job_status(ctx, next) {
    await get_queue_job_status(catchmentUpdatesQueue, ctx, next);
}

export async function getExportQueueJobStatus(ctx, next) {
    await get_queue_job_status(dataExportQueue, ctx, next);
}

export async function get_data_check_job_status(ctx, next) {
    await get_queue_job_status(dataChecksQueue, ctx, next);
}


async function get_queue_job_status(queue, ctx, next) {
    let id = parseInt(ctx.request.params.id);
    if (id <= 0) {
        throw new APIError(ctx,
            HttpStatusName.BAD_REQUEST,
            HttpStatusCode.BAD_REQUEST, true,
            ["Job id is not correct"]);
    }
    let job = await queue.getJob(id);

    if (job === null) {
        throw new APIError(ctx,
            HttpStatusName.BAD_REQUEST,
            HttpStatusCode.BAD_REQUEST, true,
            ["Job id was not found"]);
    }
    let state = await job.getState();
    let progress = job._progress;
    ctx.body = {state, progress};
    await next();
}