use crate::raster::{Raster, create_empty_raster, RasterStats};
use gdal::raster::types::GdalType;
use std::path::{PathBuf, Path};
use anyhow::Result;
use uuid::Uuid;

pub fn get_temp_filename(file_name: &str) -> PathBuf {
    ["/modules/temp", &Uuid::new_v4().to_string(), file_name].iter().collect()
}


pub fn create_test_raster<T:Copy + GdalType>(in_file_name: &str, input_raster_stats: &RasterStats, input_raster_data: &Vec<T>) -> Result<PathBuf> {
    create_test_raster_with_path(
        &get_temp_filename(in_file_name),
            input_raster_stats, input_raster_data)
}

pub fn create_test_raster_with_path<T:Copy + GdalType>(input_path: &Path, input_raster_stats: &RasterStats, input_raster_data: &Vec<T>) -> Result<PathBuf> {

    assert!(!input_path.exists());

    create_empty_raster(&input_path, input_raster_stats, false).unwrap();

    assert!(input_path.exists());

    {
        let input_raster = Raster::read(&input_path, false);

        let input_raster_band = input_raster.dataset.rasterband(1)?;

        let num_rows = input_raster_stats.num_rows;
        let num_cols = input_raster_stats.num_cols;

        input_raster_band.write((0, 0), (num_cols as i32, num_rows as i32),
                                &input_raster_data).unwrap();
    }

    Ok(input_path.to_path_buf())
}