use geo_util::raster::{RasterResampleCli, run_raster_resample};

use structopt::StructOpt;

/// Resamples a raster to a f64 raster
/// Can either infer parameters from a snap raster
/// or specify each one
///
/// This also handles reprojection


fn main() {
    let args: RasterResampleCli = RasterResampleCli::from_args();
    run_raster_resample(&args).unwrap();
}


