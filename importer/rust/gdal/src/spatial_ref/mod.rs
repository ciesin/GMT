pub use crate::spatial_ref::srs::CoordTransform;
pub use crate::spatial_ref::srs::SpatialRef;
pub use gdal_sys::OSRAxisMappingStrategy;

mod srs;

#[cfg(test)]
mod tests;
