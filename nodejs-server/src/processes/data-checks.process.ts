import {Job} from "bull";
import {postRunDataCheck} from "../services/importer/trigger_data_check";
import {sendEmailDataCheckFailed} from "../services/email/email.service";
import {addLogMessage} from "../services/logs/add_log";


export function dataChecksProcess (job: Job, done: any) {
    dataChecksProcessAsync(job, done).then();
}

 async function dataChecksProcessAsync (job: Job, done: any)  {

    try{

        const reqId: string = job.data.reqId;
        /*

        */
        const boundaryIds: Array<string> = job.data.boundaryIds;

        await job.log("Starting data check job")
        await job.progress(1)

        await job.log(`Start data check for boundary guid [${boundaryIds}] export at ${(new Date().toJSON()).replace(':', '-')}`);
        //console.log(`Start state [${stateCode}] export at ${(new Date().toJSON()).replace(':', '-')}`);

        const response = await postRunDataCheck(boundaryIds, job.id as string, reqId);
        await job.log("End data check at " + `${(new Date().toJSON()).replace(':', '-')}`);


        await job.log(response?.statusText);


        let all_ok = true;
        for(const checkItem of response.data.status.status_list) {
            all_ok = all_ok && checkItem.passed;
            await job.log(`For item ${checkItem.check_name} passed? ${checkItem.passed}`);
        }

        await job.log(`Data check result: ${all_ok} for ${boundaryIds.join(", ")}`);

        await addLogMessage(`Data check result: ${all_ok} for ${boundaryIds.join(", ")} `, "admin",
        response.data, "", "");

        if (!all_ok) {
            await sendEmailDataCheckFailed();
        }

        await job.progress(100);

        done();

    }catch (e) {
        await job.log("Error from dataChecksProcess");
        await job.log(e);
        //console.log(e);
        //console.log(`Done with error [${stateCode}] export at ${(new Date().toJSON()).replace(':', '-')} - ${e}`);
        done(new Error("Error from dataChecksProcess"));
    }


}