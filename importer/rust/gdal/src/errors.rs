use libc::c_int;
use std::str::Utf8Error;

use thiserror::Error;
use gdal_sys::{CPLErr, OGRErr, OGRFieldType};


#[derive(Clone, PartialEq, Debug, Error)]
pub enum ErrorKind {
    #[error("FfiNulError")]
    FfiNulError,
    #[error("StrUtf8Error: {0:?}")]
    StrUtf8Error(Utf8Error),
    #[cfg(feature = "ndarray")]
    #[error("NdarrayShapeError")]
    NdarrayShapeError(),
    #[error(
        "CPL error class: '{class:?}', error number: '{number}', error msg: '{msg}'"
    )]
    CplError {
        class: CPLErr::Type,
        number: c_int,
        msg: String,
    },
    #[error(
        "GDAL method '{}' returned a NULL pointer. Error msg: '{}'",
        method_name, msg
    )]
    NullPointer {
        method_name: &'static str,
        msg: String,
    },
    #[error("Can't cast to f64")]
    CastToF64Error,
    #[error("OGR method '{}' returned error: '{:?}'", method_name, err)]
    OgrError {
        err: OGRErr::Type,
        method_name: &'static str,
    },
    #[error(
         "Unhandled type {:?} on OGR method {}",
        field_type, method_name
    )]
    UnhandledFieldType {
        field_type: OGRFieldType::Type,
        method_name: &'static str,
    },
    #[error(
        "Invalid field name '{}' used on method {}",
        field_name, method_name
    )]
    InvalidFieldName {
        field_name: String,
        method_name: &'static str,
    },
    #[error(
        "Invalid field index {} used on method {}",
        index, method_name
    )]
    InvalidFieldIndex {
        index: usize,
        method_name: &'static str,
    },
    #[error("Unlinked Geometry on method {}", method_name)]
    UnlinkedGeometry { method_name: &'static str },
    #[error(
        "Invalid coordinate range while transforming points from {} to {}: {:?}",
        from, to, msg
    )]
    InvalidCoordinateRange {
        from: String,
        to: String,
        msg: Option<String>,
    },
    #[error("Generic Error")]
    GenericError {}
}
