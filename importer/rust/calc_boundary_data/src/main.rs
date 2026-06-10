use anyhow::Result;
use log::LevelFilter;
use simple_logger::SimpleLogger;
use structopt::StructOpt;
use crate::cmd_calc_boundary_data_rs::{CalcBoundaryDataArgs, run_calc_boundary_data};

mod boundary;
mod hf;
mod sp;
mod ci;
mod rtree;
mod weights;
mod cmd_calc_boundary_data_rs;

/*

Example to run in the rust directory in the importer docker container

cargo run --release --bin calc_boundary_data -- \
--log-level "debug" calc-boundary-data \
--gmt-database-pg-conn "postgresql://gmt_dev:gmt_dev_user_password@gmt_db:5432/gmt" \
--pop-raster "/data/rasters/input/pop_4326.tif" \
--boundary-guid "19bdbc11-38ad-4f25-aa9c-82951a025153" --boundary-guid "737289c5-b534-4f01-b6f6-ce2e8a77ea70" --boundary-guid "f18f6b2e-0de8-4252-8362-b7933fd5d61e" --boundary-guid "05431b92-f04d-4f60-ad77-46263483c1b8" --boundary-guid "0552ea56-cc80-4056-9ff1-2ac4c1eaeb7b" --boundary-guid "06eb2fcd-0c95-411e-87ad-805fa1a5ca4b" --boundary-guid "07333309-98cd-4ff8-8399-5f20ae6c65de" --boundary-guid "0a6f11d5-38f5-412f-bbf0-9449197ba848" --boundary-guid "24b045f1-beb7-46b8-8e2a-1b54cf79a29a" --boundary-guid "2a05b0cd-4c11-4f69-a1c1-03f20ebe0874" --boundary-guid "2aa99763-c564-4fd3-8b79-c88de2eca1fd" --boundary-guid "2f272993-5feb-432d-952d-ba76f2e5bf1d" --boundary-guid "364bb20e-b3e7-49c7-8f45-839850a8d6e4" --boundary-guid "3a60cc92-eb94-49bc-a393-54696f211a4e" --boundary-guid "3e774e4b-126f-433c-99c2-98088a4cc4db" --boundary-guid "5760cd90-b90c-41f2-b839-ef51c220b614" --boundary-guid "6cb911aa-0d32-4bb6-bb91-66b9a15289ee" --boundary-guid "709b9f22-f0f7-459b-911c-2f23c472dedf" --boundary-guid "722e89c7-1d50-478c-86c8-173e05a942b6" --boundary-guid "75625805-0942-4ad9-a084-4039c638b3d6" --boundary-guid "7bd3639a-f66f-43ea-b4cd-496b33eb8e51" --boundary-guid "8c991bbf-f937-45fe-b845-6f5c14bf0af9" --boundary-guid "8d778112-1d42-49e7-843b-6ba030ecc5a5" --boundary-guid "9ed206f8-4b3e-4fae-9a50-718e93bf0c57" --boundary-guid "a0e5e235-119b-4fbb-aa7c-9a2a738ad1ea" --boundary-guid "a8db00fb-5838-48ff-9c0c-d4bf67d5484d" --boundary-guid "b8eb3c56-87cf-455f-b13b-7359cdbe8832" --boundary-guid "d02bc2ec-f9e4-4233-b19e-857f70dd746f" --boundary-guid "d15edf32-db95-4134-a472-bf32a1ce6f5a" --boundary-guid "e0a58da9-bd00-4f69-9681-d31dbb69728a" --boundary-guid "ea2277d1-89d1-4067-9015-981deb83936a" --boundary-guid "eb903800-a1c7-49e1-aac2-99e1b964ad1c" --boundary-guid "f17d74cd-5eae-4e90-ac90-609705f2105a" --boundary-guid "f335b863-9e19-4866-befa-39ae50149832"

 This recomputes the catchments for HF and SP (which raster squares are included)
 and the rasterized settlement parts

 And of course, the ri.catchment items

 Note that

 */

#[derive(StructOpt)]
struct Cli {

    #[structopt(long, default_value = "Warn")]
    log_level: LevelFilter,

    #[structopt(subcommand)]  // Note that we mark a field as a subcommand
    cmd: Command
}

#[derive(StructOpt)]
enum Command {

    CalcBoundaryData(CalcBoundaryDataArgs)
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

        Command::CalcBoundaryData(r) => {
            run_calc_boundary_data(r)?;
        }
    }

    Ok(())
}

fn main() {
    run().unwrap();
}