import { v4 as uuidv4 } from 'uuid';
import fs from "fs";
import {APIError, HttpStatusCode, HttpStatusName} from "../../utils/errors/errors";
import {ExportRequest, ExportRequestSchema} from "../../server-interfaces/export/ExportRequest";

// import validateJobIdAndGetInfo from "../../middleware/queues/job-id-validation.middleware";

import GMT_CONFIG from "../../config/gmt.config";
import { COMMON_TASK_OPTIONS } from '../../config/bull.config';
import {dataExportQueue} from "../../queues/declarations";

/**
 * Start server side data exports - GDB from ui, Excel (not REW), and planned is REW Excel
 * Export file is created in the importer that is triggered in triggerExport method
 * Output is saved to ${GMT_CONFIG.dataExportPath}${userId}/${filename}.zip`
 * dataExportPath has trailing slash
 * @param ctx
 * @param next
 */
export async function handleTriggerDataExport(ctx, next) {
    try{
        await ExportRequestSchema.validate(ctx.request.body, { abortEarly: false });
    } catch(err){
        throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST,true, err.errors);
    }

    ctx.body = {success: false, jobId: -1};
    try {
        // empty case should never happen as it is validating that above
        //["0b8e1f11-70dc-4d07-9e56-a3151064449d","2f22a992-c134-41c9-8f46-0a17ac551384"];// ["3eba1f03-98d4-4335-804e-6c3f9e7d5da1"]

        const request: ExportRequest = ctx.request.body;

        console.log(ctx.request.body,'ctx.request.body');
        // custom export type or optional boundaries are not yet supported
        // let exportFileType = ctx.request.body.export_file_type ? ctx.request.body.export_file_type : 'ShapeFile';
        // only logged-in users are allowed to reach this method so this should always be set
        const userId = ctx.user_info?.sub; //"delete";
        const filename = `${(new Date().toJSON()).replace(':', '-').slice(0, 16)}_${uuidv4().slice(0, 3)}`;
        // generate filename here so that it would be saved to event data and could be accessible later
        const jobInfo = await dataExportQueue.add({
                request,
                userId,
                filename,
                reqId: ctx.state.reqId,
            },
            { ...COMMON_TASK_OPTIONS, attempts: 2, backoff: 5000, timeout: 300 * 60 * 1000 });  // Timeout of 6h (without it the jobs that were interrupted with deployment would be active forever)
        ctx.body = {success: true, jobId: jobInfo?.id};
    } catch (err) {
        console.log(err,'err');
       throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER, true, err?.response?.statusText);
    }
    await next();
}

/**
 * Start data export
 * @param ctx
 * @param next
 */
export async function handleDownloadExportedData(ctx, next) {
    let id = parseInt(ctx.request.params.id);
    if (id <= 0) {
        throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST, true,["Job id is not correct"]);
    }
    let job = await dataExportQueue.getJob(id);

    if (job === null) {
        throw new APIError(ctx, HttpStatusName.BAD_REQUEST,  HttpStatusCode.BAD_REQUEST, true, ["Job id was not found"]);
    }
    // don't check for the state in case if connection with the importer was lost and we have file generated just cannot access it
    // let state = await job.getState();
    // if (state != JobStatusState.completed) {
    //     throw new APIError(ctx, HttpStatusName.BAD_REQUEST,  HttpStatusCode.BAD_REQUEST, true, ["Job is not completed"]);
    // }
    try {
        let data = await job.data;
        let zipName = data?.filename.replace(".gdb", ".zip");
        //If it wasn't a gdb then just append zip
        if (zipName.indexOf(".zip") <= 0) {
            zipName = zipName + ".zip";
        }

        console.log(`Downloading zip ${zipName} containing file ${data?.filename}`);

        ctx.body = fs.createReadStream(`${GMT_CONFIG.dataExportPath}${ctx.user_info.sub}/${zipName}`);
        ctx.set('Content-disposition', `attachment; filename=${zipName}`);
        ctx.set('Content-type', 'application/zip');
        ctx.set('Access-Control-Expose-Headers', 'Filename');
        ctx.set('Filename', `${zipName}`);
    } catch (err) {
       throw new APIError(ctx, HttpStatusName.INTERNAL_SERVER, HttpStatusCode.INTERNAL_SERVER, true, err?.response?.statusText);
    }
    await next();
}
