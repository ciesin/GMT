use std::os::raw::c_char;
use anyhow::{bail, Result};
use geos_sys::*;
use SimpleContextHandle;
use std::ffi::{CStr};

// We need to cleanup only the char* from geos, the const char* are not to be freed.
// this has to be checked method by method in geos
// so we provide 2 method to wrap a char* to a string, one that manage (and thus free) the underlying char*
// and one that does not free it
pub(crate) unsafe fn simple_unmanaged_string(raw_ptr: *const c_char) -> Result<String> {
    if raw_ptr.is_null() {
        bail!("Pointer is null");
    }
    let c_str = CStr::from_ptr(raw_ptr);
    Ok(c_str.to_str()?.to_string())
}

pub(crate) unsafe fn simple_managed_string(
    raw_ptr: *mut c_char,
    context: &SimpleContextHandle
) -> Result<String> {
    if raw_ptr.is_null() {
        bail!("string ptr is null");
    }
    let s = simple_unmanaged_string(raw_ptr);
    GEOSFree_r(context.c_handle, raw_ptr as *mut _);
    s
}
