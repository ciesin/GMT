use geo::MultiPolygon;
use geo::algorithm::chamberlain_duquette_area::ChamberlainDuquetteArea;

pub fn get_multi_poly_area(polygon: &MultiPolygon<f64>) -> f64 {
    let mut area = 0f64;

    for polygon in polygon.0.iter() {
        area += polygon.chamberlain_duquette_unsigned_area();
    }

    area
}