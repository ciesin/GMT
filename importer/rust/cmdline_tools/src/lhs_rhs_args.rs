use structopt::StructOpt;
use std::path::PathBuf;

#[derive(StructOpt)]
pub struct LhsRhsArgs {
    /// Base raster
    #[structopt(parse(from_os_str), index=1, help="Base raster path")]
    pub(crate) raster_lhs: PathBuf,

    /// Compare raster
    #[structopt(parse(from_os_str), index=2, help="Compare raster path")]
    pub(crate) raster_rhs: PathBuf,
}