use glob::glob;
use anyhow::{Result, bail};
use geo_util::raster::{Raster, create_empty_raster_with_options};
use std::cmp::max;
use std::path::PathBuf;
use std::fs::remove_file;
use structopt::StructOpt;
use byteorder::{ByteOrder, LittleEndian};
use gdal::raster::types::GdalType;
use geo_util::util::{print_remaining_time, RasterChunkIterator};
use std::time::Instant;

/// Merges rasters together.  First one wins, no data is overwritten by other raster values
/// Used to join https://data.humdata.org/dataset/highresolutionpopulationdensitymaps

#[derive(StructOpt)]
struct Cli {

    #[structopt(parse(from_os_str), long="in-dir", help="raster directory to merge")]
    input_raster_dir: PathBuf,

    #[structopt(parse(from_os_str), long="out", help="output")]
    output_path: PathBuf,

    #[structopt(long)]
    clean: bool,
}

fn run(args: &Cli) -> Result<()> {


    //https://maurow.bitbucket.io/notes/packbits-geotiffs.html
    //As we expect this to be a sparse dataset
    let bytes = [0xEE, 0xEE, 0xEE, 0xEE, 0xEE, 0xEE, 0xEE, 0xEE];
    let neg_no_data = LittleEndian::read_f64(&bytes);

    assert!(neg_no_data < 0.);

    let raster_dir_str = args.input_raster_dir.to_str().unwrap();
    //let raster_dir = PathBuf::from(&raster_dir_str);

    let mut rasters = Vec::new();

    for entry in glob(&format!("{}/*.tif", raster_dir_str))?.filter_map(|gr| gr.ok())
    {
        let r = Raster::read(&entry, true);

        rasters.push(r);
    }

    //First determine that all rasters 'snap'
    for (idx1, r1) in rasters.iter().enumerate() {
        for r2 in rasters.iter().skip(1 + idx1) {
            if !r1.stats.is_aligned(&r2.stats) || !r2.stats.is_aligned(&r1.stats) {
                bail!("Alignment problem between {:?} and {:?}", r1.path, r2.path);
            }
        }
    }

    //Next determine stats for superset of all stats
    let mut combined_raster_stats = rasters[0].stats.clone();

    for r in rasters.iter().skip(1 ) {

        let combined_right_coord = combined_raster_stats.right_x_coord();
        let combined_bottom_coord = combined_raster_stats.bottom_y_coord();

        //min
        if r.stats.origin_x < combined_raster_stats.origin_x {
            combined_raster_stats.origin_x = r.stats.origin_x;
        }
        if r.stats.origin_y > combined_raster_stats.origin_y {
            combined_raster_stats.origin_y = r.stats.origin_y;
        }

        //Since everything is aligned, we can add like 10% of the width and not change the answer,
        //and because calc_x floors
        let right_column = combined_raster_stats.calc_x(
            float_max(r.stats.right_x_coord(),
            combined_right_coord) + 0.1 * combined_raster_stats.pixel_width
        );
        assert!(right_column >= 0);

        let bottom_row = combined_raster_stats.calc_y(
            float_min(r.stats.bottom_y_coord(),
            combined_bottom_coord) + 0.1 * combined_raster_stats.pixel_height
        );
        assert!(bottom_row >= 0);

        combined_raster_stats.num_cols = max(combined_raster_stats.num_cols, right_column as u32);
        combined_raster_stats.num_rows = max(combined_raster_stats.num_rows, bottom_row as u32);
    }

    combined_raster_stats.no_data_value = neg_no_data;
    combined_raster_stats.gdal_type = f64::gdal_type();

    println!("Combined stats: {}", combined_raster_stats);

    if args.output_path.exists() && args.clean {
        remove_file( &args.output_path )?;
    }

    if args.output_path.exists() {
        println!("Output exists already");
        return Ok(());
    }

    create_empty_raster_with_options(
        &args.output_path, &combined_raster_stats, false,
        &[
            "TILED=YES",
            "BLOCKXSIZE=1024",
            "BLOCKYSIZE=1024",
            "COMPRESS=LZW",
            "BIGTIFF=YES",
            "SPARSE_OK=YES",
        ]
    )?;

    let output_raster = Raster::read(&args.output_path,
                                         false);

    //prepare one chunk at a time
    let output_band = output_raster.band();

    for input_raster in rasters.iter() {
        let offsets = output_raster.stats.common_offsets(&input_raster.stats);
        println!("For Raster {:?}\nOffsets: {:?}",
         &input_raster.path, &offsets);

        //Because input raster should be 100% contained, we check a few things
        assert_eq!(offsets.offset_x_2, 0);
        assert_eq!(offsets.offset_y_2, 0);
        assert_eq!(offsets.num_rows, input_raster.stats.num_rows);
        assert_eq!(offsets.num_cols, input_raster.stats.num_cols);

        let input_band = input_raster.band();

        let chunk_size = 512;

        let now = Instant::now();
        let mut last_output = Instant::now();

        for raster_window in RasterChunkIterator::new(offsets.num_rows as i32, offsets.num_cols as _, chunk_size as i32)
        {

            let window_size = raster_window.window_size;
            let start_x=raster_window.window_offset.0;
            let start_y=raster_window.window_offset.1;

            let input_data =
                input_band.read_as::<f64, i32>((start_x, start_y), (window_size.0, window_size.1))?;

            let mut output_data = output_band.read_as::<f64, i32>(
                    (start_x + offsets.offset_x_1 ,
                     start_y + offsets.offset_y_1 ), (window_size.0, window_size.1))?;

            assert_eq!(input_data.len(), output_data.len());

            let mut at_least_one_write = false;

            for i in 0..input_data.len() {
                let is_input_no_data = input_raster.stats.is_nodata(input_data[i]);

                //For no data do nothing
                if is_input_no_data {
                    continue;
                }

                //could also do the == check since we created this raster
                let is_output_no_data = output_raster.stats.is_nodata(output_data[i]);

                //Don't overwrite non no data values
                if !is_output_no_data {
                    continue;
                }

                assert_eq!(neg_no_data, output_data[i]);

                at_least_one_write = true;
                output_data[i] = input_data[i];
            }

            if at_least_one_write {
                output_band.write(
                    (start_x + offsets.offset_x_1 ,
                     start_y + offsets.offset_y_1 ), (window_size.0, window_size.1),
                    &output_data
                )?;
            }

            if last_output.elapsed().as_secs() >= 3 {
                last_output = Instant::now();

                print_remaining_time(&now, raster_window.current_step as _, raster_window.num_steps as _);
            }
        }
    }


    Ok(())
}

fn float_max(f1: f64, f2: f64) -> f64 {
    if f1 > f2 {
        return f1;
    }
    return f2;
}
fn float_min(f1: f64, f2: f64) -> f64 {
    if f1 < f2 {
        return f1;
    }
    return f2;
}

fn main() {
    let args = Cli::from_args();
    run(&args).unwrap();
}


#[cfg(test)]
mod raster_merge_test {
    use super::*;
    use gdal::spatial_ref::SpatialRef;
    use gdal::raster::types::GdalType;
    use geo_util::raster::{RasterStats, get_temp_filename, create_test_raster_with_path};
    use std::fs::{create_dir_all};
    use float_cmp::{ApproxEq, F64Margin, F32Margin};
    use num::traits::float::FloatCore;
    use geo_util::io::get_sub_dir;


    #[test]
    fn test_merge_mosiac() {
        let srs = SpatialRef::from_epsg(4326).unwrap();

        let origin_y = 46.242485;
        let origin_x = 6.021557;

        /*
        3 rasters overlap like so

        1122.
        1112.
        1.1..
        ..333

        Code should merge the 3 overlapping rasters, prioritizing squares with data
         */

        let raster1_stats = RasterStats {
            origin_y,
            origin_x,
            pixel_height: -0.005,
            pixel_width: 0.004,
            num_rows: 3,
            num_cols: 3,
            no_data_value: -1000.0,
            gdal_type: f32::gdal_type(),
            projection: srs.to_wkt().unwrap()
        };

        let mut raster2_stats = raster1_stats.clone();
        raster2_stats.no_data_value = 1e14;
        raster2_stats.origin_x = raster1_stats.origin_x + 2. * raster1_stats.pixel_width;
        raster2_stats.num_rows = 2;
        raster2_stats.num_cols = 2;

        let mut raster3_stats = raster1_stats.clone();
        raster3_stats.no_data_value = -1e15;
        raster3_stats.origin_x = raster1_stats.origin_x + 2. * raster1_stats.pixel_width;
        raster3_stats.origin_y = raster1_stats.origin_y + 2. * raster1_stats.pixel_height;
        raster3_stats.num_rows = 2;
        raster3_stats.num_cols = 3;

        let raster1_data = vec![
            1., 2., raster1_stats.no_data_value as f32,
            4., 5., 6.,
            7., raster1_stats.no_data_value as f32, 9.
        ];
        let raster2_data = vec![
            -1., -2.,
            raster2_stats.no_data_value as f32, -4.
        ];
        let raster3_data = vec![
            raster3_stats.no_data_value as f32, raster3_stats.no_data_value as f32, raster3_stats.no_data_value as f32,
            10., 11., 12.
        ];

        let raster_dir = {
            let dummy_path = get_temp_filename("dummy.tif");
            dummy_path.parent().unwrap().to_path_buf()
        };

        assert!(!raster_dir.exists());

        let _raster1_path = create_test_raster_with_path(&get_sub_dir(&raster_dir, "raster1.tif"), &raster1_stats, &raster1_data).unwrap();
        let _raster2_path = create_test_raster_with_path(&get_sub_dir(&raster_dir,"raster2.tif"), &raster2_stats, &raster2_data).unwrap();
        let _raster3_path = create_test_raster_with_path(&get_sub_dir(&raster_dir,"raster3.tif"), &raster3_stats, &raster3_data).unwrap();

        let output_path = get_sub_dir(&raster_dir, "combined.tif");

        assert!(!output_path.exists());

        create_dir_all(&output_path.parent().unwrap()).unwrap();

        let args = Cli {
            input_raster_dir: raster_dir.to_path_buf(),
            output_path: output_path.clone(),
            clean: false
        };
        run(&args).unwrap();

        assert!(output_path.exists());

        let output_raster = Raster::read(&output_path, true);

        assert_eq!(4, output_raster.stats.num_rows);
        assert_eq!(5, output_raster.stats.num_cols);

        let margin = F64Margin{ epsilon:  10. * f64::epsilon(), ulps: 3 };
        assert!(output_raster.stats.origin_x
        .approx_eq(raster1_stats.origin_x, margin));
        assert!(output_raster.stats.origin_y
        .approx_eq(raster1_stats.origin_y, margin));
        assert!(output_raster.stats.pixel_height
        .approx_eq(raster1_stats.pixel_height, margin));
        assert!(output_raster.stats.pixel_width
        .approx_eq(raster1_stats.pixel_width, margin));

        let data: Vec<f32> = output_raster.band().read_as((0,0), (5,4)).unwrap();

        let margin = F32Margin{ epsilon:  10. * f32::epsilon(), ulps: 3 };

        println!("Output raster stats: {}", output_raster.stats);

        //first row
        let offset=0;
        println!( "{:?}", &data[offset..offset+5]);
        assert!(data[0].approx_eq(raster1_data[0], margin));
        assert!(data[1].approx_eq(raster1_data[1], margin));
        assert!(data[2].approx_eq(raster2_data[0], margin));
        assert!(data[3].approx_eq(raster2_data[1], margin));
        assert!(data[4].approx_eq(output_raster.stats.no_data_value as f32, margin));

        let offset = 5;
        println!( "{:?}", &data[offset..offset+5]);
        assert!(data[0+offset].approx_eq(raster1_data[3], margin));
        assert!(data[1+offset].approx_eq(raster1_data[4], margin));
        assert!(data[2+offset].approx_eq(raster1_data[5], margin));
        assert!(data[3+offset].approx_eq(raster2_data[3], margin));
        assert!(data[4+offset].approx_eq(output_raster.stats.no_data_value as f32, margin));


        let offset = 10;
        println!( "{:?}", &data[offset..offset+5]);
        assert!(data[0+offset].approx_eq(raster1_data[6], margin));
        assert!(data[1+offset].approx_eq(output_raster.stats.no_data_value as f32, margin));
        assert!(data[2+offset].approx_eq(raster1_data[8], margin));
        assert!(data[3+offset].approx_eq(output_raster.stats.no_data_value as f32, margin));
        assert!(data[4+offset].approx_eq(output_raster.stats.no_data_value as f32, margin));


        let offset = 15;
        println!( "{:?}", &data[offset..offset+5]);
        assert!(data[0+offset].approx_eq(output_raster.stats.no_data_value as f32, margin));
        assert!(data[1+offset].approx_eq(output_raster.stats.no_data_value as f32, margin));
        assert!(data[2+offset].approx_eq(raster3_data[3], margin));
        assert!(data[3+offset].approx_eq(raster3_data[4], margin));
        assert!(data[4+offset].approx_eq(raster3_data[5], margin));
    }
}