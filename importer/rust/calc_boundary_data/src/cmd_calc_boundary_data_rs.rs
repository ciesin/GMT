use std::error::Error;
use std::path::PathBuf;
use std::time::Instant;
use geo_util::util::format_duration;

use anyhow::Result;
use bitvec::prelude::*;
use byteorder::{BigEndian, ReadBytesExt};
use bytes::{BufMut, BytesMut};
use itertools::Itertools;
use log::{debug};
use num::FromPrimitive;
use postgres::{Client, NoTls};
use postgres::types::{accepts, FromSql, IsNull, to_sql_checked, ToSql, Type};
use structopt::StructOpt;
use uuid::Uuid;

use gdal::spatial_ref::SpatialRef;
use geo_util::raster::{Raster, RasterStats};

use crate::boundary::{
    get_boundary_info,
    get_surrounding_boundaries,
    update_boundary,
    get_pop_raster_index
};
use crate::ci::create_ci_items;
use crate::hf::{create_hf_items, serialize_hf_info, update_invalid_hf_items};
use crate::sp::{create_sp_items, get_sp_catchment_data, get_sp_data};
use crate::weights::WeightConfig;

/*
This command line utility is run after every sync for 1 ward (boundary), it updates:

boundary.polygon fields (num_pop_squares, computed_pop, hf_guids, and hf_names)
partitions.health_facility_point fields for the partition table

raster_width, raster_height, origin_x, origin_y, catchment_raster

partitions.ri_catchment_items non excluded entries

partitions.settlement_part fields:
raster_width, raster_height, origin_x, origin_y,
raster, is_fixed_post, is_outreach

Design overview --

We have settlement names (sn), settlement parts (sp), health facilities (hf), and catchment items (ci)

each sp has 1 primary name

each sp is split into squares matching the pop. raster
each square is split between hf's

the final tallys are in ci rows which associate

1 sp, 1 hf, a %, type==generated

This is how the system knows the % pop covered by a particular hf for a particular sp

INCLUDE / EXCLUDE

the user can also create ci rows with these types.

Exclude means that we should not generate any entries for the sp/hf combo.
Include means that we should split the sp population among all hfs that explicitly include it

Note that while normally for each square, we calculate a weight based on frequency, distance, etc
for explicit includes this is an even split.  So 2 explicit included HFs get 50% of the settlement pop, 3 get 33%, etc.

This means we do NOT care about the pop % field for ci rows for include/exclude entries.

It is for this reason when we display pop % numbers, we only look at generated

See also
https://github.com/novelt/GMT/issues/2639
https://github.com/novelt/GMT/issues/1606#issuecomment-1346258182

 */

/*
cargo run --release --bin calc_boundary_data -- \
--log-level "debug" calc-boundary-data \
--gmt-database-pg-conn "postgresql://gmt_dev:gmt_dev_user_password@gmt_db:5432/gmt" \
--pop-raster "/data/rasters/input/pop_4326.tif" \
--boundary-guid "ffeabdaa-c205-4645-bcc4-318ebb198321"

 */

#[derive(StructOpt)]
pub struct CalcBoundaryDataArgs {


    //#[structopt(long)]
    //gmt_database_ogr_conn: String,

    #[structopt(long)]
    gmt_database_pg_conn: String,

    #[structopt(parse(from_os_str), long)]
    pop_raster: Vec<PathBuf>,

    #[structopt(long)]
    boundary_guid: Vec<Uuid>,

    #[structopt(long)]
    only_boundary: bool,

}

pub(crate) type DefBitVec = BitVec::<u8, Msb0>;

// This is just the metadata in boundary, see update_boundary
pub fn run_calc_boundary_data_only_boundary(args: &CalcBoundaryDataArgs) -> Result<()> {

    let now = Instant::now();

    let pop_rasters = args.pop_raster.iter().map(|pr| {
        Raster::read(pr, true)
    }).collect_vec();

    for boundary_global_id in args.boundary_guid.iter() {
        let mut client = Client::connect(&args.gmt_database_pg_conn, NoTls)?;

        let surrounding_boundaries_all = get_surrounding_boundaries(&mut client,
                                                            &args.boundary_guid).unwrap();

        let pop_raster_index = get_pop_raster_index(&mut client, boundary_global_id, &pop_rasters)?;


        let hf_info = serialize_hf_info(&mut client, &surrounding_boundaries_all, &pop_rasters[pop_raster_index].stats).unwrap();

        let mut transaction = client.transaction().unwrap();        
        let b_data = get_boundary_info(&mut transaction, boundary_global_id, &&pop_rasters[pop_raster_index], &hf_info)?;

        debug!("Update boundary table");
        update_boundary(&mut transaction, boundary_global_id, &b_data)?;

        transaction.commit().unwrap();
    }

    debug!("Finished in {}", format_duration(now.elapsed()));

    Ok(())
}

pub fn run_calc_boundary_data(args: &CalcBoundaryDataArgs) -> Result<()> {

    if args.only_boundary {
        return run_calc_boundary_data_only_boundary(args);
    }
    let now = Instant::now();

    let wc = WeightConfig::new();

    let mut read_client = Client::connect(&args.gmt_database_pg_conn, NoTls)?;
    let surrounding_boundaries_all = get_surrounding_boundaries(&mut read_client,
                                                            &args.boundary_guid).unwrap();

    let pop_rasters = args.pop_raster.iter().map(|pr| {
        Raster::read(pr, true)
    }).collect_vec();                                                                
    let pop_raster_index = get_pop_raster_index(&mut read_client, &args.boundary_guid[0],  &pop_rasters)?;
    let pop_raster  = &pop_rasters[pop_raster_index];
    let pop_stats = &pop_raster.stats;

    //Fetch health facility data from db, this includes the surrounding boundaries
    let hf_info = serialize_hf_info(&mut read_client, &surrounding_boundaries_all, pop_stats).unwrap();
    let vec_sp_info = get_sp_data(&mut read_client, pop_stats, &surrounding_boundaries_all)?;

    let sp_catchment_data = get_sp_catchment_data(
        &mut read_client, &pop_raster, pop_stats, vec_sp_info,
        &hf_info, &wc, &surrounding_boundaries_all).unwrap();

    read_client.close()?;



    for boundary_global_id in args.boundary_guid.iter() {

        let boundary_id = surrounding_boundaries_all.get_boundary_id(boundary_global_id);

        if boundary_id.is_none() {
            debug!("{} is either missing or not in the operating boundary level or has null/empty geometry", boundary_global_id);
            continue
        }

        let boundary_id = boundary_id.unwrap();

        let mut client = Client::connect(&args.gmt_database_pg_conn, NoTls)?;

        let mut transaction = client.transaction().unwrap();

        let b_data = get_boundary_info(&mut transaction, boundary_global_id, &pop_raster, &hf_info)?;

        debug!("Update boundary table");
        update_boundary(&mut transaction, boundary_global_id, &b_data)?;

        debug!("Creating ci items");
        create_ci_items(&mut transaction, &sp_catchment_data, &hf_info, boundary_id, boundary_global_id)?;

        debug!("Creating sp items");
        create_sp_items(&mut transaction, &sp_catchment_data, boundary_id)?;

        debug!("Clear fields for invalid hfs");
        update_invalid_hf_items(&mut transaction, boundary_id)?;

        debug!("Creating hf items");
        create_hf_items(&mut transaction, &sp_catchment_data, &hf_info, boundary_id, &pop_stats, boundary_global_id)?;

        transaction.commit().unwrap();
    }

    //danger this can cause issues if we are running multiple updates at a time
    //The update task is run with max CPU = 1, and we have yet to stress test
    //many users sync' ing at a time

    //Update this only once
    let mut client = Client::connect(&args.gmt_database_pg_conn, NoTls)?;

    client.execute(
        &format!("REFRESH MATERIALIZED VIEW boundary.polygon_latest"),
        &[]).unwrap();

    debug!("Finished in {}", format_duration(now.elapsed()));

    Ok(())
}


pub(crate) fn get_laea_spatial_ref(stats: &RasterStats) -> Result<SpatialRef> {
    let center_x = (stats.right_x_coord() + stats.origin_x) / 2.0;
    let center_y = (stats.origin_y + stats.bottom_y_coord()) / 2.0;

    let laea = SpatialRef::from_proj4(&format!(
        "+proj=laea +lat_0={} +lon_0={} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
        center_y, center_x
    ))?;

    Ok(laea)
}


//Be able to save bitvec types to sql
#[derive(Debug)]
pub(crate) struct BitVecWrapper(pub DefBitVec);

impl<'a> ToSql for BitVecWrapper {
    fn to_sql(&self, _: &Type, out: &mut BytesMut) -> Result<IsNull, Box<dyn Error + Sync + Send>> {
        let len = i32::from_usize(self.0.len()).unwrap();
        out.put_i32(len);

        for byte in self.0.as_raw_slice() {
            out.put_u8(*byte);
        }

        Ok(IsNull::No)
    }

    accepts!(BIT, VARBIT);
    to_sql_checked!();
}


impl<'a> FromSql<'a> for BitVecWrapper {
    fn from_sql(_: &Type, raw: &[u8]) -> Result<BitVecWrapper, Box<dyn Error + Sync + Send>> {
        let mut buf = raw;
        let len = buf.read_i32::<BigEndian>()? as usize;
        // if len < 0 {
        //     return Err("invalid varbit length: varbit < 0".into());
        // }
        let bytes = (len + 7) / 8;
        if buf.len() != bytes {
            return Err("invalid message length: varbit mismatch".into());
        }


        let mut bitvec = DefBitVec::from_slice(buf);
        while bitvec.len() > len {
            bitvec.pop();
        }

        Ok(BitVecWrapper(bitvec))
    }

    accepts!(BIT, VARBIT);
}
//fn copy_bit_varying()


#[cfg(test)]
mod test {
    use bitvec::prelude::*;

    #[test]
    fn test_bits() {
        let mut bv1 = BitVec::<_, Msb0>::from_element(240u8);
        let mut bv2 = BitVec::<_, Msb0>::from_element(240u8);
        //let mut bv3 = BitVec::<_, Msb0>::from_element(128u8);
        let mut bv3 = BitVec::<u8, Msb0>::new();
        bv3.push(true);

        let mut bv = BitVec::<u8, Msb0>::new();
        bv.append(&mut bv1);
        bv.append(&mut bv2);
        bv.append(&mut bv3);

        assert_eq!(bv.len(), 17);

        let raw_slice = bv.as_raw_slice();
        assert_eq!(3, raw_slice.len());
        assert_eq!(128u8, raw_slice[2]);
        //assert!(bv[7]);
    }
}

