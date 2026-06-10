import { COMMON_TASK_OPTIONS } from "../../config/bull.config";
import {indicatorUpdatesQueue} from "../../queues/declarations";
import {JOB_NAME_UPDATE_ALL_BOUNDARY_INDICATORS} from "../../queues/hook-queue-processes";


export interface RequestAllIndicatorParameters {
  //As indicators change on commit, normally no need for a new commit id
  updateCommitVersion: boolean,

  //For dev tools, allow forced recalculation, like when catchments are calculated
  forceRefresh: boolean
}
export async function handleRequestAllIndicatorUpdate(ctx, next) {
  try {
    const jobParameters: RequestAllIndicatorParameters = ctx.request.body;
    const jobInfo = await indicatorUpdatesQueue.add( JOB_NAME_UPDATE_ALL_BOUNDARY_INDICATORS, jobParameters,
       { ...COMMON_TASK_OPTIONS, attempts: 0, backoff: 5000 });  // repeat after 5s if job failed

    ctx.body = {jobId: jobInfo?.id};
  } catch (e) {
    console.error("Error from the queues");
    console.log(e)
    ctx.body = e;
    ctx.response.status = 500;
  }
    
  await next();
}
  
  
