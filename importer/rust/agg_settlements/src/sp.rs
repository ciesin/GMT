use anyhow::Result;
use bitvec::prelude::*;
use gdal::vector::OGREnvelope;
use geo::area::Area;
use log::debug;
use postgres::Transaction;
use rstar::{RTree, AABB};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::str::FromStr;
use uuid::Uuid;
//use partitions::PartitionVec;

use gdal::spatial_ref::{CoordTransform, SpatialRef};
use gdal::vector::{Geometry, OGRwkbGeometryType};
//use geo::chamberlain_duquette_area::ChamberlainDuquetteArea;
use crate::boundary::{get_laea_spatial_ref, BoundaryInfo};
//use std::convert::TryFrom;
use geo_types::{coord, Rect};
use partitions::PartitionVec;

use crate::rtree::RTreeIndex;
use crate::sn::SnInfo;
use postgres_types::{FromSql, ToSql, Type};
use strum_macros::AsRefStr;

#[derive(Debug, ToSql, FromSql, AsRefStr)]
#[postgres(name = "settlement_part_type")]
pub(crate) enum SettlementType {
    #[postgres(name = "gmt")]
    //gmts are buffered points
    GMT,
    #[postgres(name = "bua")]
    BUA,
    #[postgres(name = "ssa")]
    SSA,
    #[postgres(name = "ha")]
    HA,
}

pub(crate) struct Sp {
    pub(crate) sp_guid: Uuid,
    //Envelope in custome UTM coordinates
    proj_envelope: OGREnvelope,
    geom: Geometry,
    is_named: bool,
    is_uninhabited: bool,
    area_est_m2: f64,
    settlement_type: SettlementType,
}

pub(crate) struct SpInfo {
    pub(crate) sp_list: Vec<Sp>,
    //pub(crate) guid_to_index: HashMap<Uuid, usize>,
    pub(crate) rtree: RTree<RTreeIndex>,
}

pub(crate) struct MergeData {
    //Key is the larger settlement to which that the value of sp indexes will be merged
    //so 3=> [91, 10, 51] means sp_info.sp_list[3] settlement geometry will grow from
    //indexes 91,10,51, and sp_info.sp_list[91], sp_info.sp_list[10], sp_info.sp_list[51] will be soft deleted
    merge_targets: HashMap<usize, Vec<usize>>,
}

//Merging small, unamed settlements to larger ones
const MERGE_DISTANCE: f64 = 1000.0;

//Merging small unamed settlements together
//const SMALL_MERGE_DISTANCE: f64 = 500.0;

fn get_settlement_type_level(settlement_type: &SettlementType) -> u8 {
    match settlement_type {
        SettlementType::GMT => 0,
        SettlementType::BUA => 3,
        SettlementType::SSA => 2,
        SettlementType::HA => 1,
    }
}

fn is_potential_merge_target(merge_child_candidate: &Sp, potential_merge_target: &Sp) -> bool {
    if potential_merge_target.is_uninhabited {
        return false;
    }

    //Can only merge to something 'bigger'
    return potential_merge_target.cmp(merge_child_candidate) == Ordering::Greater;
}

//check unnamed bua cannot be linked to named ha

impl Ord for Sp {
    fn cmp(&self, rhs: &Self) -> Ordering {
        get_settlement_type_level(&self.settlement_type)
            .cmp(&get_settlement_type_level(&rhs.settlement_type))
            .then_with(
                //true is greater than false
                || self.is_named.cmp(&rhs.is_named),
            )
            .then_with(|| self.area_est_m2.partial_cmp(&rhs.area_est_m2).unwrap())
            .then_with(
                //very unlikely areas are the same, but if they are, we use guids to have stable ordering
                || self.sp_guid.cmp(&rhs.sp_guid),
            )
    }
}
//The bigger one should be the target, the smaller one is the one soft deleted and merged with the bigger one

impl PartialOrd for Sp {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Sp {
    fn eq(&self, rhs: &Self) -> bool {
        self.sp_guid.eq(&rhs.sp_guid)
    }
}

impl Eq for Sp {}

fn envelope_distance(env1: &OGREnvelope, env2: &OGREnvelope) -> f64 {
    let x_dist = range_dist_helper([env1.MinX, env1.MaxX], [env2.MinX, env2.MaxX]);
    let y_dist = range_dist_helper([env1.MinY, env1.MaxY], [env2.MinY, env2.MaxY]);

    //manhatten distance
    x_dist + y_dist
}

fn range_dist_helper(range1: [f64; 2], range2: [f64; 2]) -> f64 {
    assert!(range1[0] < range1[1]);
    assert!(range2[0] < range2[1]);

    //If ranges overlap, distance is 0
    //https://stackoverflow.com/questions/3269434/whats-the-most-efficient-way-to-test-if-two-ranges-overlap

    if range1[0] <= range2[1] && range2[0] <= range1[1] {
        return 0.0;
    }

    //range1 both numbers are less than range 2
    if range1[1] < range2[0] {
        return range2[0] - range1[1];
    }

    //range2 both numbers are less than range1
    assert!(range2[1] < range1[0]);

    range1[0] - range2[1]
}

//Merges anything that is unnamed, regardless of size, to the best candidate
// Candidates are is_potential_merge_target == true
// And are ranked by the Sp ordering
pub(crate) fn merge_unamed(sp_info: &SpInfo) -> Result<MergeData> {
    let mut ret = MergeData {
        merge_targets: Default::default(),
    };

    let num_sp = sp_info.sp_list.len();

    let mut to_be_merged_list = Vec::with_capacity(sp_info.sp_list.len());

    let mut attempt_merge_count = 0;

    //BitVec set of all settlement parts, true means we are still trying to merge it
    let mut to_be_merged = BitVec::<usize, Lsb0>::repeat(false, num_sp);

    //Union find, for efficient unions of settlement parts
    let mut partition_vec: PartitionVec<()> = PartitionVec::with_capacity(sp_info.sp_list.len());
    partition_vec.resize(sp_info.sp_list.len(), ());
    // for _ in 0..sp_info.sp_list.len() {
    //   ret.partition_vec.push( () );
    // }

    //For each unamed settlement, find the best merge candidate
    //named is most important, followed by area
    //type must also be greater
    for (sp_idx, sp_merge_child_candidate) in sp_info.sp_list.iter().enumerate() {
        //let debug = sp_merge_child_candidate.sp_guid == Uuid::from_str("1236a1b5-0d7e-4a0c-85cd-d108d459b48b").unwrap();

        //let debug = sp_merge_child_candidate.sp_guid == Uuid::from_str("5cfda8be-320d-42b7-b600-d7d56c4936af").unwrap();

        let debug = sp_merge_child_candidate.sp_guid
            == Uuid::from_str("074d6e4f-211e-48f3-9f6c-855700734eff").unwrap();

        if debug {
            println!("ok");
        }
        if sp_merge_child_candidate.is_named {
            continue;
        }
        if sp_merge_child_candidate.is_uninhabited {
            continue;
        }

        attempt_merge_count += 1;

        let extent_center = sp_merge_child_candidate.proj_envelope.center();
        //Find anything within say 1km

        let mut matching_index: Option<usize> = None;
        //let mut matching_area = f64::MIN;

        //can we do rect to rect distance?
        for sp_potential_merge_target_ro in sp_info
            .rtree
            .locate_within_distance(extent_center, MERGE_DISTANCE * MERGE_DISTANCE)
        {
            // The settlement (for example, potentially large & named) that we want to merge to
            let sp_potential_merge_target =
                &sp_info.sp_list[sp_potential_merge_target_ro.list_index];

            if !is_potential_merge_target(sp_merge_child_candidate, sp_potential_merge_target) {
                continue;
            }

            if debug {
                println!("potential merge target {}, sp to merge envelope\n{:?}\ntarget envelope\n{:?}\n",
                         sp_potential_merge_target.sp_guid,
                    sp_merge_child_candidate.proj_envelope,
                    sp_potential_merge_target.proj_envelope
                );
            }

            //Merge with closest one that is "bigger"
            if let Some(current_matching_index) = matching_index {
                let current_match = &sp_info.sp_list[current_matching_index];

                // let current_match_distance = current_match.proj_envelope.center().distance_2(
                //     &sp_merge_child_candidate.proj_envelope.center()
                // );
                // let new_match_distance = sp_potential_merge_target.proj_envelope.center().distance_2(
                //     &sp_merge_child_candidate.proj_envelope.center()
                // );

                let current_match_distance = envelope_distance(
                    &current_match.proj_envelope,
                    &sp_merge_child_candidate.proj_envelope,
                );
                let new_match_distance = envelope_distance(
                    &sp_potential_merge_target.proj_envelope,
                    &sp_merge_child_candidate.proj_envelope,
                );

                if new_match_distance < current_match_distance {
                    matching_index = Some(sp_potential_merge_target_ro.list_index);

                    //cc5ff422-b884-4fb7-ab01-f65d87b00f10
                    //03024fd4-6e9a-42f5-b05a-c75e653e2f98
                    if debug {
                        println!(
                            "New closest match! {} vs {}",
                            current_match_distance, new_match_distance
                        );
                    }
                }

                //named always wins, otherwise, choose what is bigger
                // Ignoring distance, choosing best match
                // if sp_potential_merge_target.cmp(current_match) == Ordering::Greater {
                //     matching_index = Some(sp_potential_merge_target_ro.list_index);
                // }
            } else {
                matching_index = Some(sp_potential_merge_target_ro.list_index);
            }
        }

        if let Some(current_matching_index) = matching_index {
            assert!(!sp_merge_child_candidate.is_named);
            //assert!(!sp_info.sp_list[current_matching_index].attempt_merge);
            assert_eq!(
                sp_merge_child_candidate.sp_guid,
                sp_info.sp_list[sp_idx].sp_guid
            );
            assert_ne!(current_matching_index, sp_idx);

            //ret.entry(current_matching_index).or_default().push(sp_idx);

            partition_vec.union(sp_idx, current_matching_index);

            to_be_merged.set(sp_idx, true);
            to_be_merged_list.push(sp_idx);
        }
    }

    let merged_count = to_be_merged_list.len();

    //Now process the unioned sets, we either should have 1 named one, or one largest unnamed settlement part
    for unmerged_index in to_be_merged_list.into_iter() {
        if !to_be_merged.get(unmerged_index).unwrap() {
            continue;
        }

        if partition_vec.len_of_set(unmerged_index) <= 1 {
            continue;
        }

        let mut sps: Vec<usize> = partition_vec
            .set(unmerged_index)
            .map(|(idx, _)| idx)
            .collect();

        sps.sort_by(|idx1, idx2| sp_info.sp_list[*idx1].cmp(&sp_info.sp_list[*idx2]));

        //first value of tuple
        let largest: usize = sps.pop().unwrap();

        for sp_idx in sps.iter() {
            assert!(to_be_merged.get(*sp_idx).unwrap());
            //make sure we don't process this index anymore
            to_be_merged.set(*sp_idx, false);
        }

        assert!(!ret.merge_targets.contains_key(&largest));

        assert!(sps.len() > 0);
        ret.merge_targets.insert(largest, sps);
    }

    debug!(
        "total sp: {} Attempt merge count: {} merged: {} Still unmerged: {}",
        sp_info.sp_list.len(),
        attempt_merge_count,
        merged_count,
        attempt_merge_count - merged_count
    );

    Ok(ret)
}

//Anything that's <= 40_000 2 raster squares x 2 raster squares 200*200
//Unit is square meters (in a centered UTM projection)
//const TO_MERGE_AREA_CUTOFF: f64 = 40_000.;

///
/// Returns settlement part info, everything we need to see if we should merge them
/// and any data needed to serialize the results
pub(crate) fn serialize_sp_info(
    client: &mut Transaction,
    boundary_info: &BoundaryInfo,
    sn_info: &SnInfo,
) -> Result<SpInfo> {
    let b_id = &boundary_info.boundary_id;

    let sp_rows = client
        .query(
            &format!(
                "
SELECT
    sp.global_id,
    ST_AsBinary( sp.geom, 'XDR'),
    type
FROM partitions_settlement_part.settlement_part_{b_id:0>5}_latest sp
WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)

    "
            ),
            &[],
        )
        .unwrap();

    debug!("Fetched {} sp from db", sp_rows.len());

    //let mut guid_to_index = HashMap::with_capacity(sp_rows.len());

    let mut sp_list = Vec::with_capacity(sp_rows.len());

    let lat_lon = SpatialRef::from_epsg(4326)?;
    let meters_proj = get_laea_spatial_ref(&boundary_info.envelope)?;
    let x_form = CoordTransform::new(&lat_lon, &meters_proj)?;

    for sp_row in sp_rows.iter() {
        //Get a gdal geometry
        let sp_guid: Uuid = sp_row.get(0);
        let geom_bytes: Vec<u8> = sp_row.get(1);
        let settlement_type: SettlementType = sp_row.get(2);

        let mut gdal_geom = Geometry::empty(OGRwkbGeometryType::wkbMultiPolygon)?;

        // debug!("Importing bytes {}", buf.len());
        gdal_geom.import_ewkb_bytes_raw(&geom_bytes).unwrap();

        gdal_geom.set_spatial_reference(&lat_lon);

        //let convex_hull = gdal_geom.convex_hull()?;

        //assert_eq!(convex_hull.geometry_type(), OGRwkbGeometryType::wkbPolygon);

        //let rust_geo  = Polygon::try_from(convex_hull.to_rust_geo()).unwrap();

        //let gdal_proj = gdal_geom.transform_to(&meters_proj)?;
        let envelope = gdal_geom.envelope();

        let proj_env_min = x_form.transform_point(&[envelope.MinX, envelope.MinY])?;
        let proj_env_max = x_form.transform_point(&[envelope.MaxX, envelope.MaxY])?;
        //While projecting an extent (which could be warped is not super precise, its good enough)
        let rust_geo = Rect::new(
            coord! { x: proj_env_min[0], y: proj_env_min[1] },
            coord! { x: proj_env_max[0], y: proj_env_max[1] },
        )
        .to_polygon();
        //let extent_area = rust_geo.chamberlain_duquette_unsigned_area();
        let extent_area = rust_geo.unsigned_area();

        // if hull_area < min_area {
        //     debug!("New min is {:.1}", hull_area);
        //     min_area = hull_area;
        // }
        // if hull_area > max_area {
        //     debug!("New max is {:.1}", hull_area);
        //     max_area = hull_area;
        // }

        let is_named = if let Some(names) = sn_info.sp_guid_to_sn_index.get(&sp_guid) {
            //Do we have any primary / inhabited points
            names.iter().any(|name_idx| {
                let name = &sn_info.sn_list[*name_idx];
                name.is_primary && !name.uninhabited && !name.is_machine_generated
            })
        } else {
            false
        };

        //one uninhabited primary name is enough, could in theory
        //have 1 uninhabited and 1 inhabited primary name though
        let is_uninhabited = if let Some(names) = sn_info.sp_guid_to_sn_index.get(&sp_guid) {
            //Do we have any primary / inhabited points
            names.iter().any(|name_idx| {
                let name = &sn_info.sn_list[*name_idx];
                name.is_primary && name.uninhabited
            })
        } else {
            false
        };

        let sp = Sp {
            sp_guid,
            proj_envelope: OGREnvelope {
                MinX: proj_env_min[0],
                MaxX: proj_env_max[0],
                MinY: proj_env_min[1],
                MaxY: proj_env_max[1],
            },
            geom: gdal_geom,
            //geom_proj: gdal_proj,
            is_named,
            area_est_m2: extent_area,
            settlement_type,
            is_uninhabited,
        };

        sp_list.push(sp);
        //guid_to_index.insert(sp_guid, idx);
    }

    debug!(
        "Start building sp rtree, number of settlement parts {}",
        sp_rows.len()
    );

    let rtree = serialize_sp_rtree(&sp_list).unwrap();

    Ok(SpInfo {
        sp_list,
        //guid_to_index,
        rtree,
    })
}

///
/// Serialize from GMT database to RTree
fn serialize_sp_rtree(sp_rows: &[Sp]) -> Result<RTree<RTreeIndex>> {
    let mut rio_list = Vec::with_capacity(sp_rows.len());

    for (idx, row) in sp_rows.iter().enumerate() {
        let envelope = AABB::from_corners(
            [row.proj_envelope.MinX, row.proj_envelope.MinY],
            [row.proj_envelope.MaxX, row.proj_envelope.MaxY],
        );

        let rio = RTreeIndex {
            list_index: idx,
            envelope,
        };
        rio_list.push(rio);
    }

    let rtree: RTree<RTreeIndex> = RTree::bulk_load(rio_list);

    debug!("Finished building rtree for sp {}", sp_rows.len());

    Ok(rtree)
}

pub(crate) fn temp_cleanup(client: &mut Transaction, boundary_id: u32) {
    let last_version_id: i64 = 41121;

    //temp cleanup
    client
        .execute(
            &format!(
                "
DELETE FROM partitions_settlement_part.settlement_part_{boundary_id:0>5}
    WHERE version_id > $1;
        "
            ),
            &[&last_version_id],
        )
        .unwrap();

    client
        .execute(
            &format!(
                "
DELETE FROM partitions_settlement_name.settlement_name_{boundary_id:0>5}
    WHERE version_id > $1;
        "
            ),
            &[&last_version_id],
        )
        .unwrap();

    client
        .execute(
            &format!(
                "
DELETE FROM partitions_health_facility_point.health_facility_point_{boundary_id:0>5}
    WHERE version_id > $1;
        "
            ),
            &[&last_version_id],
        )
        .unwrap();

    client
        .execute(
            "
DELETE FROM master.commits
    WHERE id > $1;
        ",
            &[&last_version_id],
        )
        .unwrap();

    client.execute(
        &format!("REFRESH MATERIALIZED VIEW partitions_settlement_name.settlement_name_{boundary_id:0>5}_latest"),
        &[]).unwrap();
    client.execute(
        &format!("REFRESH MATERIALIZED VIEW partitions_settlement_part.settlement_part_{boundary_id:0>5}_latest"),
        &[]).unwrap();
    client.execute(
        &format!("REFRESH MATERIALIZED VIEW partitions_health_facility_point.health_facility_point_{boundary_id:0>5}_latest"),
        &[]).unwrap();
}

fn create_version(client: &mut Transaction) -> Result<i64> {
    let result = client.query_one(
        "
    insert into master.commits (publish_user, comment)
    values ('system', 'Aggegrate settlement')
    returning id
    ",
        &[],
    )?;

    Ok(result.get::<_, i64>(0))
}

pub(crate) fn insert_merged_settlements(
    client: &mut Transaction,
    sp_info: &SpInfo,
    boundary_id: u32,
    merge_data: &MergeData,
) -> Result<()> {
    let to_merge = &merge_data.merge_targets;
    let version_id = create_version(client).unwrap();

    //Now we insert it
    let insert_statement = client
        .prepare_typed(
            &format!(
                "
WITH existing_record AS (
    SELECT * FROM
    partitions_settlement_part.settlement_part_{boundary_id:0>5}_latest
    WHERE global_id = $1
)
INSERT INTO partitions_settlement_part.settlement_part_{boundary_id:0>5}
(
    global_id,
    version_id,
    is_deleted,
    boundary_polygon,
    geom,
    type,
    computed_pop,
    bbox,
    original_guids,
    raster_width,
    raster_height,
    origin_x,
    origin_y,
    raster,
    is_fixed_post,
    is_outreach,
    properties
)
SELECT global_id,
    $2, -- version_id,
    False,
    boundary_polygon,
    $3, --geom
    type,
    0, --computed_pop,
    ARRAY[]::double precision[], --bbox,
    original_guids,
    0, --raster_width,
    0, --raster_height,
    0, --origin_x,
    0, --origin_y,
    ''::bit varying, --raster,
    ''::bit varying, --is_fixed_post,
    ''::bit varying, --is_outreach,
    properties
FROM existing_record
        "
            ),
            &[Type::UUID, Type::INT8, Type::BYTEA],
        )
        .unwrap();

    let soft_delete_statement = client
        .prepare_typed(
            &format!(
                "
WITH existing_record AS (
    SELECT * FROM
    partitions_settlement_part.settlement_part_{boundary_id:0>5}_latest
    WHERE global_id = $1
)
INSERT INTO partitions_settlement_part.settlement_part_{boundary_id:0>5}
(
    global_id,
    version_id,
    is_deleted,
    boundary_polygon,
    geom,
    type,
    computed_pop,
    bbox,
    original_guids,
    raster_width,
    raster_height,
    origin_x,
    origin_y,
    raster,
    is_fixed_post,
    is_outreach,
    properties
)
SELECT global_id,
    $2, --version id
    True, --the only change setting is_deleted to True
    boundary_polygon,
    geom,
    type,
    computed_pop,
    bbox,
    original_guids,
    raster_width,
    raster_height,
    origin_x,
    origin_y,
    raster,
    is_fixed_post,
    is_outreach,
    properties
FROM existing_record
        "
            ),
            &[Type::UUID, Type::INT8],
        )
        .unwrap();

    //let mut num_inserted = 0;

    for (merge_target_index, merge_sources_list) in to_merge.iter() {
        //Combine all the polygons together from the sources list
        let mut poly_list = Vec::new();

        for merge_source_index in merge_sources_list.iter() {
            let merge_source = &sp_info.sp_list[*merge_source_index];
            let geom = &merge_source.geom;

            assert_eq!(geom.geometry_type(), OGRwkbGeometryType::wkbMultiPolygon);

            for n in 0..geom.geometry_count() {
                poly_list.push(geom.get_geometry(n));
            }

            //Since we merged it, soft delete it
            client.query(
                &soft_delete_statement,
                &[&merge_source.sp_guid, &version_id],
            )?;
        }

        //Merged polygon
        let mut new_geom = Geometry::empty(OGRwkbGeometryType::wkbMultiPolygon)?;
        let merged_target = &sp_info.sp_list[*merge_target_index];

        //Add original settlement polygons too
        for n in 0..merged_target.geom.geometry_count() {
            poly_list.push(merged_target.geom.get_geometry(n));
        }

        for p in poly_list {
            new_geom.add_geometry(p.clone())?;
        }

        client.query(
            &insert_statement,
            &[
                &merged_target.sp_guid,
                &version_id,
                &new_geom.ewkb_bytes().unwrap(),
            ],
        )?;

        //num_inserted += 1;
    }

    //Remove all names from settlement parts we just soft deleted (because they are machine generated)

    let _num_soft_deleted = client
        .execute(
            &format!(
                "
INSERT INTO partitions_settlement_name.settlement_name_{boundary_id:0>5}
(
    global_id,
    version_id,
    is_deleted,
    boundary_polygon,
    geom,
    name,
    settlement_part,
    is_primary,
    uninhabited,
    population_perc,    
    synonyms,
    properties,
    estimated_pop,
    problematic,
    uninhabited_reason
)
SELECT n.global_id,
    $1, --version id
    True, --the only change
    n.boundary_polygon,
    n.geom,
    name,
    settlement_part,
    is_primary,
    uninhabited,
    population_perc,
    synonyms,
    n.properties,
    estimated_pop,
    problematic,
    uninhabited_reason
FROM partitions_settlement_name.settlement_name_{boundary_id:0>5}_latest AS n
INNER JOIN partitions_settlement_part.settlement_part_{boundary_id:0>5} AS p
ON n.settlement_part = p.global_id
WHERE p.is_deleted = True AND p.version_id = $1
        "
            ),
            &[&version_id],
        )
        .unwrap();

    client.execute(
        &format!("REFRESH MATERIALIZED VIEW partitions_settlement_name.settlement_name_{boundary_id:0>5}_latest"),
        &[]).unwrap();
    client.execute(
        &format!("REFRESH MATERIALIZED VIEW partitions_settlement_part.settlement_part_{boundary_id:0>5}_latest"),
        &[]).unwrap();

    //println!("Num inserted {} soft deleted {}", num_inserted, num_soft_deleted);

    Ok(())
}

pub(crate) fn insert_merged_settlements_hard_delete(
    client: &mut Transaction,
    sp_info: &SpInfo,
    boundary_id: u32,
    merge_data: &MergeData,
) -> Result<()> {
    let to_merge = &merge_data.merge_targets;
    
    //let version_id = create_version(client).unwrap();
    //Use an existing version, that is higher than the initial imports
    let version_id: i64 = 19;

    //Now we insert it
    let insert_statement = client
        .prepare_typed(
            &format!(
                "
WITH existing_record AS (
SELECT * FROM
partitions_settlement_part.settlement_part_{boundary_id:0>5}_latest
WHERE global_id = $1
)
INSERT INTO partitions_settlement_part.settlement_part_{boundary_id:0>5}
(
global_id,
version_id,
is_deleted,
boundary_polygon,
geom,
type,
computed_pop,
bbox,
original_guids,
raster_width,
raster_height,
origin_x,
origin_y,
raster,
is_fixed_post,
is_outreach,
properties
)
SELECT global_id,
$2, -- version_id,
False,
boundary_polygon,
$3, --geom
type,
0, --computed_pop,
ARRAY[]::double precision[], --bbox,
original_guids,
0, --raster_width,
0, --raster_height,
0, --origin_x,
0, --origin_y,
''::bit varying, --raster,
''::bit varying, --is_fixed_post,
''::bit varying, --is_outreach,
properties
FROM existing_record
"
            ),
            &[Type::UUID, Type::INT8, Type::BYTEA],
        )
        .unwrap();

    let hard_delete_statement = client
        .prepare_typed(
            &format!(
                "
DELETE FROM partitions_settlement_part.settlement_part_{boundary_id:0>5}
WHERE global_id = $1
"
            ),
            &[Type::UUID],
        )
        .unwrap();

    //let mut num_inserted = 0;

    for (merge_target_index, merge_sources_list) in to_merge.iter() {
        //Combine all the polygons together from the sources list
        let mut poly_list = Vec::new();

        for merge_source_index in merge_sources_list.iter() {
            let merge_source = &sp_info.sp_list[*merge_source_index];
            let geom = &merge_source.geom;

            assert_eq!(geom.geometry_type(), OGRwkbGeometryType::wkbMultiPolygon);

            for n in 0..geom.geometry_count() {
                poly_list.push(geom.get_geometry(n));
            }

            //Since we merged it, soft delete it
            client.query(
                &hard_delete_statement,
                &[&merge_source.sp_guid, ],
            )?;
        }

        //Merged polygon
        let mut new_geom = Geometry::empty(OGRwkbGeometryType::wkbMultiPolygon)?;
        let merged_target = &sp_info.sp_list[*merge_target_index];

        //Add original settlement polygons too
        for n in 0..merged_target.geom.geometry_count() {
            poly_list.push(merged_target.geom.get_geometry(n));
        }

        for p in poly_list {
            new_geom.add_geometry(p.clone())?;
        }

        client.query(
            &insert_statement,
            &[
                &merged_target.sp_guid,
                &version_id,
                &new_geom.ewkb_bytes().unwrap(),
            ],
        )?;

        //num_inserted += 1;
    }

    //Remove all names from settlement parts we just soft deleted (because they are machine generated)

    let _num_hard_deleted = client
        .execute(
            &format!(
                "
DELETE FROM partitions_settlement_name.settlement_name_{boundary_id:0>5} AS n
WHERE NOT EXISTS 
(
  SELECT 1 FROM partitions_settlement_part.settlement_part_{boundary_id:0>5} AS p
  WHERE n.settlement_part = p.global_id
)
"
            ),
            &[],
        )
        .unwrap();

    client.execute(
&format!("REFRESH MATERIALIZED VIEW partitions_settlement_name.settlement_name_{boundary_id:0>5}_latest"),
&[]).unwrap();
    client.execute(
&format!("REFRESH MATERIALIZED VIEW partitions_settlement_part.settlement_part_{boundary_id:0>5}_latest"),
&[]).unwrap();

//remove history
let _num_hard_deleted = client
.execute(
    &format!(
        "
DELETE FROM partitions_settlement_name.settlement_name_{boundary_id:0>5} AS raw
WHERE NOT EXISTS 
(
SELECT 1 FROM partitions_settlement_name.settlement_name_{boundary_id:0>5}_latest AS latest
WHERE latest.global_id = raw.global_id AND latest.version_id = raw.version_id
)
"
    ),
    &[],
)
.unwrap();

let _num_hard_deleted = client
.execute(
    &format!(
        "
DELETE FROM partitions_settlement_part.settlement_part_{boundary_id:0>5} AS raw
WHERE NOT EXISTS 
(
SELECT 1 FROM partitions_settlement_part.settlement_part_{boundary_id:0>5}_latest AS latest
WHERE latest.global_id = raw.global_id AND latest.version_id = raw.version_id
)
"
    ),
    &[],
)
.unwrap();
    //println!("Num inserted {} soft deleted {}", num_inserted, num_soft_deleted);

    Ok(())
}
