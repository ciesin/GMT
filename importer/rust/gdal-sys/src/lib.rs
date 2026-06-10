#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]

//include!(concat!(env!("OUT_DIR"), "/bindings.rs"));

mod gdal_3_3;
pub use gdal_3_3::*;

extern "C" {
    pub fn OGRGeometryToHexEWKB( poGeometry: OGRGeometryH, nSRSId: libc::c_int,
                                     nPostGISMajor: libc::c_int, nPostGISMinor: libc::c_int )
    -> *mut libc::c_char;

    //call CPLFree / VSIFree afterwards
    
    
}

impl OGREnvelope {
    pub fn width(&self) -> f64 {
        self.MaxX - self.MinX
    }
    pub fn height(&self) -> f64 {
        self.MaxY - self.MinY
    }
    pub fn center(&self) -> [f64; 2] {
        let center_x = self.MinX + (self.MaxX - self.MinX) / 2.0;
        let center_y = self.MinY + (self.MaxY - self.MinY) / 2.0;
        
        [center_x, center_y]
    }
}