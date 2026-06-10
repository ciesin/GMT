use gdal_sys::GDALDataType;
use crate::utils::_string;
use std::ffi::CString;
use std::fmt::Debug;
use num_integer::Integer;
use num_traits::{FromPrimitive, ToPrimitive};

pub trait IntAlias: Copy + Integer + ToPrimitive + FromPrimitive + Debug {}
impl IntAlias for i32 {}
impl IntAlias for u32 {}
impl IntAlias for u16 {}

pub trait GdalType {
    fn gdal_type() -> GDALDataType::Type;

}

impl GdalType for u8 {
    fn gdal_type() -> GDALDataType::Type {
        GDALDataType::GDT_Byte
    }
}
impl GdalType for u16 {
    fn gdal_type() -> GDALDataType::Type {
        GDALDataType::GDT_UInt16
    }
}
impl GdalType for u32 {
    fn gdal_type() -> GDALDataType::Type {
        GDALDataType::GDT_UInt32
    }
}
impl GdalType for i16 {
    fn gdal_type() -> GDALDataType::Type {
        GDALDataType::GDT_Int16
    }
}
impl GdalType for i32 {
    fn gdal_type() -> GDALDataType::Type {
        GDALDataType::GDT_Int32
    }
}
impl GdalType for f32 {
    fn gdal_type() -> GDALDataType::Type {
        GDALDataType::GDT_Float32
    }
}
impl GdalType for f64 {
    fn gdal_type() -> GDALDataType::Type {
        GDALDataType::GDT_Float64
    }
}

pub fn convert_gdal_type_to_string(gdal_type: GDALDataType::Type) -> String {
    let rv = unsafe { gdal_sys::GDALGetDataTypeName(gdal_type) };
    _string(rv)
}

pub fn convert_string_to_gdal_type(name: &str) -> Result<GDALDataType::Type, bool> {
    let rv = unsafe {
        let c_filename = CString::new(name ).unwrap();
        gdal_sys::GDALGetDataTypeByName(c_filename.as_ptr())
    };

    Ok(rv)
}

