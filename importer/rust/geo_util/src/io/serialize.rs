

use std::path::{Path, PathBuf};
use gdal::vector::{ Feature, FieldValue, };


pub fn get_sub_dir<D, S>(directory_name: D, sub_dir: S) -> PathBuf
    where D: AsRef<Path>, S: AsRef<str> + AsRef<Path>
{
    let mut d = directory_name.as_ref().to_path_buf();
    d.push(sub_dir);
    d
}




pub trait SetArea {
    fn set_area(&mut self, area: f32);
}






pub fn set_attributes(ft: &mut Feature, att_values: &[FieldValue])
{
    for (field_idx, val) in att_values.iter().enumerate() {
        ft.set_field_by_index(field_idx as _, val).unwrap();
    }
}

pub fn get_index_width_len(num_entries: usize) -> usize {
    return 1+(num_entries as f64 - 1.0).log10().floor() as usize;
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_get_index_width_len() {
        assert_eq!(1, get_index_width_len(1));
        assert_eq!(1, get_index_width_len(10)); //0 to 9
        assert_eq!(2, get_index_width_len(11)); //10
        assert_eq!(2, get_index_width_len(100)); //0 to 99
        assert_eq!(3, get_index_width_len(101)); //0 to 99
        assert_eq!(3, get_index_width_len(1000)); //100
    }
}