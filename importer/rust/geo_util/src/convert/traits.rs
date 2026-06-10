use geo::Geometry;
use gdal::vector::{Geometry as GdalGeometry};
use anyhow::Result;

pub trait ToRustGeo
{
    fn to_rust_geo(&self) -> Geometry<f64>;
}

pub trait ToGdal
{
    fn to_gdal(&self) -> Result<GdalGeometry>;
}