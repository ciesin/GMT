const GMT_CONFIG = {
    pwaUrl: process.env.PWA_URL,
    dataExportPath: '/data/export/',
    stateExportPath: '/data/state_export/',
    frontendLogsPath: '/data/frontend-logs/',
    maxBoundaryLevel: parseInt(process.env.OPERATIONAL_BOUNDARY_LEVEL),
};
export default GMT_CONFIG;
