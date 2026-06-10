use geos_sys::*;
use std::ffi::CStr;
use std::os::raw::{c_char, c_void};
use std::ptr::null_mut;


unsafe extern "C" fn message_handler_func(
                message: *const c_char,
                _data: *mut c_void,
            ) {
    let s = CStr::from_ptr(message);
    println!("Recieved message: {}", s.to_string_lossy());
}


pub struct SimpleContextHandle {
    pub(crate) c_handle: GEOSContextHandle_t
}

impl SimpleContextHandle {
    pub fn new() -> Self {
        unsafe {
            Self {
                c_handle: GEOS_init_r()
            }
        }
    }

    pub fn add_message_handlers(&self) {
        unsafe {
            GEOSContext_setNoticeMessageHandler_r(self.c_handle, Some(message_handler_func), null_mut() );

            GEOSContext_setErrorMessageHandler_r(self.c_handle, Some(message_handler_func), null_mut() );
        }
    }
}

impl Drop for SimpleContextHandle {
    fn drop(&mut self) {
        unsafe {
            //println!("Dropping simple context handler");
            GEOS_finish_r(self.c_handle);
        }
    }
}