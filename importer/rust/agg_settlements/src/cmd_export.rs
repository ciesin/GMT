use anyhow::{Result};
use crossbeam::{bounded, Receiver, Sender};
use log::debug;
use postgres::{Client, NoTls};
//use itertools::Itertools;
use structopt::StructOpt;
use uuid::Uuid;
use gdal::config::set_config_option;
use gdal::spatial_ref::SpatialRef;

use gdal::vector::{Driver, Feature, FieldDefinition, Geometry, OGREnvelope, OGRwkbGeometryType};
use gdal::vector::OGRFieldType::{OFTReal, OFTString};
use crate::boundary::get_laea_spatial_ref;
use crate::sp::SettlementType;
use fallible_iterator::FallibleIterator;
use std::iter;

use std::convert::AsRef;
use std::path::Path;
/*

rm -f /data/agg_sp.fgb && \
cargo run --release --bin agg_settlements -- \
--log-level "debug" export \
--gmt-database-pg-conn "postgresql://gmt_dev:gmt_dev_user_password@gmt_db:5432/gmt" \
--out-ogr-layer "agg_sp" \
--out-ogr-conn "/data/agg_sp.fgb"

cargo run --release --bin agg_settlements -- \
--log-level "debug" export \
--gmt-database-pg-conn "postgresql://gmt_dev:gmt_dev_user_password@gmt_db:5432/gmt" \
--out-ogr-layer "agg_sp" \
--out-ogr-conn "PG:dbname='gmt' host='gmt_db' port='5432' user='gmt_dev' password='gmt_dev_user_password'" \
--out-driver PostgreSQL
 */
#[derive(StructOpt)]
pub struct ExportArgs {
    #[structopt(long)]
    gmt_database_pg_conn: String,

    #[structopt(long)]
    out_ogr_conn: String,

    #[structopt(long)]
    out_ogr_layer: String,

    #[structopt(long, help = "What is the output format")]
    out_driver: Option<String>,

}

struct ExportRow {
    sp_guid: Uuid,
    geometry_bytes: Vec<u8>,
    envelope: OGREnvelope,
    settlement_type: SettlementType
}

pub(crate) fn run_cmd_export(args: &ExportArgs) -> Result<()> {
    set_config_option(
        "PG_USE_COPY",
        "YES",
    )?;


    let (country_extent, all_ids) = {
      let mut client = Client::connect(&args.gmt_database_pg_conn, NoTls)?;

      let country_extent = get_country_extent_4326(&mut client)?;

      

      let all_ids = get_all_boundary_ids(&mut client)?;

      (country_extent, all_ids)
    };

    debug!("Fetched {} boundaries", all_ids.len());

    //Now we setup up the threads
    let n_workers = 4;

    //setup the channels
    //Producer => worker reciever
    let (producer_send, worker_recv) = bounded(5);

    //Workers, when done with the work, send the results to the final results container
    let (worker_send, results_recv) = bounded(5);

    //https://rust-lang-nursery.github.io/rust-cookbook/concurrency/threads.html#create-a-parallel-pipeline

    //let custom_utm_proj_ref = &custom_utm_proj;

    //send work to the worker threads, using particular raster coordinates
    //crossbean scope helps tell rust when we don't need the threads anymore, since afterwards all the unjoined threads will be joined
    crossbeam::scope(|s| {

        // Producer thread
        s.spawn( |_| {
            for boundary_id in all_ids.iter()
            {
                
                producer_send.send(*boundary_id).unwrap();
                //println!("Source sent {:?}", boundary_id);
            }
            // Close the channel - this is necessary to exit
            // the for-loop in the worker
            drop(producer_send);
        });

        //spin up the workers
        for _ in 0..n_workers {
            // Send to sink, receive from source
            let (sendr, recvr) = (worker_send.clone(), worker_recv.clone());
            //https://stackoverflow.com/questions/58459643/is-there-a-way-to-have-a-rust-closure-that-moves-only-some-variables-into-it
            //Need to do this in order to be able to use a move closure with readonly references
            //let affine = &affine;

            

            // Spawn workers in separate threads
            s.spawn( |_| {

                // Receive until channel closes

                let mut thread_client = Client::connect(&args.gmt_database_pg_conn, NoTls).unwrap();
                
                //sendr and recvr are moved, so will be dropped when this guy goes out of scope
                worker_export_settlements(
                    recvr, sendr, &country_extent, &mut thread_client,
                ).unwrap();
            });
        }
        // Close the channel, otherwise sink will never
        // exit the for-loop
        drop(worker_send);

        
        process_input_geometry(args, &country_extent, results_recv).unwrap();


        // This will panic if any of the spawned threads (which get joined) panic
    }).unwrap();

    Ok(())
}

fn process_input_geometry(
    args: &ExportArgs,// meters_proj: &SpatialRef,
    //total: usize,
    country_extent: &OGREnvelope,
    results_recv: Receiver<ExportRow>,
) -> Result<()> {

    let custom_utm_proj = get_laea_spatial_ref(&country_extent)?;
    
    //let now = Instant::now();

    //let mut last_output = Instant::now();


    let output_driver_name = args.out_driver.as_ref().map_or(
        Driver::DRIVER_NAME_FLATGEOBUF, |od| &od);
    let drv = Driver::get(output_driver_name)?;

    //let mut n_processed = 0;

    let ds = if output_driver_name == Driver::DRIVER_NAME_POSTGRESQL || Path::new(&args.out_ogr_conn).is_file() {
        drv.open(&args.out_ogr_conn, false)?
     } else {
         drv.create(&args.out_ogr_conn)?
     };

    let mut out_lyr = if !ds.layer_by_name(&args.out_ogr_layer).is_ok() {
        ds.create_layer_ext::<String>(
            &args.out_ogr_layer,
            &custom_utm_proj,
            OGRwkbGeometryType::wkbMultiPolygon,
            &vec![],
        )?
    } else {
        ds.layer_by_name(&args.out_ogr_layer)?
    };

    let field_defn = FieldDefinition::new("sp_guid", OFTString).unwrap();
    field_defn.add_to_layer(&mut out_lyr).unwrap();

    let field_defn = FieldDefinition::new("x_min", OFTReal).unwrap();
    field_defn.add_to_layer(&mut out_lyr).unwrap();
    let field_defn = FieldDefinition::new("x_max", OFTReal).unwrap();
    field_defn.add_to_layer(&mut out_lyr).unwrap();
    let field_defn = FieldDefinition::new("y_min", OFTReal).unwrap();
    field_defn.add_to_layer(&mut out_lyr).unwrap();
    let field_defn = FieldDefinition::new("y_max", OFTReal).unwrap();
    field_defn.add_to_layer(&mut out_lyr).unwrap();

    let field_defn = FieldDefinition::new("sett_type", OFTString).unwrap();
    field_defn.add_to_layer(&mut out_lyr).unwrap();

    let out_def = out_lyr.layer_definition();

    for export_row in results_recv.iter() {
        let mut out_ft = Feature::new(&out_def).unwrap();

        let mut gdal_geom = Geometry::empty(OGRwkbGeometryType::wkbMultiPolygon)?;

        // debug!("Importing bytes {}", buf.len());
        gdal_geom.import_ewkb_bytes_raw(&export_row.geometry_bytes).unwrap();

        out_ft.set_geometry_directly(gdal_geom)?;

        let envelope = &export_row.envelope;

        out_ft.set_field_string_by_index(0, &export_row.sp_guid.to_string())?;
        out_ft.set_field_double_by_index(1, envelope.MinX)?;
        out_ft.set_field_double_by_index(2, envelope.MaxX)?;
        out_ft.set_field_double_by_index(3, envelope.MinY)?;
        out_ft.set_field_double_by_index(4, envelope.MaxY)?;

        out_ft.set_field_string_by_index(5, &export_row.settlement_type.as_ref())?;
        // Copy fields over
        // for idx in 0..input_columns.len() {
        //     let input_field_value = feature.field_from_idx(idx as _)?;
        //     out_ft.set_field_by_index(idx as _, &input_field_value)?;
        // }

        // Add the feature to the layer:
        out_ft.create(&out_lyr)?;


    }

    Ok(())
}

///
/// Called in a thread, will loop on messages recieved in the channel
fn worker_export_settlements(
    //channel where this worker will get next block to process
    recvr: Receiver<i32>,
    //when completed, will send through a channel the number of buildings processed
    sendr: Sender<ExportRow>,
    country_extent: &OGREnvelope,
    client: &mut Client,
) -> Result<()> {
    let lat_lon = SpatialRef::from_epsg(4326)?;

    let custom_utm_proj = get_laea_spatial_ref(&country_extent)?;

    //Get next worker queue item to process
    for boundary_id in recvr.iter() {
        let mut sp_rows = client.query_raw::<_,bool,_>(&format!("
SELECT
    sp.global_id,
    ST_AsBinary( sp.geom, 'XDR'),
    type
FROM partitions_settlement_part.settlement_part_{boundary_id:0>5}_latest sp
WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)

    "), iter::empty() ).unwrap();

        //debug!("Fetched {} sp from db", sp_rows.len());

        //let mut guid_to_index = HashMap::with_capacity(sp_rows.len());


        //let meters_proj = get_laea_spatial_ref(&boundary_info.envelope)?;
        //let x_form = CoordTransform::new(&lat_lon, &meters_proj)?;

        while let Some(sp_row) = sp_rows.next()? {
        
            //Get a gdal geometry
            let sp_guid: Uuid = sp_row.get(0);
            let geom_bytes: Vec<u8> = sp_row.get(1);
            let settlement_type: SettlementType = sp_row.get(2);

            let mut gdal_geom = Geometry::empty(OGRwkbGeometryType::wkbMultiPolygon)?;

            // debug!("Importing bytes {}", buf.len());
            gdal_geom.import_ewkb_bytes_raw(&geom_bytes).unwrap();

            gdal_geom.set_spatial_reference(&lat_lon);

            gdal_geom.transform_to_inplace(&custom_utm_proj)?;

            //let gdal_proj = gdal_geom.transform_to(&meters_proj)?;
            let envelope = gdal_geom.envelope();

            let geometry_bytes = gdal_geom.ewkb_bytes_raw()?;

            sendr.send(ExportRow{envelope,
                sp_guid,
                geometry_bytes,
            settlement_type}).unwrap();
        }
    }

    Ok(())
}


pub(crate) fn get_country_extent_4326(
    client: &mut Client
) -> Result<OGREnvelope> {
    let boundary_query = format!("

SELECT ST_XMin(geom), ST_XMax(geom), ST_YMin(geom), ST_YMax(geom)
    FROM boundary.polygon_latest b
WHERE level = 0;
", );

    let results = client.query(&boundary_query, &[]).unwrap();

    assert_eq!(1, results.len());

    let boundary_row = &results[0];

    debug!("Retrieved country");

    #[allow(non_snake_case)]
    {
        let MinX = boundary_row.get(0);
        let MaxX = boundary_row.get(1);
        let MinY = boundary_row.get(2);
        let MaxY = boundary_row.get(3);
        Ok(OGREnvelope {
            MinX,
            MaxX,
            MinY,
            MaxY,
        })
    }
}

pub(crate) fn get_all_boundary_ids(
    client: &mut Client,
) -> Result<Vec<i32>> {
    let boundary_query = format!("

SELECT p.id
    FROM partitions.boundary_id p
INNER JOIN boundary.polygon_latest b on p.global_id = b.global_id
    WHERE b.level = 3
", );

    let results = client.query(&boundary_query, &[]).unwrap();

    assert!(results.len() > 9000);

    Ok(results.into_iter().map(|row| row.get::<_, i32>(0)).collect())
}