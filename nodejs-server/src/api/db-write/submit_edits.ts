import {CrudAction} from "../../server-interfaces/CrudAction";

import { COMMON_TASK_OPTIONS } from "../../config/bull.config";
import {syncingUpdatesQueue} from "../../queues/declarations";


export async function handleSubmitEdits(ctx, next) {
    const crudActions: Array<CrudAction> = ctx.request.body;
    try {
        const jobInfo = await syncingUpdatesQueue.add({crudActions, reqId: ctx.state.reqId}, { ...COMMON_TASK_OPTIONS, attempts: 2, backoff: 5000 });  // repeat after 5s if job failed
        ctx.body = {jobId: jobInfo?.id};
    } catch (e) {
        console.error("Error from the queues");
        console.log(e)
        ctx.body = e;
        ctx.response.status = 500;
    }

    await next();
}

