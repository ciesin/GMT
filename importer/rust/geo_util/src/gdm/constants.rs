
pub const PATH_RASTER_DATA: &str = "raster_data";
pub const PATH_CLASSIFIED: &str = "classified";

pub const EXT_DAT: &str = "dat";
pub const EXT_CSV: &str = "csv";
pub const EXT_RTREE: &str = "rtree";
pub const EXT_OFFSET: &str = "offsets";

///https://github.com/openlayers/openlayers/blob/139b048197f705ccd26919813a6728496423b4be/src/ol/sphere.js#L24
/**
 * The mean Earth radius (1/3 * (2a + b)) for the WGS84 ellipsoid.
 * https://en.wikipedia.org/wiki/Earth_radius#Mean_radius
 * in meters
 */
pub const DEFAULT_RADIUS: f64 = 6371008.8;