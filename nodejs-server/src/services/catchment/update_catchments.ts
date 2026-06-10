import {IMPORTER_HOST, IMPORTER_PORT} from "../../raster-read/handle_read_raster";

const axios = require('axios').default;


export async function updateCatchments(jobId: string, boundaryGuidList: Array<string>, reqId: string) {
    return await axios.post(`http://${IMPORTER_HOST}:${IMPORTER_PORT}/update_catchments`, {
        boundaryGuidList,
        jobId,
        reqId
    }, {
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
}




