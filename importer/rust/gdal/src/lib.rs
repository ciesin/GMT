//! [GDAL](http://gdal.org/) bindings for Rust.
//!
//! A high-level API to access the GDAL library, for vector and raster data.
//!


pub use version::version_info;

pub mod config;
pub mod errors;
mod gdal_major_object;
pub mod metadata;
pub mod raster;
pub mod spatial_ref;
mod utils;
pub mod vector;
pub mod version;


#[cfg(test)]
fn assert_almost_eq(a: f64, b: f64) {
    let f: f64 = a / b;
    assert!(f < 1.00001);
    assert!(f > 0.99999);
}
