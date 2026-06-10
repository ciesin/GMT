import Router from "koa-router";
import {Context, DefaultState} from "koa";
import {
    userHasAdminRole,
    userHasEditorRole,
    userIsAuthenticated,
    validateCrudActionsPermissions
} from "../utils/auth/permissions.util";
import {handleSubmitEdits} from "../api/db-write/submit_edits";
import {
    get_catchment_queue_job_status, get_data_check_job_status,
    get_indicator_queue_job_status,
    get_sync_updates_queue_job_status
} from "../api/queues/retrieve_job_status";
import {handleRequestAllIndicatorUpdate} from "../api/db-write/indicator_update";
import {
    handleRequestAllCatchmentUpdate,
    handleRequestCatchmentUpdate,

} from "../api/db-write/catchment_update";
import {handle_add_log_message} from "../api/db-write/submit_log";
import {handleRequestDataCheck} from "../api/db-write/data_check";

const router = new Router<DefaultState, Context>();

router.use(userIsAuthenticated);

router.post("/submit_edits",
    userHasEditorRole,
    validateCrudActionsPermissions,
    handleSubmitEdits);
router.get("/submitEditsJob/:id", get_sync_updates_queue_job_status);

router.post("/request_all_indicator_update",
    handleRequestAllIndicatorUpdate
);

router.get("/indicatorUpdateJob/:id", get_indicator_queue_job_status);

//Done during checkout and sync
router.post("/request_catchment_update",
    handleRequestCatchmentUpdate
    );
router.get("/catchmentUpdateJob/:id", get_catchment_queue_job_status);

router.post("/updateAllCatchments", userIsAuthenticated, userHasAdminRole, handleRequestAllCatchmentUpdate);

router.post("/add_log_message", handle_add_log_message);

router.post("/request_data_check", handleRequestDataCheck);

router.get("/dataCheckJob/:id", get_data_check_job_status);

export default router;