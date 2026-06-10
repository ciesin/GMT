import { Job } from "bull";
import fs from 'fs';
import {triggerExport} from "../services/importer/trigger_export";
import {sendEmailExportIsFinished} from "../services/email/email.service";
import {getUserEmailById} from "../services/user-admin/manage_users";
import GMT_CONFIG from "../config/gmt.config";
import {ExportRequest} from "../server-interfaces/export/ExportRequest";

export function dataExportProcess (job: Job, done: any) {
    dataExportProcessAsync(job, done).then();
}

async function dataExportProcessAsync (job: Job, done: any)  {
    try{
        const request:  ExportRequest = job.data.request;
        const filename: string = job.data.filename;
        const userId: string = job.data.userId;
        const reqId: string = job.data.reqId;
        // there is strange timeout maybe on flask side so we are checking if the product already is created before
        // asking to create it again...

        if (fs.existsSync(`${GMT_CONFIG.dataExportPath}${userId}/${filename}.zip`)) {
            await job.log("File already exists, skipping job ");
            await job.progress(100);
        } else{
            await job.progress(1);
            await job.log("Start data export at " + `${(new Date().toJSON()).replace(':', '-')}`);

            const response = await triggerExport(request, filename, userId, job.id as string, reqId);
            await job.log("End data export at " + `${(new Date().toJSON()).replace(':', '-')}`);
            await job.log(response?.status);
            await job.log(response?.statusText);
            // }
        }

        const userEmail = await getUserEmailById(userId);
        await sendEmailExportIsFinished(userEmail, job?.id as number);
        await job.log("Email sent");
        await job.progress(100);

    }catch (e) {
        await job.log("Error from triggerExport");
        await job.log(e);
        done(new Error("Error from triggerExport"));
    }

    done();
}