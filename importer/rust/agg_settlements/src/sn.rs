use std::collections::HashMap;
use uuid::Uuid;
use anyhow::Result;
//use rstar::{RTree};
use postgres::{Row, Transaction};
use log::{debug};
//use geo::Point as GeoPoint;


use crate::boundary::{BoundaryInfo};


pub(crate) struct Sn {
    pub(crate) global_id: Uuid,
    pub(crate) is_primary: bool,
    pub(crate) uninhabited: bool,
    pub(crate) is_machine_generated: bool,
    pub(crate) name: String,
    // In 4326
    //geo_point: GeoPoint<f64>,
    //pub(crate) boundary_polygon: Uuid,
    pub(crate) settlement_part: Uuid,
}



//Settlement names in 1 boundary
pub(crate) struct SnInfo {
    pub(crate) sn_list: Vec<Sn>,
    //pub(crate) guid_to_index: HashMap<Uuid, usize>,
    //pub(crate) rtree: RTree<RTreeIndex>,

    pub(crate) sp_guid_to_sn_index: HashMap<Uuid, Vec<usize>>,
}




fn get_settlement_names_for_boundary(
    client: &mut Transaction,
    boundary_id: u32,
) -> Result<Vec<Row>> {
    let sn_query = format!("
    SELECT
    global_id, geom::Point,
    settlement_part,
    is_primary,
    uninhabited,
    name
FROM partitions_settlement_name.settlement_name_{boundary_id:0>5}_latest
WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
AND settlement_part is NOT NULL
ORDER BY global_id");

    //debug!("{}", sn_query);

    Ok(client.query(&sn_query, &[])?)
}


pub (crate) fn serialize_sn_info(
    client: &mut Transaction,
    boundary_info: &BoundaryInfo
) -> Result<SnInfo> {

    let sn_rows = get_settlement_names_for_boundary(client, boundary_info.boundary_id).unwrap();

    let mut guid_to_index = HashMap::with_capacity(sn_rows.len());

    let mut sn_list = Vec::with_capacity(sn_rows.len());

    let mut sp_guid_to_sn_index: HashMap<Uuid, Vec<usize>> = HashMap::new();

    for (idx, row) in sn_rows.into_iter().enumerate() {
        let mut sn = Sn {
            global_id: row.get(0),
            //geo_point: row.get(1),
            settlement_part: row.get(2),
            is_primary: row.get(3),
            uninhabited: row.get(4),
            name: row.get(5),
            is_machine_generated: false
        };

        sn.is_machine_generated = is_machine_generated(&sn.name);

        guid_to_index.insert(sn.global_id, idx);

        sp_guid_to_sn_index.entry(sn.settlement_part.clone()).or_default().push(idx);

        sn_list.push(sn);

    }

    debug!("Read {} settlement name points", sn_list.len());

    //let lat_lon = SpatialRef::from_epsg(4326)?;
    //let meters_proj = get_laea_spatial_ref(&boundary_info.envelope)?;
    //let x_form = CoordTransform::new(&lat_lon, &meters_proj)?;

    //let rtree = serialize_sn_rtree(&x_form, &sn_list).unwrap();

    Ok(SnInfo {
        sn_list,
        //guid_to_index,
        //rtree,
        sp_guid_to_sn_index
    })
}




///
/// Serialize from GMT database to RTree
// fn serialize_sn_rtree(
//     x_form: &CoordTransform,
//     sn_rows: &[Sn],
// ) -> Result<RTree<RTreeIndex>> {
//     let mut rio_list = Vec::with_capacity(sn_rows.len());

//     for (idx, row) in sn_rows.iter().enumerate() {
//         let geo_point = row.geo_point.clone();

//         let meters_pt = x_form.transform_point(&[geo_point.x(), geo_point.y()])?;
//         let envelope = AABB::from_corners(meters_pt, meters_pt);

//         let rio = RTreeIndex {
//             list_index: idx,
//             envelope,
//         };
//         rio_list.push(rio);
//     }

//     let rtree: RTree<RTreeIndex> = RTree::bulk_load(rio_list);

//     debug!("Finished building rtree");

//     Ok(rtree)
// }


const GENERATED_PREFIX: &str = "Generated name";

fn is_machine_generated(name: &str) -> bool {


  name.starts_with("HA_") ||
    name.starts_with("SSA_") ||
    name.starts_with("BUA_") ||
    name.starts_with(GENERATED_PREFIX)
}



