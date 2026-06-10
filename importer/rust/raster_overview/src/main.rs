use structopt::StructOpt;
use geo_util::util::{print_remaining_time, RasterChunkIterator};
use geo_util::raster::{Raster, is_nodata, create_empty_raster};
use std::fs::{remove_file, create_dir_all};
use gdal::raster::types::GdalType;
//use gdal::spatial_ref::SpatialRef;
use anyhow::Result;
use std::path::PathBuf;
use std::cmp::{max,};
use num_integer::Integer;
use std::time::Instant;
use geo_util::io::get_sub_dir;

/// Creates manual raster overviews (each level has half the rows & cols, similiar to how 3857 works
///

#[derive(StructOpt)]
struct Cli {

    /// The path to the file to read
    #[structopt(parse(from_os_str), long="input")]
    input_tif: PathBuf,

    #[structopt(parse(from_os_str), long)]
    output_path: Option<PathBuf>,

    #[structopt(long="clean")]
    clean_output: bool,

    #[structopt(subcommand)]  // Note that we mark a field as a subcommand
    combine_operator: Command
}

#[derive(StructOpt, Clone, Copy)]
enum Command {
    Add,
    Min,
    Max
}

fn run() -> Result<()> {
    let args: Cli = Cli::from_args();

    println!("Starting");

    let input_raster = Raster::read(&args.input_tif, true);
    let output_path = args.output_path.unwrap_or(
        args.input_tif.parent().unwrap().to_path_buf()
    );

    if !output_path.exists() {
        create_dir_all(&output_path)?;
    }

    println!("Output path: {:?}", output_path);

    assert!( output_path.exists() );

    println!("Using input raster: {:?} with stats {}", input_raster.path, input_raster.stats);

    let max_level = max(
        (input_raster.stats.num_rows as f64).log2().ceil() as u8,
        (input_raster.stats.num_cols as f64).log2().ceil() as u8,
    );

    println!("Max level is {}", max_level);

    let base_name = args.input_tif.file_stem().unwrap().to_str().unwrap();
    let first_level = get_sub_dir(&output_path,
        format!("{}_01.tif",
        base_name)
    );

    create_overview(&args.input_tif, &first_level, args.clean_output, args.combine_operator)?;

    for level in 2..=max_level
    {
        let input_level =  get_sub_dir(&output_path,
            format!("{}_{:0>2}.tif",
            base_name, level-1)
        );
        let output_level =  get_sub_dir(&output_path,
            format!("{}_{:0>2}.tif",
            base_name, level)
        );
        create_overview(&input_level, &output_level, args.clean_output, args.combine_operator)?;
    }

    Ok(())

}

fn create_overview(input_tif: &PathBuf, output_tif: &PathBuf, clean_output: bool, command: Command) -> Result<()> {

    let mut last_output = Instant::now();
    let now  = Instant::now();

    let input_raster = Raster::read(input_tif, true);

    println!("Using input raster: {:?} with stats {}", input_raster.path, input_raster.stats);

    if output_tif.is_file() {
        if clean_output {
            remove_file(output_tif)?;
        } else {
            println!("{:?} exists already and --clean is not specified", output_tif);
            return Ok(());
        }
    }

    assert!(!output_tif.is_file());

    let mut output_stats = input_raster.stats.clone();
    output_stats.num_rows = Integer::div_ceil(&input_raster.stats.num_rows, &2);
    output_stats.num_cols = Integer::div_ceil(&input_raster.stats.num_cols, &2);

    println!("Going to create overview with raster size: {} rows, {} columns",
        output_stats.num_rows, output_stats.num_cols
    );

    let datatype = input_raster.dataset.band_type(1)?;

    //For now only f32 is supported
    assert_eq!(datatype, f32::gdal_type());

    //Create the raster with appropriate projection, no data value, datatype, etc.

    output_stats.pixel_height *= 2.0;
    output_stats.pixel_width *= 2.0;

    create_empty_raster(output_tif, &output_stats, true)?;

    assert!(output_tif.is_file());

    let output_raster = Raster::read(output_tif, false);

    let input_raster_band = input_raster.band();
    let output_raster_band = output_raster.band();

    let no_data_val = input_raster.stats.no_data_value as f32;

    for raster_window in RasterChunkIterator::new(input_raster.stats.num_rows as i32, input_raster.stats.num_cols as i32, 128)
    {
        let input_window_size = raster_window.window_size;
        let (start_x, _stop_x) = raster_window.x_range_inclusive;
        let (start_y, _stop_y) = raster_window.y_range_inclusive;

        let input_data =
            //raster.band().read_as_array::<f32>(((start_x + offsets.offset_x_2 as usize) as isize, (start_y + offsets.offset_y_2 as usize) as isize), window_size, window_size),
            input_raster_band.read_as::<f32, i32>(
                (start_x as i32 ,
                 start_y as i32 ),
                input_window_size, ).unwrap();

        let output_window_size = (Integer::div_ceil(&input_window_size.0, &2), Integer::div_ceil(&input_window_size.1, &2));

        let mut output_data_vec = vec![0f32; (output_window_size.0 * output_window_size.1) as usize];

        for input_x in (0..input_window_size.0).step_by(2)
        {
            for input_y in (0..input_window_size.1).step_by(2)
            {
                let output_y = input_y / 2;
                let output_x = input_x /2;

                let mut input_indexes  = vec![input_y * input_window_size.0 + input_x];

                if input_x + 1 < input_window_size.0 {
                    input_indexes.push(input_indexes[0] + 1);
                    if input_y + 1 < input_window_size.1 {
                        input_indexes.push(input_indexes[0] + input_window_size.0 + 1 );
                    }
                }
                if input_y + 1 < input_window_size.1 {
                    input_indexes.push(input_indexes[0] + input_window_size.0);
                }

                let mut output_value = no_data_val;

                for ii in input_indexes
                {

                    if ii as usize >= input_data.len() {
                        continue;
                    }

                    let v = input_data[ii as usize];
                    let is_nd = is_nodata(v, no_data_val);

                    if is_nd {
                        continue;
                    }

                    if output_value == no_data_val {
                        output_value = v;
                    } else {
                        output_value = match command {
                            Command::Add => {
                                output_value + v
                            },
                            Command::Max => {
                                if v > output_value {
                                    v
                                }  else {
                                    output_value
                                }
                            },
                            Command::Min => {
                                if v < output_value {
                                    v
                                }  else {
                                    output_value
                                }
                            }
                        };
                    }
                }

                let output_index = output_y * output_window_size.0 + output_x;

                output_data_vec[output_index as usize] = output_value;
            }
        }

        output_raster_band.write(
            raster_window.window_offset,
             output_window_size, &output_data_vec)?;

        if last_output.elapsed().as_secs() >= 2 {
            last_output = Instant::now();
            print_remaining_time(&now, raster_window.current_step as _, raster_window.num_steps as _);
        }

    }

    Ok(())
}



fn main() {
    run().unwrap();
}