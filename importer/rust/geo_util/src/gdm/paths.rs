use crate::gdm::constants;


pub fn get_raster_csv_name(start_x: u16, stop_x: u16, start_y: u16, stop_y: u16) -> String
{
    format!("raster_sq_x{:0nz$}_{:0nz$}__y{:0nz$}_{:0nz$}.{}", start_x,
                     stop_x, start_y, stop_y, constants::EXT_CSV, nz = 5)
}

