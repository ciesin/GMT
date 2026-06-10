import { Job } from "bull";
import { updateCatchments} from "../services/catchment/update_catchments";

export function updateCatchmentsProcess(job: Job, done: any) {
    updateCatchmentsProcessAsync(job, done).then();
}

async function updateCatchmentsProcessAsync(job: Job, done: any) {
    try{
        await job.log("Submitting catchments");

        //First submit non deletions and the deletions
        const response1 = await updateCatchments(job.id as string, job.data.boundaryGuidList, job.data.reqId);

        await job.log("Submitted catchments");
        await job.progress(100);
        await job.log(response1?.status);
        await job.log(response1?.statusText);
        // job.log(response1?.data);
        // simulate failing job
        // done(new Error("Error from importer submit_edits internal http request"));


    }catch (e) {
        await job.log("Error from importer update_catchments");
        await job.log(e);
        done(new Error("Error from importer update_catchments"));
    }

    done();
}


