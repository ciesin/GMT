import fs from "fs";
import {Context} from "koa";
// const mime = require('mime-types');
import {APIError, HttpStatusCode, HttpStatusName} from "../../utils/errors/errors";
import GMT_CONFIG from "../../config/gmt.config";
// import {ExportRequestSchema} from "../../server-interfaces/export/ExportRequest";

/**
 * Start data export
 * @param ctx
 * @param next
 */
export async function handleUploadUserLogs(ctx: Context, next) {
    ctx.body = {success: false};
    createLogsDirIfNotExists();
    try {
        const userId = ctx.user_info?.sub;
        let userFilepath = `${GMT_CONFIG.frontendLogsPath}/user_logs_${(new Date(Date.now())).toISOString()}_${userId}`
        const clientFilename = ctx.query.clientFilename as string;
        if(clientFilename.endsWith('.csv')){
            userFilepath += '.csv';
        } else{
            userFilepath += '.indexeddb';
        }
        if(ctx.request?.body){
            fs.writeFileSync(userFilepath, ctx.request?.body as string);
        }
        if(typeof(ctx.query.clientFilename) == 'string'){
            fs.appendFileSync(userFilepath, '\nclient filename: '+ clientFilename);
        }
        ctx.body = {success: true};
    } catch (err) {
       console.log(err,'err');
       throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST, true, err);
    }
    await next();
}

function createLogsDirIfNotExists(){
    if(!fs.existsSync(`${GMT_CONFIG.frontendLogsPath}`)){
       fs.mkdirSync(`${GMT_CONFIG.frontendLogsPath}`);
    }
}

