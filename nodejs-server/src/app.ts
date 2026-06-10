import fs from "fs";
import Koa, {Context, DefaultState} from "koa";
import Router from "koa-router";
import serve from 'koa-static';
import mount from 'koa-mount';
import cors from "@koa/cors";
import json from "koa-json";
import bodyParser from "koa-bodyparser";
import compress from "koa-compress";

import logger from "./middleware/logger";
import UserAdminRouter from "./routers/user-admin.router"
import ApiTokenRouter from "./routers/api-token.router"
import LogsRouter from "./routers/logs.router"
import DataExport from "./routers/export.router"
import EditMicroplan from "./routers/edit-microplan.router"
import DataReadRouter from "./routers/data-read.router"
import DataUpdateRouter from "./routers/data-update.router"
import auth from "./utils/auth/authInit.util";
import {addRequestId} from "./middleware/request-id.middleware";


const app = new Koa();
app.use(compress({
    threshold: 2048,
    gzip: {
        flush: require('zlib').constants.Z_SYNC_FLUSH
    },
    deflate: {
        flush: require('zlib').constants.Z_SYNC_FLUSH,
    },
    br: false
}));

app.use(bodyParser({
    enableTypes: ['json', 'text', 'form', 'json', 'xml'],
    textLimit: '100mb',
    formLimit: '100mb',
    jsonLimit: '100mb',
    onerror: function (err, ctx: Context) {
        ctx.throw('body parse error', 422);
    }
}));

const publicRouter = new Router<DefaultState, Context>();



auth.middleware().map(item => {
   app.use(item)
});
app.use(cors());
app.use(addRequestId);

//serve end user documentation as static files
if (fs.existsSync('./help')) {
    app.use(mount('/help', serve('./help')));
} else{
    console.warn("Help folder not found")
}


app.use(DataReadRouter.routes());
app.use(DataReadRouter.allowedMethods());

app.use(DataUpdateRouter.routes());
app.use(DataUpdateRouter.allowedMethods());

app.use(LogsRouter.routes());
app.use(LogsRouter.allowedMethods());

// Users administration routes
app.use(UserAdminRouter.routes());
app.use(UserAdminRouter.allowedMethods());

// API Token routes
app.use(ApiTokenRouter.routes());
app.use(ApiTokenRouter.allowedMethods());

// Data export routes
app.use(DataExport.routes());
app.use(DataExport.allowedMethods());

app.use(EditMicroplan.routes());
app.use(EditMicroplan.allowedMethods());

// Middlewares
app.use(json());
app.use(logger(null));




// Routes

app.use(publicRouter.routes()).use(publicRouter.allowedMethods());
export = app;
