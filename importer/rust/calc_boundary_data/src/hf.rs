use std::cmp::{min,max};
use std::collections::HashMap;
use uuid::Uuid;
use anyhow::Result;
use std::collections::HashSet;
use bitvec::bitvec;
use rstar::{AABB, RTree};
use postgres::{Client, Row, Transaction};
use gdal::spatial_ref::{CoordTransform, SpatialRef};
use log::{debug};
use geo::Point as GeoPoint;
use geo::prelude::HaversineDistance;

use crate::rtree::RTreeIndexPoint;
use crate::ci::ExcludedKey;
use crate::sp::{AllSpInfo, RowCol, SpInfo};
use postgres::binary_copy::BinaryCopyInWriter;
use postgres::types::{Type, FromSql, ToSql};
use geo_util::raster::RasterStats;
use crate::cmd_calc_boundary_data_rs::{BitVecWrapper, get_laea_spatial_ref};
use bitvec::prelude::*;
use crate::boundary::BoundaryIds;
use crate::weights::WeightConfig;

/// Result of finding hf for a raster square
/// This is either the weight of a HF within 2km, or an explicitly included health facility
pub(crate) struct RasterSquareHealthFacilityWeight {
  pub(crate) weight: f64,
  //Index into HfInfo::hf_list
  pub(crate) hf_index: usize,
}


pub(crate) struct Hf {
  pub(crate) global_id: Uuid,
    pub(crate) name: String,
    // In 4326
    geo_point: GeoPoint<f64>,
    pub(crate) boundary_polygon: Uuid,
    pub(crate) hf_type: HfType,
    pub(crate) frequency: String,
}


#[derive(FromSql, ToSql, Debug, Eq, PartialEq)]
#[postgres(name = "hf_type")]
pub(crate) enum HfType {
    #[postgres(name = "fixed_post")]
    FixedPost,
    #[postgres(name = "outreach")]
    Outreach,
    #[postgres(name = "Unknown")]
    Unknown,
    #[postgres(name = "mobile")]
    Mobile,
}


/// Holds all health facilities, including surrounding boundaries
pub(crate) struct HfInfo {
    pub(crate) hf_list: Vec<Hf>,
    pub(crate) guid_to_index: HashMap<Uuid, usize>,
    pub(crate) rtree: RTree<RTreeIndexPoint>
}


//Used to track info on squares that have no close HF
//pub(crate) const HF_GUID_NONE: Uuid = Uuid::nil();




///
/// Calculates weighted average
/// weight is in meters
/// Will only be all fixed post or all outreach, since fixed post is higher priority than outreach
/// Will later be updated to account for more complex prioritation rules
pub(crate) fn get_health_facilities_for_settlement_part_raster_square(

    //In 4326
    coord_point: &GeoPoint<f64>,
    //In meters projected units
    coord_xy_meters: &[f64; 2],
    exclusions: &HashSet<ExcludedKey>,
    //map from settlement part id => Vec of explicitly included health facilities
    inclusions: &HashMap<Uuid, Vec<Uuid>>,
    custom_catchment_health_facility_ids: &HashSet<Uuid>,
    sp_info: &SpInfo,
    hf_info: &HfInfo,
    wc: &WeightConfig
) -> Result<Vec<RasterSquareHealthFacilityWeight>>
{
    let mut hfs: Vec<RasterSquareHealthFacilityWeight> = Vec::new();

    //First check inclusions, if we have any we use that and return
    //weight is evenly split and no pruning is done
    //https://github.com/novelt/GMT/issues/1606#issuecomment-1346258182
    if let Some(included_health_facilities) = inclusions.get(&sp_info.sp_guid) {
      if included_health_facilities.len() > 0 {
        let weight = 1.0 / included_health_facilities.len() as f64;
        for included_health_facility_id in included_health_facilities.iter() {
          let hf_index = *hf_info.guid_to_index.get(included_health_facility_id).unwrap();
          hfs.push(RasterSquareHealthFacilityWeight {
              weight,
              hf_index
          });
          //debug!("Included hf {} #{} in sp {}", included_health_facility_id, hf_index, sp_info.sp_guid);
        }

        return Ok(hfs);
      }
    }

    let mut total_weight = 0.0;
    let mut num_in_boundary_hf: i32 = 0;

    for health_facility_nearest_neighbor in hf_info.rtree.locate_within_distance(*coord_xy_meters, wc.distance.get_max_distance_2()) {

        //Note any inclusions (HFs with custom catchments) should have been handled above
        //So any includes here, we skip
        if custom_catchment_health_facility_ids.contains(&health_facility_nearest_neighbor.hf_guid) {
          continue;
        }

        //let dist = hf_nn.geo_point.geodesic_distance(coord_point);
        //haversine is less accurate, but turf uses it
        let dist = health_facility_nearest_neighbor.geo_point.haversine_distance(coord_point);

        let dist_weight = wc.distance.get_weight(dist);

        if dist_weight <= 0.0 {
            continue;
        }

        if exclusions.contains(&ExcludedKey {
            hf_guid: health_facility_nearest_neighbor.hf_guid,
            sp_guid: sp_info.sp_guid,
        }) {
            continue;
        }

        let hf_index = *hf_info.guid_to_index.get(&health_facility_nearest_neighbor.hf_guid).unwrap();
        let hf = &hf_info.hf_list[hf_index];

        let strat_weight = wc.hf_type.get_weight(&hf.hf_type);
        let boundary_weight = if hf.boundary_polygon == sp_info.boundary_polygon {wc.boundary.inside} else {
            wc.boundary.outside
        } ;
        let freq_weight = wc.frequency.get_weight(&hf.frequency);
        let weight = dist_weight * strat_weight * boundary_weight * freq_weight;
        hfs.push(RasterSquareHealthFacilityWeight {
            weight,
            hf_index
        });
        total_weight += weight;
        if hf.boundary_polygon == sp_info.boundary_polygon {
          num_in_boundary_hf += 1;
        }


    }

    hfs.sort_by( |h1, h2| {
        //most weight is earlier in the list
        return h2.weight.partial_cmp(&h1.weight).unwrap();
    });

    //Check smallest weight, prune if too low.  The %s of the rest are recalculated on the fly
    for index in (0..hfs.len()).rev() {
        let perc = hfs[index].weight / total_weight;

        if perc >= wc.min_square_perc {
          break;
        }

        let hf = &hf_info.hf_list[hfs[index].hf_index];

        //Don't prune the last in boundary health facility
        if hf.boundary_polygon == sp_info.boundary_polygon {
          num_in_boundary_hf -= 1;
          if num_in_boundary_hf <= 0 {
            break;
          }
        }

        assert_eq!(index, hfs.len() - 1);

        //Adjust new total weight
        total_weight -= hfs[index].weight;
        hfs.pop().unwrap();


       
    }


    Ok(hfs)
}


fn get_health_facilities_for_boundary(
    client: &mut Client,
    boundary_id: u32,
) -> Result<Vec<Row>> {
    let hf_query = format!("
    SELECT
    global_id, geom::Point,
    boundary_polygon,
    name,
    type,
    frequency
FROM partitions_health_facility_point.health_facility_point_{boundary_id:0>5}_latest
WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
AND 'Routine Immunization' = ANY(services)
ORDER BY global_id");

    Ok(client.query(&hf_query, &[])?)
}

fn get_health_facilities_for_surrounding_boundary(
    client: &mut Client,
    surrounding_boundary_ids: &BoundaryIds,
) -> Result<Vec<Row>> {
    let mut all_rows = Vec::new();

    for b_id_info in surrounding_boundary_ids.id_list.iter() {
        let rows = get_health_facilities_for_boundary(client, b_id_info.boundary_id)?;
        all_rows.extend(rows.into_iter());
    }

    Ok(all_rows)
}


pub (crate) fn serialize_hf_info(
    client: &mut Client,
    surrounding_boundaries: &BoundaryIds,
    pop_stats: &RasterStats
) -> Result<HfInfo> {

    let results = get_health_facilities_for_surrounding_boundary(client, &surrounding_boundaries).unwrap();

    let mut guid_to_index = HashMap::with_capacity(results.len());

    let mut hf_list = Vec::with_capacity(results.len());
    debug!("Reading health facilities");

    for (idx, row) in results.into_iter().enumerate() {
        let hf = Hf {
            global_id: row.get(0),
            geo_point: row.get(1),
            boundary_polygon: row.get(2),
            name: row.get(3),
            hf_type: row.get(4),
            frequency: row.get(5),
        };
        guid_to_index.insert(hf.global_id, idx);

        hf_list.push(hf);
    }

    //debug!("Finished building hf info");
    let lat_lon = SpatialRef::from_epsg(4326)?;
    let meters_proj = get_laea_spatial_ref(pop_stats)?;
    let x_form = CoordTransform::new(&lat_lon, &meters_proj)?;

    let rtree = serialize_hf_rtree(&x_form, &hf_list).unwrap();

    Ok(HfInfo {
        hf_list,
        guid_to_index,
        rtree
    })
}




///
/// Serialize from GMT database to RTree
pub(crate) fn serialize_hf_rtree(
    x_form: &CoordTransform,
    surrounding_hf_rows: &[Hf],
) -> Result<RTree<RTreeIndexPoint>> {
    let mut rio_list = Vec::with_capacity(surrounding_hf_rows.len());

    debug!("Reading health facilities, building RTRee");

    for row in surrounding_hf_rows.iter() {
        let geo_point = row.geo_point.clone();

        let meters_pt = x_form.transform_point(&[geo_point.x(), geo_point.y()])?;
        let envelope = AABB::from_corners(meters_pt, meters_pt);

        let rio = RTreeIndexPoint {
            hf_guid: row.global_id,
            envelope,
            geo_point,
        };
        rio_list.push(rio);
    }

    let rtree: RTree<RTreeIndexPoint> = RTree::bulk_load(rio_list);

    debug!("Finished building rtree");

    Ok(rtree)
}

pub (crate) fn update_invalid_hf_items(
    client: &mut Transaction,
    boundary_id: u32,
) -> Result<()> {

    let num_updated = client.execute(&format!("
UPDATE partitions_health_facility_point.health_facility_point_{boundary_id:0>5} as to_update
SET
    raster_width = 0,
    raster_height = 0,

    origin_x = 0,
    origin_y = 0,

    catchment_raster = ''::bit varying

WHERE geom IS NULL OR ST_IsEmpty(geom) OR NOT ('Routine Immunization' = ANY (services));
    "), &[]).unwrap();

    debug!("HF Invalid Num updated in db {}", num_updated);

    Ok(())
}

pub (crate) fn create_hf_items(client: &mut Transaction,
                   data: &AllSpInfo,
                   hf_info: &HfInfo,
                   boundary_id: u32,
    pop_raster_stats: &RasterStats,
    boundary_guid: &Uuid,
) -> Result<()> {

    let create_table = format!("
    CREATE TEMPORARY TABLE health_facility_point_{boundary_id:0>5}_temp
(
    global_id        uuid                             not null,
    raster_width     integer          default 0                not null,
    raster_height    integer          default 0                not null,

    origin_x         double precision default 0                not null,
    origin_y         double precision default 0                not null,

    catchment_raster bit varying      default ''::bit varying  not null

)");

    client.execute(&create_table, &[]).unwrap();

    let copy_sql = format!("
COPY health_facility_point_{boundary_id:0>5}_temp FROM STDIN  BINARY
", );

    let copy_writer = client.copy_in(&copy_sql).unwrap();
    let mut bin_writer = BinaryCopyInWriter::new(copy_writer, &[
        Type::UUID,
        Type::INT4,
        Type::INT4,
        Type::FLOAT8,
        Type::FLOAT8,
        Type::VARBIT
    ]);


    let empty_vec: Vec<RowCol> = Vec::new();
    let mut num_items = 0;

    for hf_data_item in hf_info.hf_list.iter() {

        if &hf_data_item.boundary_polygon != boundary_guid {
            continue;
        }

        //Need to calculate the raster dimensions
        let mut min_raster_x = 1 + pop_raster_stats.num_cols;
        let mut max_raster_x = 0;
        let mut min_raster_y = 1 + pop_raster_stats.num_rows;
        let mut max_raster_y = 0;

        let squares = data.hf_catchments.get(&hf_data_item.global_id).unwrap_or(&empty_vec);

        for sq in squares.iter() {
            min_raster_x = min(sq.col, min_raster_x);
            min_raster_y = min(sq.row, min_raster_y);

            max_raster_x = max(sq.col, max_raster_x);
            max_raster_y = max(sq.row, max_raster_y);
        }

        let raster_width: i32 = max(0, 1+max_raster_x as i32 - min_raster_x as i32);
        let raster_height: i32 = max(0, 1+max_raster_y as i32 - min_raster_y as i32);

        let num_squares = raster_width * raster_height;

        let mut hf_catchment_bv = bitvec![u8, Msb0; 0; num_squares as usize];

        for sq in squares.iter() {
            let catchment_raster_x = sq.col - min_raster_x;
            let catchment_raster_y = sq.row - min_raster_y;

            let catchment_raster_index = catchment_raster_y * raster_width as u32 + catchment_raster_x;
            //debug!("{} {} {} {}", catchment_raster_x, catchment_raster_y, raster_width, raster_height);
            hf_catchment_bv.set(catchment_raster_index as usize, true);
        }

        num_items+=1;

        bin_writer.write(&[
            &hf_data_item.global_id,
            &raster_width,
            &raster_height,
            &pop_raster_stats.calc_x_coord(min_raster_x),
            &pop_raster_stats.calc_y_coord(min_raster_y),
            &BitVecWrapper(hf_catchment_bv),
        ]).unwrap();
    }

    bin_writer.finish().unwrap();

    let num_updated = client.execute(&format!("
UPDATE partitions_health_facility_point.health_facility_point_{boundary_id:0>5} as to_update
SET
    raster_width = temp.raster_width,
    raster_height = temp.raster_height,

    origin_x = temp.origin_x,
    origin_y = temp.origin_y,

    catchment_raster = temp.catchment_raster

FROM health_facility_point_{boundary_id:0>5}_temp temp
INNER JOIN partitions_health_facility_point.health_facility_point_{boundary_id:0>5}_latest latest
    ON latest.global_id = temp.global_id
WHERE to_update.global_id = latest.global_id AND to_update.version_id = latest.version_id

    "), &[]).unwrap();

    client.execute(
        &format!("REFRESH MATERIALIZED VIEW partitions_health_facility_point.health_facility_point_{boundary_id:0>5}_latest"),
        &[]).unwrap();

    debug!("HF Num updated in db {} {}", num_updated, num_items);

    Ok(())
}

