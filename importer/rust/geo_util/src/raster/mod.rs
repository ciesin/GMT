use std::path::{PathBuf, Path};
use gdal::raster::{Dataset, RasterBand};

mod raster_stats;
mod raster_resample;
mod burn_polygon;
mod algo;
pub mod combine_rasters;

//#[cfg(test)]
mod test_util;

pub use raster_stats::*;
pub use burn_polygon::*;
pub use algo::*;
pub use raster_resample::*;
pub use combine_rasters::*;
//#[cfg(test)]
pub use test_util::*;


pub struct Raster
{
    pub path: PathBuf,
    pub stats: RasterStats,
    pub dataset: Dataset,
}

impl Raster {
    pub fn read(path: &Path, readonly: bool) -> Raster {
        //println!("Reading raster at path {:?}", path);

        let dataset = Dataset::open(path, readonly).unwrap();

        let band: RasterBand = dataset.rasterband(1).unwrap();

        let stats = RasterStats::new(&dataset, &band);

        Raster {
            path: path.to_path_buf(),
            stats,
            dataset,
        }
    }

    pub fn band(&self) -> RasterBand {
        self.dataset.rasterband(1).unwrap()
    }
}
