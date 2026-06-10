import { Job } from "bull";
import {submit_edits} from '../services/importer/submit_edits';
import {CrudAction} from "../server-interfaces/CrudAction";


export function syncEditsProcess (job: Job, done: any) {
    syncEditsProcessAsync(job, done).then();
}

async function syncEditsProcessAsync (job: Job, done: any)  {
    const reqId: string = job.data.reqId;
    try{
        const crudActions: Array<CrudAction> = job.data.crudActions;

        //First submit non deletions and the deletions
        await job.progress(0);

        await submit_edits(job, crudActions, reqId);
        await job.log("Submitted edits");

        await job.progress(100);

    } catch (e) {
        await job.log(`Error from syncEditsProcess\n${e.stack}, reqId ${reqId}`);
        await job.log(e);
        done(new Error("Error from syncEditsProcess"));
    }

    done();
}
