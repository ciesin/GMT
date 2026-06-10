import {   registerBoundaryParticipation, resetMicroplan, unregisterAllParticipatingBoundaries } from "../../services/microplan/edit_microplan";

export async function handleRegisterBoundaryParticipation(ctx, next) {
    try {
        const boundaryGuidList: Array<string> = ctx.request.body;
        console.log(`handleRegisterBoundaryParticipation start with ${boundaryGuidList.length} entries`);
        const success = await registerBoundaryParticipation(
            ctx.user_info.preferred_username,ctx.
            user_info.sub,
            boundaryGuidList);
        ctx.body = {success: success};
    } catch (e) {
        console.error("Error from the handleRegisterBoundaryParticipation");
        console.log(e)
        ctx.body = e;
        ctx.response.status = 500;
    }

    await next();
}

export async function handleUnregisterAllParticipatingBoundaries(ctx, next) {
  try {
    const success = await unregisterAllParticipatingBoundaries(ctx.user_info.preferred_username);
    ctx.body = {success: success};
  } catch (e) {
    console.error("Error from the handleUnregisterAllParticipatingBoundaries");
    console.log(e)
    ctx.body = e;
    ctx.response.status = 500;
  }

  await next();
}


export async function handleResetMicroPlanning(ctx, next) {
    try {
        //Can be any level, in practice should be state or lga
        //operating boundaries are fetched later
        const boundaryGuidList: Array<string> = ctx.request.body;
        const success = await resetMicroplan(
            ctx.user_info.preferred_username,
            ctx.user_info.sub, boundaryGuidList);
        ctx.body = {success: success};
    } catch (e) {
        console.error("Error from the handleResetMicroPlanning");
        console.log(e)
        ctx.body = e;
        ctx.response.status = 500;
    }

    await next();
}