//Queues are set up just by including them
//We don't want to add process on the server node, but we have apis that interact with the queues
const Queue = require('bull');
import REDIS_OPTIONS from "../config/queues.config";

export const catchmentUpdatesQueue = new Queue('catchment-updates', REDIS_OPTIONS);
export const dataExportQueue = new Queue('data-export', REDIS_OPTIONS);
export const indicatorUpdatesQueue = new Queue('indicator-updates', REDIS_OPTIONS);
export const stateExportsQueue = new Queue('states-export', REDIS_OPTIONS);
export const syncingUpdatesQueue = new Queue('syncing-updates', REDIS_OPTIONS);
export const dataChecksQueue = new Queue('data-checks', REDIS_OPTIONS);