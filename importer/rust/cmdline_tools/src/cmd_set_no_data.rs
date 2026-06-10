use std::fs::remove_file;
use std::path::PathBuf;
use anyhow::Result;
use geo_util::raster::{Raster};

use structopt::StructOpt;
use crate::lhs_rhs_args::LhsRhsArgs;
use geo_util::raster::combine_rasters;


#[derive(StructOpt)]
pub struct NoDataArgs {

    #[structopt(flatten)]
    lhs_rhs: LhsRhsArgs,

    #[structopt(long, parse(from_os_str))]
    output: PathBuf,

    #[structopt(long)]
    clean: bool,
}


/// Modifies a raster such that if there is nodata in the 'no data raster' then
/// the input raster is modified to have no data
/// Note in the case the input raster has no data but not the 'no data raster', 0 is used
/// Assumes input and output are float32
pub fn set_no_data(args: &NoDataArgs) -> Result<()> {

    if args.clean && args.output.exists() {
        remove_file(&args.output)?;
    }

    if args.output.exists() {
        println!("{:?} already exists and --clean not passed, doing nothing", &args.output);
        return Ok(());
    }

    let nodata_value = {
        let input_stats = Raster::read(&args.lhs_rhs.raster_lhs, true);
        input_stats.stats.no_data_value
    };

    let nd_typed = nodata_value as i32;

    combine_rasters(
        &args.lhs_rhs.raster_lhs,
        &args.lhs_rhs.raster_rhs,
        &args.output,
        nodata_value,
        |v1: i32, _is_left_nodata, _v2, is_right_nodata| {

            Ok( if !is_right_nodata { v1 } else { nd_typed } )
        }
    )?;


    Ok(())
}