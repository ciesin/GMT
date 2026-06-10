use std::time::Instant;
use geo_util::util::format_duration;

use anyhow::Result;
use log::{debug};
use postgres::{Client, NoTls};
use structopt::StructOpt;
use uuid::Uuid;
use crate::boundary::get_boundary;
use crate::sn::serialize_sn_info;
use crate::sp::{merge_unamed, insert_merged_settlements_hard_delete, serialize_sp_info, temp_cleanup};

/*
cargo run --release --bin agg_settlements -- \
--log-level "debug" agg-settlements \
--gmt-database-pg-conn "postgresql://gmt_dev:gmt_dev_user_password@gmt_db:5432/gmt" \
--boundary-guid "5500c971-ec77-4358-878e-86a1b30bb51d"
 */


#[derive(StructOpt)]
pub struct RunAggSettlementsArgs {

    #[structopt(long)]
    gmt_database_pg_conn: String,

    #[structopt(long)]
    boundary_guid: Vec<Uuid>,


}





pub fn run_agg_settlements(args: &RunAggSettlementsArgs) -> Result<()> {

    let now = Instant::now();

    for boundary_global_id in args.boundary_guid.iter() {
        let mut client = Client::connect(&args.gmt_database_pg_conn, NoTls)?;

        let mut transaction = client.transaction().unwrap();

        let boundary = get_boundary(&mut transaction, &boundary_global_id)?;

        //NOTE !!  This has a hardcoded version id in there
        // temp_cleanup( &mut transaction, boundary.boundary_id);

        debug!("sn info");

        let sn_info = serialize_sn_info(&mut transaction, &boundary)?;

        debug!("sp info");

        let sp_info = serialize_sp_info(&mut transaction, &boundary, &sn_info)?;

        let merge_data = merge_unamed(&sp_info)?;

        //insert_merged_settlements(&mut transaction, &sp_info, boundary.boundary_id, &merge_data)?;

        insert_merged_settlements_hard_delete(&mut transaction, &sp_info, boundary.boundary_id, &merge_data)?;


        // debug!("Update boundary table");
        // update_boundary(&mut transaction, boundary_global_id, &b_data)?;
        //
        transaction.commit().unwrap();
    }

    debug!("Finished in {}", format_duration(now.elapsed()));

    Ok(())
}



#[cfg(test)]
mod test {

}

