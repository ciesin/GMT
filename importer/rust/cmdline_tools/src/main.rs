//#![allow(warnings, unused)]
use anyhow::Result;
use log::LevelFilter;
use simple_logger::SimpleLogger;
use structopt::StructOpt;


use crate::cmd_ratio_raster::{RatioArgs, create_ratio_raster};
use crate::cmd_diff_raster::{DiffArgs, create_diff_raster};
use crate::cmd_burn_polygon_to_raster::{PolygonArgs, burn_polygon_to_raster};
use crate::cmd_fix_geom::{FixGeomArgs, run_fix_geom};
use crate::lhs_rhs_args::LhsRhsArgs;
use crate::cmd_set_no_data::{NoDataArgs, set_no_data};
use crate::cmd_raster_stats::print_stats;
use crate::cmd_count_to_raster::{CountToRasterCli, burn_count_to_raster};
use crate::cmd_merge_vector_layers_fast::{MergeVectorFastArgs, merge_vectors_fast};

mod cmd_burn_polygon_to_raster;
mod cmd_count_to_raster;
mod cmd_diff_raster;
mod cmd_fix_geom;
mod cmd_raster_stats;
mod cmd_ratio_raster;
mod cmd_set_no_data;
mod lhs_rhs_args;
mod cmd_merge_vector_layers_fast;

#[derive(StructOpt)]
struct Cli {

    #[structopt(long, default_value = "Warn")]
    log_level: LevelFilter,

    #[structopt(subcommand)]  // Note that we mark a field as a subcommand
    cmd: Command
}

#[derive(StructOpt)]
enum Command {
    #[structopt(help="Prints statistics on 2 rasters.  Total, pairwise diff, abs pairwise diff")]
    Stats(LhsRhsArgs),
    #[structopt(help="Divides one raster by another, outputs ratio raster")]
    Ratio(RatioArgs),
    #[structopt(help="Subtracts one raster by another, outputs diff raster and QGIS color map")]
    Diff(DiffArgs),
    #[structopt(help="Sets Nodata in 1 raster according to if NoData is in another raster.  Used to clip pop rasters to country")]
    SetNoData(NoDataArgs),
    #[structopt(help="Burns geometry")]
    BurnPolygonToRaster(PolygonArgs),
    #[structopt(help="Creates an FGB (FlatGeoBuff) with geometry corrections")]
    FixGeom(FixGeomArgs),
    #[structopt(help="Burns point count to a raster")]
    BurnCountToRaster(CountToRasterCli),

    #[structopt(help="Merge polygon vector layers together, outputs fixed (valid) non curved multi polygons.  Assumes inputs do not overlap")]
    MergeVectorFast(MergeVectorFastArgs),

}



fn run() -> Result<()> {
    let args = Cli::from_args();

    SimpleLogger::new()
        .with_level(args.log_level)
        .with_module_level("tokio_util", LevelFilter::Info)
        .with_module_level("tokio_postgres", LevelFilter::Info)
        .with_module_level("mio", LevelFilter::Info)
        .init()?;

    match &args.cmd {
        Command::Stats(r) => {
            print_stats(r)?;
        },
        Command::Ratio(r) => {
            create_ratio_raster(r)?;
        },
        Command::Diff(r) => {
            create_diff_raster( r)?;
        },
        Command::SetNoData(r) => {
            set_no_data(r)?;
        },
        Command::BurnPolygonToRaster(r) => {
            burn_polygon_to_raster(r)?;
        },
        Command::FixGeom(r) => {
            run_fix_geom(r)?;
        },
        Command::BurnCountToRaster(r) => {
            burn_count_to_raster(r)?;
        },

        Command::MergeVectorFast(r) => {
            merge_vectors_fast(r)?;
        }
    }

    Ok(())
}

fn main() {
    run().unwrap();
}

#[cfg(test)]
mod cmdline_tools_tests {

}

