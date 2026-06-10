//! GDAL Vector Data
//!


pub use crate::vector::dataset::Dataset;
pub use crate::vector::layer_definition::{LayerDefinition, };
pub use crate::vector::field::{Field, FieldIterator, FieldDefinition, GeomField, geometry_type_to_name, field_type_to_name};
pub use crate::vector::driver::Driver;
pub use crate::vector::feature::{Feature, FieldValue};
pub use crate::vector::geometry::{Geometry};
pub use crate::vector::layer::{FeatureIterator, Layer};
pub use crate::vector::ops::geometry::intersection::Intersection as GeometryIntersection;
pub use gdal_sys::{OGRFieldType, OGRFieldSubType, OGRwkbGeometryType, OGREnvelope};
pub use crate::vector::global_func::*;

//use crate::errors::Result;

mod dataset;
mod layer_definition;
mod driver;
mod feature;
mod geometry;
mod layer;
pub mod ops;
mod field;
mod global_func;

#[cfg(test)]
mod tests;
