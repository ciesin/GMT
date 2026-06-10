import {Job} from "bull";
import {postRunStateExport} from "../services/importer/trigger_export";

//Do this because bull expects a non promise (as we take a callback)
export function stateExportsProcess (job: Job, done: any)  {
    stateExportsProcessAsync(job, done).then();
}

async function stateExportsProcessAsync(job: Job, done: any)  {
    const stateGuid = job.data.stateGuid;
    const stateCode = job.data.stateCode;
    try{

        const reqId: string = job.data.reqId;

        await job.log("Starting job")
        await job.progress(1)


        await job.log(`Start state [${stateCode}] export at ${(new Date().toJSON()).replace(':', '-')}`);
        //console.log(`Start state [${stateCode}] export at ${(new Date().toJSON()).replace(':', '-')}`);

        const response = await postRunStateExport(stateGuid, stateCode, job.id as string, reqId);
        await job.log("End data export at " + `${(new Date().toJSON()).replace(':', '-')}`);
        await job.log(response?.status);
        await job.log(response?.statusText);


        await job.progress(100);
        //console.log(`Done state [${stateCode}] export at ${(new Date().toJSON()).replace(':', '-')}`);
        done();

    }catch (e) {
        await job.log("Error from triggerStateExport");
        await job.log(e);
        //console.log(e);
        //console.log(`Done with error [${stateCode}] export at ${(new Date().toJSON()).replace(':', '-')} - ${e}`);
        done(new Error("Error from triggerStateExport"));
    }


}
