//import {APIError, HttpStatusCode, HttpStatusName} from "../../utils/errors/errors";
//import dataExportQueue from "../../queues/data-export.queue";

// this function would be nice as we repeat the code in several places, I am just not sure how to define Job type
// async function validateJobIdAndGetInfo(ctx, id: number): Job{
//     if (id <= 0) {
//         throw new APIError(ctx, HttpStatusName.BAD_REQUEST, HttpStatusCode.BAD_REQUEST, true,["Job id is not correct"]);
//     }
//     let job = await dataExportQueue.getJob(id);
//
//     if (job === null) {
//         throw new APIError(ctx, HttpStatusName.BAD_REQUEST,  HttpStatusCode.BAD_REQUEST, true, ["Job id was not found"]);
//     }
//     return job;
// }
// export default validateJobIdAndGetInfo;