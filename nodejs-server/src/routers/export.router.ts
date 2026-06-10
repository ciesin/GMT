import Router from "koa-router";
import {DefaultState, Context} from 'koa';
import {userHasAdminRole, userIsAuthenticated} from "../utils/auth/permissions.util";
import {
    handleDownloadExportedData,
    handleTriggerDataExport,
} from "../api/export/export_data";
import {getExportQueueJobStatus} from "../api/queues/retrieve_job_status";
import {handleRequestAllCatchmentUpdate} from "../api/db-write/catchment_update";
import {handleDownloadStateCsv, handleDownloadStateGdb, handleTriggerStateExport} from "../api/export/export_state";

const router = new Router<DefaultState, Context>({prefix: '/export'});

router.post("/data", userIsAuthenticated, handleTriggerDataExport);
router.get("/exportJob/:id", userIsAuthenticated, getExportQueueJobStatus);
router.get("/download/:id", userIsAuthenticated, handleDownloadExportedData);

router.get("/refreshStateExports", userIsAuthenticated, handleTriggerStateExport);

router.get("/download/:code/csv", handleDownloadStateCsv);
router.get("/download/:code/geom", handleDownloadStateGdb);


export default router;