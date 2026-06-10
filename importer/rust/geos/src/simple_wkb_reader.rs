use geos_sys::*;
use ::{SimpleContextHandle, SimpleGeometry};
use anyhow::{bail, Result};

pub struct WKBReader<'c> {
    pub(crate) c_handle: *mut GEOSWKBReader,
    pub(crate) context_handle: &'c SimpleContextHandle
}

impl<'c> WKBReader<'c> {
    /// Creates a new `WKBReader` instance.
    ///
    /// # Example
    ///
    /// ```

    /// ```
    pub fn new(context: &'c SimpleContextHandle) -> Result<WKBReader<'c>> {
        unsafe {
            let ptr = GEOSWKBReader_create_r(context.c_handle);
            
            if ptr.is_null() {
                bail!("GEOSWKBReader_create_r");
            }
            
            Ok(WKBReader {
                c_handle: ptr,
                context_handle: context
            })
            
        }
    }

    

    /// Writes out the given `geometry` as WKB format.
    ///
    /// # Example
    ///
    /// ```

    /// ```
    pub fn read_wkb(&self, bytes: &[u8]) -> Result<SimpleGeometry> {

        unsafe {
            let w_ptr = GEOSWKBReader_read_r(
                self.context_handle.c_handle,
                self.c_handle,
                bytes.as_ptr(),
                bytes.len()
            );
            if w_ptr.is_null() {
                bail!(
                    "WKBReader::write_wkb failed: GEOSWKBReader_writeHEX_r returned null pointer"
                );
            }

            Ok(SimpleGeometry{
                c_handle: w_ptr,
                owned: true,
                context_handle: self.context_handle
            })

        }
    }




}


impl<'a> Drop for WKBReader<'a> {
    fn drop(&mut self) {
        unsafe { GEOSWKBReader_destroy_r(self.context_handle.c_handle, self.c_handle) };    }
}

