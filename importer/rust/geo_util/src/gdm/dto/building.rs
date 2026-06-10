use crate::io::SetArea;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
pub struct Building {
    //This will be populated by whatever the FID field is, often this is objectid
    #[serde(rename(deserialize = "FID"))]
    pub orig_fid: u32,

    //Special handling in gdal deserializer to skip this
    pub area: f32,

    // pub predictions_probability: String,
    //
    // //#[serde(rename(deserialize = "predictions"))]
    // pub predictions: String,
}

impl SetArea for Building {
    fn set_area(&mut self, area: f32) {
        self.area = area;
    }
}