
import {dataChecksQueue} from "../../queues/declarations";
import {COMMON_TASK_OPTIONS} from "../../config/bull.config";




export async function handleRequestDataCheck(ctx, next) {
    const {boundaryIds, surroundingBoundaryIds} = ctx.request.body as {boundaryIds:Array<string>, surroundingBoundaryIds: Array<string>};
    try {
        const jobInfo = await dataChecksQueue.add({boundaryIds, surroundingBoundaryIds, reqId: ctx.state.reqId}, { ...COMMON_TASK_OPTIONS, attempts: 2, backoff: 5000 });  // repeat after 5s if job failed
        ctx.body = {jobId: jobInfo?.id};
    } catch (e) {
        console.error("Error from the queues");
        console.log(e)
        ctx.body = e;
        ctx.response.status = 500;
    }

    await next();
}