use anyhow::{bail, Result};
use geos_sys::*;
use ::{SimpleContextHandle, SimpleGeometry};

/// `PreparedGeometry` is an interface which prepares [`Geometry`] for greater performance
/// on repeated calls.
///
pub struct PreparedGeometry<'c> {
    c_handle: *const GEOSPreparedGeometry,
    pub(crate) context_handle: &'c SimpleContextHandle
}

impl<'c> PreparedGeometry<'c> {
    /// Creates a new `PreparedGeometry` from a [`Geometry`].
    ///    
    pub fn new(g: &SimpleGeometry<'c>) -> Result<PreparedGeometry<'c>> {
        unsafe {
            let ptr = GEOSPrepare_r(g.context_handle.c_handle, g.c_handle);
            
            Ok(PreparedGeometry{
                c_handle: ptr,
                context_handle: g.context_handle
            } )
        }
    }


    /// Returns `true` if no points of the other geometry is outside the exterior of `self`.
    ///
    /// # Example
    ///
    /// ```
    /// ```
    pub fn contains(&self, other: &SimpleGeometry) -> Result<bool> {
        let ret_val = unsafe {
            GEOSPreparedContains_r(self.context_handle.c_handle, self.c_handle, other.c_handle)
        };
        check_geos_predicate(ret_val)
    }

    /// Returns `true` if every point of the `other` geometry is inside self's interior.
    ///
    pub fn contains_properly(&self, other: &SimpleGeometry) -> Result<bool> {
        let ret_val = unsafe {
            GEOSPreparedContainsProperly_r(self.context_handle.c_handle, self.c_handle, other.c_handle)
        };
        check_geos_predicate(ret_val)
    }

    /// Returns `true` if no point of `self` is outside of `other`.
    ///
    pub fn covered_by(&self, other: &SimpleGeometry) -> Result<bool> {
        let ret_val = unsafe {
            GEOSPreparedCoveredBy_r(self.context_handle.c_handle, self.c_handle, other.c_handle)
        };
        check_geos_predicate(ret_val)
    }

    /// Returns `true` if no point of `other` is outside of `self`.
    ///
    pub fn covers(&self, other: &SimpleGeometry) -> Result<bool> {
        let ret_val =
            unsafe { GEOSPreparedCovers_r(self.context_handle.c_handle, self.c_handle, other.c_handle) };
        check_geos_predicate(ret_val)
    }

    /// Returns `true` if `self` and `other` have at least one interior into each other.
    ///
    pub fn crosses(&self, other: &SimpleGeometry) -> Result<bool> {
        let ret_val =
            unsafe { GEOSPreparedCrosses_r(self.context_handle.c_handle, self.c_handle, other.c_handle) };
        check_geos_predicate(ret_val)
    }

    /// Returns `true` if `self` doesn't:
    ///
    /// * Overlap `other`
    /// * Touch `other`
    /// * Is within `other`
    ///
    pub fn disjoint(&self, other: &SimpleGeometry) -> Result<bool> {
        let ret_val = unsafe {
            GEOSPreparedDisjoint_r(self.context_handle.c_handle, self.c_handle, other.c_handle)
        };
        check_geos_predicate(ret_val)
    }

    /// Returns `true` if `self` shares any portion of space with `other`. So if any of this is
    /// `true`:
    ///
    /// * `self` overlaps `other`
    /// * `self` touches `other`
    /// * `self` is within `other`
    ///
    /// Then `intersects` will return `true` as well.
    ///
    pub fn intersects(&self, other: &SimpleGeometry) -> Result<bool> {
        let ret_val = unsafe {
            GEOSPreparedIntersects_r(self.context_handle.c_handle, self.c_handle, other.c_handle)
        };
        check_geos_predicate(ret_val)
    }

    /// Returns `true` if `self` spatially overlaps `other`.
    ///
    pub fn overlaps(&self, other: &SimpleGeometry) -> Result<bool> {
        let ret_val = unsafe {
            GEOSPreparedOverlaps_r(self.context_handle.c_handle, self.c_handle, other.c_handle)
        };
        check_geos_predicate(ret_val)
    }

    /// Returns `true` if the only points in common between `self` and `other` lie in the union of
    /// the boundaries of `self` and `other`.
    ///
    pub fn touches(&self, other: &SimpleGeometry) -> Result<bool> {
        let ret_val =
            unsafe { GEOSPreparedTouches_r(self.context_handle.c_handle, self.c_handle, other.c_handle) };
        check_geos_predicate(ret_val)
    }

    /// Returns `true` if `self` is completely inside `other`.
    ///
    pub fn within(&self, other: &SimpleGeometry) -> Result<bool> {
        let ret_val =
            unsafe { GEOSPreparedWithin_r(self.context_handle.c_handle, self.c_handle, other.c_handle) };
        check_geos_predicate(ret_val)
    }
}


impl<'a> Drop for PreparedGeometry<'a> {
    fn drop(&mut self) {
        //println!("Prepared geometry drop");
        unsafe { GEOSPreparedGeom_destroy_r(self.context_handle.c_handle, self.c_handle) };
    }
}



pub(crate) fn check_geos_predicate(val: i8, ) -> Result<bool> {
    match val {
        1 => Ok(true),
        0 => Ok(false),
        _ => bail!("Invalid predicate", )
    }
}