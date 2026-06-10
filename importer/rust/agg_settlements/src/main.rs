use anyhow::Result;
use log::LevelFilter;
use simple_logger::SimpleLogger;
use structopt::StructOpt;
use crate::cmd_agg_settlements::{ run_agg_settlements, RunAggSettlementsArgs};
use crate::cmd_export::{ExportArgs, run_cmd_export};


mod rtree;
mod sn;
mod boundary;
mod cmd_agg_settlements;
mod cmd_export;
mod sp;

/*

Yashikira 2

cargo run --release --bin agg_settlements -- \
--log-level "debug" agg-settlements \
--gmt-database-pg-conn "postgresql://gmt_dev:gmt_dev_user_password@gmt_db:5432/gmt" \
--boundary-guid "5500c971-ec77-4358-878e-86a1b30bb51d"

kurmin kogi (sprawling has)
and unguwar gaya

where id.global_id in ('bea60cca-2d72-4b32-a3a5-ce2acfb9b369',
                    'c49b643d-dd81-4648-809b-d622dcaf7516');

docker exec -it `docker ps -qf "name=gmt_importer"` bash
cd /rust

cargo run --release --bin agg_settlements -- \
--log-level "debug" agg-settlements \
--gmt-database-pg-conn "postgresql://gmt_dev:gmt_dev_user_password@gmt_db:5432/gmt" \
--boundary-guid "c87b8b4d-b014-4018-b158-8533d39b4d49"


--boundary-guid "bea60cca-2d72-4b32-a3a5-ce2acfb9b369"

\
--boundary-guid "c49b643d-dd81-4648-809b-d622dcaf7516"


Ediene 2 and unguway

cargo run --release --bin agg_settlements -- \
--log-level "debug" agg-settlements \
--gmt-database-pg-conn "postgresql://gmt_dev:gmt_dev_user_password@gmt_db:5432/gmt" \
--boundary-guid "e57da1f9-3605-4e5c-af6e-54999333880d"

 \
--boundary-guid "c49b643d-dd81-4648-809b-d622dcaf7516" \
--boundary-guid "bea60cca-2d72-4b32-a3a5-ce2acfb9b369"


cargo run --release --bin agg_settlements -- \
--log-level "debug" agg-settlements \
--gmt-database-pg-conn "postgresql://gmt_dev:gmt_dev_user_password@gmt_db:5432/gmt" \
--boundary-guid "b1e3d79e-23b1-4170-9adf-15f3102dff3d"

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

    AggSettlements(RunAggSettlementsArgs),
    Export(ExportArgs)
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

        Command::AggSettlements(r) => {
            run_agg_settlements(r)?;
        }
        Command::Export(r) => {
            run_cmd_export(r)?;
        }
    }

    Ok(())
}

fn main() {
    run().unwrap();
}