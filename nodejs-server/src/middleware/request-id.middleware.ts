import { v4 as uuidv4 } from 'uuid';

export async function addRequestId(ctx, next){
    ctx.state.reqId = uuidv4();
    await next();
}
