#![crate_name = "geos"]
#![crate_type = "lib"]

extern crate c_vec;
#[cfg(any(feature = "geo", feature = "dox"))]
extern crate geo_types;
#[cfg(all(feature = "json"))]
extern crate geojson;
extern crate geos_sys;
extern crate libc;
extern crate anyhow;
extern crate num;
#[cfg(any(feature = "geo", feature = "dox"))]
extern crate wkt;

#[cfg(all(feature = "geo", test))]
#[macro_use]
extern crate doc_comment;

#[cfg(all(feature = "geo", test))]
doctest!("../README.md");

pub(crate) mod functions;


#[cfg(any(feature = "v3_6_0", feature = "dox"))]
pub use enums::Precision;
pub use enums::{
    ByteOrder, CoordDimensions, Dimensions, GeometryTypes, Ordinate, Orientation, OutputDimension,
};

pub use functions::{ version};
pub use simple_wkb_writer::WKBWriter;
pub use simple_wkb_reader::WKBReader;

//#[cfg(any(feature = "geo", feature = "dox"))]

//mod geometry;
//mod prepared_geometry;
//mod spatial_index;

mod enums;
mod simple_wkb_writer;
mod simple_wkb_reader;
mod prepared_geometry;

mod simple_context_handle;
mod simple_geometry;
mod simple_coordinate_sequence;
mod simple_string;

pub use simple_context_handle::*;
pub use simple_geometry::*;
pub use simple_coordinate_sequence::*;
pub use prepared_geometry::*;

//pub use traits::{ContextHandling, ContextInteractions};
//
// #[cfg(test)]
// mod geos_test;
