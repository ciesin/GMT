import {addLogMessage, createLogTableIfNeeded} from "../../services/logs/add_log";

/*
Adds a log message to the database
*/
export async function handle_add_log_message(ctx, next) {
    const logMessageJson = ctx.request.body;

    //Less risky to get the username from the client side
    //const userInfo = await auth.grantManager.userInfo(ctx.get('Authorization'));
    //console.log(`Adding Log with Username: `, userInfo.preferred_username);

    const message = ctx.request.query.message;
    const userName = ctx.request.query.userName;
    const appVersion = ctx.request.query.appVersion;
    const gitHash = ctx.request.query.gitHash;
    console.log(`Adding Log with Message: ${message} UserName: ${userName} App Version: ${appVersion} GitHash: ${gitHash}`);

    await createLogTableIfNeeded();
    await addLogMessage(message, userName, logMessageJson, appVersion, gitHash);

    ctx.body = {status: 'ok'};

    await next();
}

