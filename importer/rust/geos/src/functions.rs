use anyhow::Result;
use geos_sys::GEOSversion;
use simple_string::simple_unmanaged_string;


pub fn version() -> Result<String> {
    unsafe { simple_unmanaged_string(GEOSversion()) }
}



