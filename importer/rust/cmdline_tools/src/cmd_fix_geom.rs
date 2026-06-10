use anyhow::Result;
use std::path::PathBuf;
use geo_util::vector::run_fix_geometry;
use structopt::StructOpt;

#[derive(StructOpt)]
pub struct FixGeomArgs {

    #[structopt(long)]
    input_dataset: String,

    #[structopt(long)]
    input_layer: String,

    #[structopt(parse(from_os_str), long)]
    output_dataset: PathBuf,

    #[structopt(long, default_value = "FlatGeobuf")]
    output_format: String,

}

pub fn run_fix_geom(args: &FixGeomArgs) -> Result<()> {
    run_fix_geometry(
        &args.input_dataset,
        &args.input_layer,
        args.output_dataset.to_str().unwrap(),
        args.output_dataset.file_stem().unwrap().to_str().unwrap(),
        &args.output_format,
    )
}