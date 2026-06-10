use gdal::vector::{Geometry as GdalGeometry, OGRwkbGeometryType};
use geo::{Point, Geometry, Coordinate, MultiPoint, MultiLineString, LineString, GeometryCollection, MultiPolygon, Polygon};
use crate::convert::traits::ToRustGeo;
use itertools::Itertools;

//if we want to consume geo then ok
impl ToRustGeo for GdalGeometry {

    fn to_rust_geo(&self) -> Geometry<f64> {
        let geo = self;
        let geometry_type = geo.geometry_type();

        let ring = |n: usize| {
            let ring = geo.get_geometry(n);
            match (&ring).to_rust_geo() {
                Geometry::LineString(r) => r,
                _ => panic!("Expected to get a LineString"),
            }
        };

        match geometry_type {
            OGRwkbGeometryType::wkbPoint => {
                let [x, y] = geo.get_point(0);
                Geometry::Point(Point(Coordinate { x, y }))
            }
            OGRwkbGeometryType::wkbMultiPoint => {
                let point_count = geo.geometry_count();
                let coords = (0..point_count)
                    .map(|n| match geo.get_geometry(n).to_rust_geo() {
                        Geometry::Point(p) => p,
                        _ => panic!("Expected to get a Point"),
                    })
                    .collect();
                Geometry::MultiPoint(MultiPoint(coords))
            }
            OGRwkbGeometryType::wkbLineString => {
                //look into using G
                let num_points = geo.point_count() as i32;
                let coords = (0..num_points).map( |p| {
                    let [x,y] = geo.get_point(p);
                    Coordinate{x, y}
                }).collect_vec();
                /*let coords = geo
                    .get_point_vec()
                    .iter()
                    .map(|&(x, y, _)| Coordinate { x, y })
                    .collect();*/
                Geometry::LineString(LineString(coords))
            }
            OGRwkbGeometryType::wkbMultiLineString => {
                let string_count = geo.geometry_count();
                let strings = (0..string_count)
                    .map(|n| match geo.get_geometry(n).to_rust_geo() {
                        Geometry::LineString(s) => s,
                        _ => panic!("Expected to get a LineString"),
                    })
                    .collect();
                Geometry::MultiLineString(MultiLineString(strings))
            }
            OGRwkbGeometryType::wkbPolygon => {
                let ring_count = geo.geometry_count();
                let outer = ring(0);
                let holes = (1..ring_count).map(ring).collect();
                Geometry::Polygon(Polygon::new(outer, holes))
            }
            OGRwkbGeometryType::wkbMultiPolygon => {
                let string_count = geo.geometry_count();
                let strings = (0..string_count)
                    .map(|n| match geo.get_geometry(n).to_rust_geo() {
                        Geometry::Polygon(s) => s,
                        _ => panic!("Expected to get a Polygon"),
                    })
                    .collect();
                Geometry::MultiPolygon(MultiPolygon(strings))
            }
            OGRwkbGeometryType::wkbGeometryCollection => {
                let item_count = geo.geometry_count();
                let geometry_list = (0..item_count)
                    .map(|n| geo.get_geometry(n).to_rust_geo())
                    .collect();
                Geometry::GeometryCollection(GeometryCollection(
                    geometry_list,
                ))
            }
            _ => panic!("Unknown geometry type"),
        }
    }
}

