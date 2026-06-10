use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use anyhow::Result;
use gdal::raster::global_func::get_type_name;
use gdal::spatial_ref::SpatialRef;
use gdal::vector::{Driver, FieldDefinition,
                   Geometry, Feature, OGRFieldType, OGRwkbGeometryType};
use glob::glob;
use structopt::StructOpt;

use geo_util::raster::Raster;
//use gdal::raster::{Dataset as RasterDataset, RasterBand};
use geo_util::util::{print_remaining_time, RasterChunkIterator};

#[derive(StructOpt)]
struct Cli {

    /// The path to the file to read
    #[structopt(parse(from_os_str))]
    input_tif: std::path::PathBuf,

    /// The path to the shapefile to write
    #[structopt(parse(from_os_str))]
    output_shapefile: std::path::PathBuf,
}

/// Converts a raster to a point layer
fn run() -> Result<()> {

    let now = Instant::now();
    let mut last_output = Instant::now();

    let args = Cli::from_args();

    //output to an unbound docker directory for speed
    let mut temp_path = PathBuf::from(r"/tmp/shapefile");
    temp_path.push(args.output_shapefile.file_name().unwrap());
    let target_shapefile_path =  temp_path.as_path();

    {
        let raster = Raster::read(&args.input_tif, true);

        println!("Type is {:?}", get_type_name(raster.band().band_type()));

        let drv = Driver::get("ESRI Shapefile")?;

        if target_shapefile_path.parent().unwrap().exists() {
            fs::remove_dir_all(target_shapefile_path.parent().unwrap()).unwrap();
        }
        fs::create_dir_all(target_shapefile_path.parent().unwrap()).unwrap();
        let ds = drv.create(target_shapefile_path.to_str().unwrap())?;

        let mut lyr = ds.create_layer_ext(
            target_shapefile_path.file_stem().unwrap().to_str().unwrap(),
            &SpatialRef::from_epsg(4326)?,
            OGRwkbGeometryType::wkbPoint,
            &[
                "SPATIAL_INDEX=YES",
                "RESIZE=YES"
            ]
        )?;

        let field_defn = FieldDefinition::new("raster_x", OGRFieldType::OFTInteger)?;
        field_defn.add_to_layer(&mut lyr)?;
        let field_defn = FieldDefinition::new("raster_y", OGRFieldType::OFTInteger)?;
        field_defn.add_to_layer(&mut lyr)?;
        let field_defn = FieldDefinition::new("population", OGRFieldType::OFTReal)?;
        field_defn.add_to_layer(&mut lyr)?;

        let defn = lyr.layer_definition();

        let step_size = 750;

        let field_index_raster_x = defn.get_field_index("raster_x")?;
        let field_index_raster_y = defn.get_field_index("raster_y")?;
        let field_index_population = defn.get_field_index("population")?;

        for raster_window in RasterChunkIterator::new(raster.stats.num_rows as i32, raster.stats.num_cols as i32, step_size)
        {
            let window_size = raster_window.window_size;
            let (start_x, stop_x) = raster_window.x_range_inclusive;
            let (start_y, stop_y) = raster_window.y_range_inclusive;

            assert_eq!(stop_x, start_x + window_size.0 - 1);
            assert_eq!(stop_y, start_y + window_size.1 - 1);

            if let Ok(rv) =
            raster.band().read_as_array::<f32>(raster_window.window_offset, window_size)
            {
                /*
            println!("\nIn thread {:?}\nx {} to {}\ny {} to {}\n",
                thread::current().id(),
                        start_x, stop_x,
                        start_y, stop_y);*/

                for x in start_x..=stop_x  {
                    for y in start_y..=stop_y  {
                        let val = rv.get(( (y - start_y) as usize, (x - start_x) as usize)).unwrap();

                        if !val.is_finite() {
                            continue;
                        }

                        //ignore any negative values
                        if *val < 1e-6 {
                            continue;
                        }

                        let x_coord = raster.stats.calc_x_coord(x) + raster.stats.pixel_width / 2.0;
                        let y_coord = raster.stats.calc_y_coord(y) + raster.stats.pixel_height / 2.0;

                        let mut ft = Feature::new(&defn)?;
                        //ft.set_geometry(Geometry::from_wkt(&format!("POINT ({} {})", x_coord, y_coord))?)?;

                        let pt = Geometry::from_x_y(x_coord, y_coord)?;
                        //pt.setX(x_coord);
                        ft.set_geometry_directly(pt)?;

                        ft.set_field_integer_by_index(field_index_raster_x, x as i32)?;
                        ft.set_field_integer_by_index(field_index_raster_y, y as i32)?;
                        ft.set_field_double_by_index(field_index_population, *val as f64)?;

                        // Add the feature to the layer:
                        ft.create(&lyr)?;
                    }
                }
            }


            if last_output.elapsed().as_secs() >= 3 {
                last_output = Instant::now();
                print_remaining_time(&now, raster_window.current_step as _, raster_window.num_steps as u32);
            }
        }


        //dataset goes out of scope, to flush the files
    }

    let mut glob_pat = PathBuf::from(target_shapefile_path.parent().unwrap());
    glob_pat.push("*.*");

    fs::create_dir_all(args.output_shapefile.parent().unwrap()).unwrap();

    for temp_path in glob(glob_pat.to_str().unwrap()).unwrap().filter_map(|e| e.ok()) {
        let mut target_path = PathBuf::from(args.output_shapefile.parent().unwrap());
        target_path.push(temp_path.file_name().unwrap());
        //let target_path = Path::from(target_path.as_path());

        println!("Copy {:?} to {:?}", temp_path, target_path.as_path());
        fs::copy(temp_path.as_path(), target_path.as_path()).unwrap();

        //let src_file_size = fs::metadata(temp_path.as_path()).unwrap().len();

        //let file_size = fs::metadata(target_path.as_path()).unwrap().len();

        //println!("File size of {:?} = {} {}", target_path.as_path(), file_size, src_file_size);
    }
    Ok(())

}

fn main() {
    run().unwrap();
}