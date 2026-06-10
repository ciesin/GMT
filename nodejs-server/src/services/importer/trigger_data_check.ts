import {default as axios} from "axios";
import {IMPORTER_HOST, IMPORTER_PORT} from "../../raster-read/handle_read_raster";

/*
boundaryGuid normally will be the one being submitted but could in theory be any level
*/
export async function postRunDataCheck( boundaryIds:Array<string>, jobId: string, reqId: string) {
    return await axios.post(`http://${IMPORTER_HOST}:${IMPORTER_PORT}/run_data_check`, {
        boundaryIds, jobId, reqId }, {
        timeout: 200 * 60 * 1000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
}