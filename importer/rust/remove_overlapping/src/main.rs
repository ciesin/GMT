use std::time::Instant;

use anyhow::{Result};
use structopt::StructOpt;

use gdal::vector::{Dataset, Driver, OGRwkbGeometryType, Feature};
use geo_util::util::print_remaining_time;
use geo_util::convert::{convert_from_gdal_to_geos, convert_geos_to_gdal};

use geos::{SimpleGeometry, SimpleContextHandle, GeometryTypes};

use rstar::{RTree, AABB};

use crate::rtree_index_object::{RTreeIndexObject};
use geo_util::vector::{get_input_column_names, add_columns_to_layer};


/*

 */

mod rtree_index_object;

#[derive(StructOpt)]
struct Cli {


    #[structopt(long)]
    in_ogr_conn: String,

    #[structopt( long)]
    in_ogr_layer: String,

    #[structopt( long)]
    to_remove_ogr_conn: Vec<String>,

    #[structopt( long)]
    to_remove_layer: Vec<String>,

    #[structopt(long)]
    out_ogr_conn: String,

    //opens dataset instead of create
    #[structopt(long)]
    out_open: bool,

    #[structopt( long)]
    out_ogr_layer: String,

    #[structopt(long, help="What is the output format")]
    out_driver: Option<String>,


    #[structopt(long, short="b", default_value = "0.0000")]
    buffer_intersection: f64,
}


fn run() -> Result<()> {
    let args: Cli = Cli::from_args();

    let now = Instant::now();
    let mut last_output = Instant::now();

    //Open the input layer
    let in_dataset = Dataset::open(&args.in_ogr_conn)?;
    let in_layer = in_dataset.layer_by_name(&args.in_ogr_layer)?;

    let in_proj = in_layer.spatial_reference()?;

    //Gather some information about input layer
    let total = in_layer.count(false);

    let input_columns = get_input_column_names(&args.in_ogr_conn, &args.in_ogr_layer)?;

    let output_driver_name = args.out_driver.as_ref().map_or(
        Driver::DRIVER_NAME_FLATGEOBUF, |od| &od );
    let drv = Driver::get(output_driver_name)?;

    let mut n_processed = 0;

    let ds = if !args.out_open {
        drv.create(&args.out_ogr_conn)?
    } else {
        drv.open(&args.out_ogr_conn, false).unwrap()
    };

    let mut out_lyr = ds.create_layer_ext::<String>(
        &args.out_ogr_layer,
        &in_proj,
        OGRwkbGeometryType::wkbMultiPolygon,
        &vec![]
    )?;

    add_columns_to_layer(&mut out_lyr, &input_columns);

    let out_def = out_lyr.layer_definition();

    let context_handle = SimpleContextHandle::new();
    context_handle.add_message_handlers();

    let (rtree, to_remove_shapes) = read_to_remove(&args, &context_handle)?;

    println!("RTree size {}", rtree.size());

    assert_eq!(rtree.size(), to_remove_shapes.len());

    for feature in in_layer.features() {

        //println!("Feature {}", feature.fid());

        let mut shape = convert_from_gdal_to_geos(&feature.geometry().as_geom(),
                                                  &context_handle, false
            )?;

        let bbox = shape.envelope()?.bbox()?;
        let envelope_aabb = AABB::from_corners( [bbox[0], bbox[1]], [bbox[2], bbox[3]] );

        //Now check what intersects
        for inter in rtree.locate_in_envelope_intersecting( &envelope_aabb ) {
            let inter_shape = &to_remove_shapes[inter.fid as usize];

            let does_intersect = inter_shape.intersects(&shape)?;

            if !does_intersect {
                continue;
            }

            //println!("Intersection found!  {} with {}", feature.fid(), inter.fid);
            shape = shape.difference(&context_handle, inter_shape)?;

            //println!("Shape type {:?}", shape.geometry_type());

        }

        n_processed += 1;

        if shape.geometry_type() == GeometryTypes::Polygon {
            shape = shape.polygon_to_multipolygon(&context_handle)?;
        }

        assert!(shape.is_valid());

        let gdal_geom = convert_geos_to_gdal(&shape)?;

        let mut out_ft = Feature::new(&out_def)?;
        out_ft.set_geometry_directly(gdal_geom)?;

        // Copy fields over
        for idx in 0..input_columns.len() {
            let input_field_value = feature.field_from_idx(idx as _)?;
            out_ft.set_field_by_index(idx as _, &input_field_value)?;
        }

        // Add the feature to the layer:
        out_ft.create(&out_lyr)?;


        if last_output.elapsed().as_secs() >= 3 {
            last_output = Instant::now();
            print_remaining_time(&now, n_processed, total as _);
        }
    }


    Ok(())
}

//Build an rtree and the vec of GEOS shapes of the shapes we want to remove
fn read_to_remove<'d>(args: &Cli, context_handle: &'d SimpleContextHandle) ->
                                                                    Result< (RTree<RTreeIndexObject>, Vec<SimpleGeometry<'d>>) >
{

    let mut current_shapes = Vec::new();
    let mut rio_list = Vec::new();

    for to_remove_idx in 0..args.to_remove_ogr_conn.len() {
        let tr_dataset = Dataset::open(&args.to_remove_ogr_conn[to_remove_idx])?;
        let tr_layer = tr_dataset.layer_by_name(&args.to_remove_layer[to_remove_idx])?;

        for feature in tr_layer.features() {
            let mut shape = convert_from_gdal_to_geos(&feature.geometry().as_geom(),
                                                  &context_handle, false
            )?;

            let bbox = shape.envelope()?.bbox()?;
            let envelope_aabb = AABB::from_corners( [bbox[0], bbox[1]], [bbox[2], bbox[3]] );

            if args.buffer_intersection > 0.0 {
                shape = shape.buffer(&context_handle, args.buffer_intersection, 4)?;
            }

            let rio = RTreeIndexObject {
                fid: current_shapes.len() as u32,
                envelope: envelope_aabb
            };
            rio_list.push(rio);
            current_shapes.push(shape);
        }

    }

    let rtree: RTree<RTreeIndexObject>  = RTree::bulk_load(rio_list);

    Ok((rtree, current_shapes))
}

fn main() {
    run().unwrap()
}
