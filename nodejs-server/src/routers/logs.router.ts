import Router from "koa-router";
import {DefaultState, Context} from 'koa';
import { koaBody } from 'koa-body';
import {handleUploadUserLogs} from "../api/logs/save_logs";
import { userIsAuthenticated } from "../utils/auth/permissions.util";


const router = new Router<DefaultState, Context>({prefix: '/logs'});
router.post("/upload", koaBody({
    textLimit: '100mb',
    // multipart: true,
    // formLimit: '100mb',
    // jsonLimit: '100mb',
    // jsonStrict: false,
    // includeUnparsed: true,
    // parsedMethods: ['POST', 'PUT', 'PATCH'],
    onError: (e) => {
        console.log('onError while upload/logs');
        console.log(e);
    }
}), userIsAuthenticated, handleUploadUserLogs);

export default router;