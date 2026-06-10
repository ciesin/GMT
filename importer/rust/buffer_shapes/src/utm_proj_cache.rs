use gdal::spatial_ref::{SpatialRef, CoordTransform, OSRAxisMappingStrategy};
use std::fmt;
use num_traits::{Float, NumCast};
use std::collections::HashMap;

#[derive(Eq, PartialEq, Hash, Copy, Clone)]
pub struct UtmProj {
    zone: u8,
    is_north: bool
}

impl UtmProj {
    fn get_spatial_ref(&self) -> SpatialRef {

        let mut utm = SpatialRef::from_proj4(
            &format!("+proj=utm +zone={} +{} +ellps=WGS84 +datum=WGS84 +units=m +no_defs",
            self.zone, if self.is_north {"north"} else {"south"}
            )).unwrap();
        utm.auto_identify_epsg().unwrap();

        utm.set_axis_mapping_strategy(OSRAxisMappingStrategy::OAMS_TRADITIONAL_GIS_ORDER);

        //let code = utm.auth_code().unwrap();
        //println!("Spatial ref is EPSG {}", code);
        return utm;
    }

    pub fn find_utm<F: Float>(x_lon: F, y_lat: F) -> UtmProj {

        let zone_float: F = (x_lon + NumCast::from(180.0).unwrap()) / NumCast::from(6.0).unwrap();
        let utm_zone:i32 = zone_float.ceil().to_i32().unwrap();

        assert!(utm_zone > 0);

        UtmProj {
            zone: utm_zone as u8,
            is_north: y_lat > NumCast::from(0).unwrap()
        }

    }
}

impl fmt::Display for UtmProj {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Zone: {}, North? {})", self.zone, self.is_north)
    }
}

pub struct UtmTransformations {    
    pub(crate) transform_to_meters: CoordTransform,
    pub(crate) transform_to_source: CoordTransform
}

pub struct UtmCache {
    cache: HashMap<UtmProj, UtmTransformations>,
    source_sr: SpatialRef
}

impl UtmCache {
    pub fn get(&mut self, utm_proj: &UtmProj) -> &UtmTransformations {

        if self.cache.contains_key(utm_proj) {
            return self.cache.get(utm_proj).unwrap();
        }

        let sr_meters = utm_proj.get_spatial_ref();

        let transform_to_meters = CoordTransform::new(&self.source_sr, &sr_meters).unwrap();
        let transform_to_source = CoordTransform::new(&sr_meters, &self.source_sr).unwrap();

        let cv = UtmTransformations {            
            transform_to_meters,
            transform_to_source,
        };

        self.cache.insert(*utm_proj, cv);

        return self.cache.get(utm_proj).unwrap();
    }
    
    pub fn new(source_sr: SpatialRef) -> UtmCache {

        UtmCache {
            cache: Default::default(),
            source_sr
        }
    }
}