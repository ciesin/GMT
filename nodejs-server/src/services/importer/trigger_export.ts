// import axios from "./axios-intercepted.service";
import {ExportRequest} from "../../server-interfaces/export/ExportRequest";

const axios = require('axios').default;
import {IMPORTER_HOST, IMPORTER_PORT} from "../../raster-read/handle_read_raster";

// GDB export from the UI
export async function triggerExport(request: ExportRequest, filename: string, userId: string, jobId: string, reqId: string) {
    return await axios.post(`http://${IMPORTER_HOST}:${IMPORTER_PORT}/trigger_export`, {
        request, filename, userId, jobId, reqId }, {
        timeout: 100 * 60 * 1000, // wait for 100 minutes
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
}


export async function postRunStateExport(stateGuid: string, stateCode: string, jobId: string, reqId: string) {
    return await axios.post(`http://${IMPORTER_HOST}:${IMPORTER_PORT}/run_state_export`, {
        stateGuid, stateCode, jobId, reqId }, {
        timeout: 200 * 60 * 1000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
}

