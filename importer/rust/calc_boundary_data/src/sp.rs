use std::collections::{HashMap, HashSet};
//use std::str::FromStr;
use anyhow::Result;
use bitvec::prelude::*;
use geo::Point as GeoPoint;
use log::{debug, trace};
use num::FromPrimitive;
use postgres::{Client, Transaction};
use postgres::binary_copy::BinaryCopyInWriter;
use postgres::types::{Type};

//use serde::{Deserialize, Serialize};
use uuid::Uuid;


use gdal::spatial_ref::{CoordTransform, SpatialRef};
use gdal::vector::{Geometry, OGRwkbGeometryType};
use geo_util::raster::{get_window_stats, Raster, rasterize_polygon_nogdal, RasterStats};
use crate::boundary::BoundaryIds;

use crate::ci::{ExcludedKey, get_exclusions, SettlementToHealthFacilityInclusion, get_inclusions, get_custom_catchment_health_facility_ids};
use crate::cmd_calc_boundary_data_rs::{BitVecWrapper, get_laea_spatial_ref};
use crate::hf::{HfInfo, get_health_facilities_for_settlement_part_raster_square, HfType};

use crate::weights::WeightConfig;

//to account for empty squares, consider that they have a bit of pop inside for each square
const POP_PER_SQUARE: f64 = 1.0;



// Stores
pub(crate) struct SpSquareHfInfo {
    pub(crate) hf_idx_to_weight: HashMap<usize, f64>,
    pub(crate) total_weight: f64,

    //Including pop per square + the pop value for the raster square
    pub(crate) pop: f64,
}

pub(crate) struct SpHfInfo {
    //Including pop per square + the pop value for the raster square
    pub(crate) hf_idx_to_pop: HashMap<usize, f64>,

    //Including pop per square + the pop value for the raster square
    pub(crate) total_pop: f64
}

// Tracks attributes for a given settlement part
pub(crate) struct SpInfo {

    raster_stats: RasterStats,

    pub(crate) sp_guid: Uuid,

    //Index is 0 based, relative one given sub raster coordinates
    raster: BitVecWrapper,

    pub(crate) boundary_id: u32,
    pub(crate) boundary_polygon: Uuid,

    //[minx, miny, maxx, maxy]
    bbox: [f64; 4],

    is_inhabited: bool,

}

pub(crate) struct SpCatchmentInfo {
    // Totals with health facilities cover this health facility, by square
    // maps hf guid => square & pop count
    // Note a special guid, HF_NONE, is used to track un covered pop
    //storing stats for only this settlement part
    pub(crate) hf_map: SpHfInfo,

    //Index is 0 based, relative one given sub raster coordinates
    is_fixed_post: BitVecWrapper,
    is_outreach: BitVecWrapper,

    //sp_total_pop: f64,
    sp_total_sq: u32,


}


#[inline]
// Calculates the hfs associated with this settlement part raster square
// and their weights
fn process_sp_square_hf_info(
    idx: usize,
    sp_info: &SpInfo,
    x_form: &CoordTransform,

    pop_data: &Vec<f64>,
    pop_stats: &RasterStats,

    exclusions: &HashSet<ExcludedKey>,
    inclusions: &SettlementToHealthFacilityInclusion,
    custom_catchment_health_facility_ids: &HashSet<Uuid>,
    
    hf_info: &HfInfo,

    wc: &WeightConfig,

) -> Result<Option<SpSquareHfInfo>> {
    if !sp_info.is_inhabited {
        return Ok(None);
    }

    let pop = pop_data[idx];

    let pop_is_nodata = pop_stats.is_nodata(pop);

    let sp_raster = &sp_info.raster.0;
    let sp_raster_stats = &sp_info.raster_stats;

    //we only care about settlement part squares
    if !sp_raster[idx] {
        return Ok(None);
    }

    let mut ret = SpSquareHfInfo {
        hf_idx_to_weight: Default::default(),
        total_weight: 0.0,
        pop: POP_PER_SQUARE,
    };

    if !pop_is_nodata && pop > 0.0 {
        ret.pop += pop;
    }


    let raster_x = idx as u32 % sp_raster_stats.num_cols;
    let raster_y = idx as u32 / sp_raster_stats.num_cols;

    let coord_xy = sp_raster_stats.calc_center((raster_x, raster_y));

    let coord_xy_meters = x_form.transform_point(&coord_xy)?;

    let coord_point: GeoPoint<f64> = coord_xy.into();

    //Which hf deal with this square
    let hfs = get_health_facilities_for_settlement_part_raster_square(
        &coord_point,
        &coord_xy_meters,
        exclusions,
        inclusions,
        custom_catchment_health_facility_ids,
        sp_info,
        hf_info,
        wc,
    )?;

    if hfs.is_empty() {
        ret.total_weight = 1.0;        
    } else {
        for c_hf in hfs.iter() {
            ret.total_weight += c_hf.weight;
            ret.hf_idx_to_weight.insert(c_hf.hf_index, c_hf.weight);
        }

        // let debug_uuid = Uuid::from_str("4053bb44-1fa5-4e6a-a9b1-f97a35ca4013").unwrap();
        // let debug_index = hf_info.guid_to_index.get(&debug_uuid).unwrap();
        // if ret.hf_idx_to_weight.contains_key(debug_index) {
        //     trace!("Total weight is {} of {:?}.  Pop {}", ret.total_weight, ret.hf_idx_to_weight.get(debug_index), ret.pop);
        // }
        //
    }



    Ok(Some(ret))
}

/// Calculates what we can before we start pruning
/// Basically we have the hfs that are involved in a particular sp square
fn calc_initial_sp_square_weights(
    client: &mut Client,
    sp_info: &SpInfo,
    pop_raster: &Raster,
    pop_stats: &RasterStats,
    hf_info: &HfInfo,
    wc: &WeightConfig,
    boundary_ids: &BoundaryIds,
) -> Result<(SpHfInfo, Vec<Option<SpSquareHfInfo>>)> {
    let lat_lon = SpatialRef::from_epsg(4326)?;
    let meters_proj = get_laea_spatial_ref(pop_stats)?;
    let x_form = CoordTransform::new(&lat_lon, &meters_proj)?;

    let sp_raster = &sp_info.raster.0;
    let sp_raster_stats = &sp_info.raster_stats;

    assert_eq!(sp_raster.len() as u32, sp_raster_stats.num_cols * sp_raster_stats.num_rows);

    let sp_origin_x_offset = pop_stats.calc_x_round(sp_raster_stats.origin_x);
    let sp_origin_y_offset = pop_stats.calc_y_round(sp_raster_stats.origin_y);

    let exclusions = get_exclusions(client, boundary_ids).unwrap();
    let inclusions = get_inclusions(client, boundary_ids).unwrap();
    let custom_catchment_health_facility_ids = get_custom_catchment_health_facility_ids(client, boundary_ids).unwrap();

    let mut sp_hf_info = SpHfInfo {
            hf_idx_to_pop: Default::default(),
            total_pop: 0.0,
    };

    let pop_data: Vec<f64> = pop_raster.band().read_as(
            (
                sp_origin_x_offset,
                sp_origin_y_offset
            ),
            (
                sp_raster_stats.num_cols,
                sp_raster_stats.num_rows
            ),
        )?;

    let mut vec_sp_sq_hf_info = Vec::with_capacity(pop_data.len());

    for idx in 0..pop_data.len() {
        let sq_info = process_sp_square_hf_info(
            idx,
            &sp_info,
            &x_form,
            &pop_data,
            &pop_raster.stats,
            &exclusions,
            &inclusions,
            &custom_catchment_health_facility_ids,
            &hf_info,
            &wc,
        ).unwrap();

        if let Some(sq_info) = &sq_info {
            for (idx,weight) in sq_info.hf_idx_to_weight.iter() {
                let pop = sp_hf_info.hf_idx_to_pop.entry(*idx).or_insert(0.0);
                *pop += (weight / sq_info.total_weight) * sq_info.pop;
            }

            sp_hf_info.total_pop += sq_info.pop;
        }

        vec_sp_sq_hf_info.push(sq_info);

    }

    // let debug_uuid = Uuid::from_str("4053bb44-1fa5-4e6a-a9b1-f97a35ca4013").unwrap();
    // let debug_index = hf_info.guid_to_index.get(&debug_uuid).unwrap();
    // if sp_hf_info.hf_idx_to_pop.contains_key(debug_index) {
    //     trace!("Total POP is {} of {:?}", sp_hf_info.total_pop, sp_hf_info.hf_idx_to_pop.get(debug_index));
    // }

    Ok((sp_hf_info, vec_sp_sq_hf_info))
}

// Prunes according to the min %
// Only prunes out of boundary health faciliets
fn prune_hfs(
    hf_info: &HfInfo,
    sp_info: &SpInfo,
    wc: &WeightConfig,
    sp_hf_info: &mut SpHfInfo,
    vec_sp_square_hf_info: &mut Vec<Option<SpSquareHfInfo>>,
) -> Result<()> {

    let mut has_been_pruned : HashSet<usize> = HashSet::new();

    trace!("Begin pruning ", );

    loop {

        //Find minimum % that has not already been pruned
        let mut min_perc = f64::MAX;
        let mut min_hf_idx = hf_info.hf_list.len();

        for (hf_idx, pop) in sp_hf_info.hf_idx_to_pop.iter() {
            if has_been_pruned.contains(hf_idx) {
                continue;
            }

            if *pop >= wc.min_settlement_pop {
                continue;
            }

            //hf_idx can be out of bounds if it is the unclaimed hf idx (which == hf.len()
            if *hf_idx >= hf_info.hf_list.len() {
                continue;
            }

            if hf_info.hf_list[*hf_idx].boundary_polygon == sp_info.boundary_polygon {
                // never prune in boundary HFs
                continue;
            }


            let hf_perc = pop / sp_hf_info.total_pop;

            if hf_perc < min_perc {
                min_perc = hf_perc;
                min_hf_idx = *hf_idx;
            }
        }

        if min_perc >= wc.min_settlement_perc {
            trace!("done with min perc");
            break;
        }

        trace!("Min % is {} of idx {} guid {}", min_perc, min_hf_idx, hf_info.hf_list[min_hf_idx].name);

        //Prune min_hf_idx
        let l = vec_sp_square_hf_info.len();
        for sq_idx in 0..l {
            if let Some(s) = &mut vec_sp_square_hf_info[sq_idx] {
                if !s.hf_idx_to_weight.contains_key(&min_hf_idx) {
                    continue;
                }

                //Must keep at least 1 hf to prevent pruning until there is no coverage
                if s.hf_idx_to_weight.len() <= 1 {
                    continue;
                }

                let removed_weight = s.hf_idx_to_weight.remove(&min_hf_idx).unwrap();
                s.total_weight -= removed_weight;
 
            }
        }

        //Recalculate pops
        sp_hf_info.hf_idx_to_pop.clear();
        for sq_idx in 0..l {
            if let Some(sq_info) = &vec_sp_square_hf_info[sq_idx] {
                for (idx, weight) in sq_info.hf_idx_to_weight.iter() {
                    let pop = sp_hf_info.hf_idx_to_pop.entry(*idx).or_insert(0.0);
                    *pop += (weight / sq_info.total_weight) * sq_info.pop;
                }
            }
        }

        trace!("After pruning {} = {}",
        hf_info.hf_list[min_hf_idx].name,
            sp_hf_info.hf_idx_to_pop.get(&min_hf_idx).unwrap_or(&0.0) / sp_hf_info.total_pop);

        has_been_pruned.insert(min_hf_idx);

    }

    Ok(())
}

#[inline]
fn calculate_visual_catchments(
    idx: usize,
    sp_info: &SpInfo,
    sp_catchment_info: &mut SpCatchmentInfo,

    //sp_hf_info: &SpHfInfo,
    sp_square_hf_info: &SpSquareHfInfo,


    hf_info: &HfInfo,

    //storing stats for all settlement parts
    hf_catchments: &mut HashMap<Uuid, Vec<RowCol>>,

    sp_origin_x_offset: u32,
    sp_origin_y_offset: u32,

) -> Result<()> {



    let sp_raster_stats = &sp_info.raster_stats;

    let raster_x = idx as u32 % sp_raster_stats.num_cols;
    let raster_y = idx as u32 / sp_raster_stats.num_cols;

    let is_outreach = &mut sp_catchment_info.is_outreach.0;
    let is_fixed_post = &mut sp_catchment_info.is_fixed_post.0;    


    //trace!("Square at {:?} has pop {}", coord_point, pop );

    let mut is_fp = false;

    //square is not covered, no hf fields to calculate
    if sp_square_hf_info.hf_idx_to_weight.len() == 0 {
        return Ok(());
    }

    for (&hf_idx, _) in sp_square_hf_info.hf_idx_to_weight.iter() {

        assert!(hf_idx < hf_info.hf_list.len());

        let hf = &hf_info.hf_list[hf_idx];

        is_fp = is_fp || hf.hf_type == HfType::FixedPost;


        let hf_catchment_row_cols = hf_catchments.entry(hf.global_id).or_insert(Vec::new());

        //need to have pop raster coordinates
        let pop_raster_x = raster_x + sp_origin_x_offset;
        let pop_raster_y = raster_y + sp_origin_y_offset;

        hf_catchment_row_cols.push( RowCol{
            row: pop_raster_y,
            col: pop_raster_x
        });

    }

    if is_fp {
        is_fixed_post.set(idx, true);
    } else {
        is_outreach.set(idx, true);
    }


    Ok(())
}

pub(crate) struct RowCol {
    pub(crate) row: u32,
    pub(crate) col: u32
}

pub(crate) struct AllSpInfo {
    pub(crate) vec_sp_catchment_info: Vec<SpCatchmentInfo>,
    pub(crate) vec_sp_info: Vec<SpInfo>,
    //We need to serialize the health facility catchments, we don't know how large it will be,
    //so we store pop raster coordinates (row, col)

    pub(crate) hf_catchments: HashMap<Uuid, Vec<RowCol>>
}


///
/// Returns vec whose index is the settlement part int
pub (crate) fn get_sp_data(
    client: &mut Client,
    pop_stats: &RasterStats,
    boundaries: &BoundaryIds
) -> Result<Vec<SpInfo>> {

    let mut all_sp_rows = Vec::with_capacity(1000);

    for b_id_info in boundaries.id_list.iter() {

        if !b_id_info.in_update_set {
            continue;
        }
        let b_id = b_id_info.boundary_id;

        let sp_rows = client.query(&format!("
SELECT
    sp.global_id,
    {b_id},
    ST_AsBinary(sp.geom, 'XDR'),
    sp.boundary_polygon,
    EXISTS (
        SELECT 1 FROM
        partitions_settlement_name.settlement_name_{b_id:0>5}_latest sn
        WHERE sn.is_primary = True AND
        NOT COALESCE(sn.uninhabited, False) AND sn.settlement_Part = sp.global_id
    ) as is_inhabited
FROM partitions_settlement_part.settlement_part_{b_id:0>5}_latest sp
WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)

    "), &[]).unwrap();
        all_sp_rows.extend(sp_rows.into_iter());
    }


    let mut ret : Vec<SpInfo> = Vec::with_capacity(all_sp_rows.len());

    //Loop through each database settlement part in the boundary partition
    for sp_row in all_sp_rows.iter() {
        //Get a gdal geometry
        let sp_guid: Uuid = sp_row.get(0);
        let b_id: u32 = sp_row.get::<_, i32>(1) as u32;


        //For this boundary or not yet rasterized settlement parts
        let (sp_raster, sp_raster_stats, bbox) = { //if b_id == boundary_id || raster_width <= 0 || raster_height <= 0{
            let geom_bytes: Vec<u8> = sp_row.get(2);

            //Even if we don't need a db update (updating settlement part)
            //We still need to compute the stuff for catchment items

            let mut gdal_geom = Geometry::empty(OGRwkbGeometryType::wkbMultiPolygon)?;

            // debug!("Importing bytes {}", buf.len());
            gdal_geom.import_ewkb_bytes_raw(&geom_bytes).unwrap();
            let (sp_raster_stats, sp_bbox) = get_window_stats(&gdal_geom, &pop_stats);

            let sp_raster = rasterize_polygon_nogdal(&sp_raster_stats, &gdal_geom)?;

            let bbox = [sp_bbox.MinX, sp_bbox.MinY, sp_bbox.MaxX, sp_bbox.MaxY];

            (sp_raster, sp_raster_stats, bbox)
        };


        let sp_boundary_polygon: Uuid = sp_row.get(3);

        assert_eq!(sp_raster.len() as u32, sp_raster_stats.num_cols * sp_raster_stats.num_rows);

        let is_inhabited: bool = sp_row.get(4);

        let sp_info = SpInfo {
                raster_stats: sp_raster_stats,
                raster: BitVecWrapper(sp_raster),
                sp_guid,
                bbox ,
                boundary_id: b_id,
                boundary_polygon: sp_boundary_polygon,
                is_inhabited
            };

        ret.push(sp_info);
    }

    Ok(ret)
}

///
/// Essentially calculates the catchments for the given settlement parts
/// as well as the visualized hf catchments
pub (crate) fn get_sp_catchment_data(
    client: &mut Client,
    pop_raster: &Raster,
    pop_stats: &RasterStats,
    vec_sp_info: Vec<SpInfo>,
    hf_info: &HfInfo,
    wc: &WeightConfig,
    boundary_ids: &BoundaryIds,
) -> Result<AllSpInfo> {

    let mut hf_catchments = HashMap::with_capacity(hf_info.hf_list.len());

    //This will be 1 more than the actual # of settlement parts, since 0 is not used
    //This is done to not have to + or - 1
    let mut sp_ci_data: Vec<SpCatchmentInfo> = Vec::with_capacity(vec_sp_info.len());


    //Loop through each database settlement part in the boundary partition
    for sp_info in vec_sp_info.iter() {
        trace!("Begin sp {}", sp_info.sp_guid);

        let sp_raster = &sp_info.raster.0;
        let sp_raster_stats = &sp_info.raster_stats;

        assert_eq!(sp_raster.len() as u32, sp_raster_stats.num_cols * sp_raster_stats.num_rows);

        let sp_origin_x_offset = pop_stats.calc_x_round(sp_raster_stats.origin_x);
        let sp_origin_y_offset = pop_stats.calc_y_round(sp_raster_stats.origin_y);

        //read all population data for settlement part

        let (mut sp_hf_info, mut vec_sp_square_hf_info) = calc_initial_sp_square_weights(
            client, sp_info,
            pop_raster, pop_stats, hf_info, wc, boundary_ids)?;


        prune_hfs(hf_info, sp_info, wc, &mut sp_hf_info, &mut vec_sp_square_hf_info)?;

        let is_outreach = bitvec![u8, Msb0; 0; sp_raster.len()];
        let is_fixed_post = bitvec![u8, Msb0; 0; sp_raster.len()];

        let mut sp_catchment_info = SpCatchmentInfo {
            hf_map: sp_hf_info,
            is_fixed_post: BitVecWrapper(is_fixed_post),
            is_outreach: BitVecWrapper(is_outreach),
            sp_total_sq: 0
        };

        for idx in 0..vec_sp_square_hf_info.len() {
            if let Some(s) = &vec_sp_square_hf_info[idx] {
                sp_catchment_info.sp_total_sq += 1;

                //This computes the SP & HF visulization (the contribution from this SP)
                calculate_visual_catchments(
                    idx,
                    &sp_info,
                    &mut sp_catchment_info,

                    s,
                    hf_info,
                    &mut hf_catchments,
                    sp_origin_x_offset,
                    sp_origin_y_offset,
                ).unwrap();
            }
        }


        sp_ci_data.push(
            sp_catchment_info
        );


            //
            //ebug!("Not Pruned extra");


    }

    Ok(AllSpInfo {
        vec_sp_catchment_info: sp_ci_data,
        vec_sp_info,
        hf_catchments
    })
}

pub (crate) fn create_sp_items(client: &mut Transaction,
                   data: &AllSpInfo,
                   boundary_id: u32,
) -> Result<()> {

    let create_table = format!("
    CREATE TEMPORARY TABLE settlement_part_{boundary_id:0>5}_temp
(
    global_id        uuid                             not null,
    raster_width     integer          default 0                not null,
    raster_height    integer          default 0                not null,

    origin_x         double precision default 0                not null,
    origin_y         double precision default 0                not null,

    raster           bit varying      default ''::bit varying  not null,
    is_fixed_post    bit varying      default ''::bit varying  not null,
    is_outreach      bit varying      default ''::bit varying  not null,

    computed_pop     real,
    bbox             double precision[]

)");

    client.execute(&create_table, &[]).unwrap();

    let copy_sql = format!("
COPY settlement_part_{boundary_id:0>5}_temp FROM STDIN  BINARY
", );

    let copy_writer = client.copy_in(&copy_sql).unwrap();
    let mut bin_writer = BinaryCopyInWriter::new(copy_writer, &[
        Type::UUID,
        Type::INT4,
        Type::INT4,
        Type::FLOAT8,
        Type::FLOAT8,
        Type::VARBIT,
        Type::VARBIT,
        Type::VARBIT,
        Type::FLOAT4,
        Type::FLOAT8_ARRAY
    ]);

    let mut sp_num = 0;

    for (sp_idx, sp_catchment_info) in data.vec_sp_catchment_info.iter().enumerate() {

        let sp_info = &data.vec_sp_info[sp_idx];

        if sp_info.boundary_id != boundary_id {
            continue;
        }

        sp_num += 1;

        /*
        int_id,
    raster_width, raster_height,
    origin_x, origin_y,
    raster, is_fixed_post, is_outreach
         */

        bin_writer.write(&[
            &sp_info.sp_guid,
            &i32::from_u32(sp_info.raster_stats.num_cols),
            &i32::from_u32(sp_info.raster_stats.num_rows),
            &sp_info.raster_stats.origin_x,
            &sp_info.raster_stats.origin_y,
            &sp_info.raster,
            &sp_catchment_info.is_fixed_post,
            &sp_catchment_info.is_outreach,
            //We want the actual pop, not the pop with the extra values per square
            &f32::from_f64(sp_catchment_info.hf_map.total_pop - (sp_catchment_info.sp_total_sq as f64 * POP_PER_SQUARE)),
            &sp_info.bbox.as_ref()
        ]).unwrap();
    }

    bin_writer.finish().unwrap();

    let rows_updated = client.execute(&format!("
UPDATE partitions_settlement_part.settlement_part_{boundary_id:0>5} as to_update
SET
    raster_width = temp.raster_width,
    raster_height = temp.raster_height,

    origin_x = temp.origin_x,
    origin_y = temp.origin_y,

    raster = temp.raster,
    is_fixed_post = temp.is_fixed_post,
    is_outreach = temp.is_outreach,
    computed_pop = temp.computed_pop,

    bbox = temp.bbox

FROM settlement_part_{boundary_id:0>5}_temp temp
INNER JOIN partitions_settlement_part.settlement_part_{boundary_id:0>5}_latest latest
    ON latest.global_id = temp.global_id
WHERE to_update.global_id = latest.global_id AND to_update.version_id = latest.version_id

    "), &[]).unwrap();

    debug!("SP Rows updated in db: {} {}", rows_updated, sp_num);

    client.execute(
        &format!("REFRESH MATERIALIZED VIEW partitions_settlement_part.settlement_part_{boundary_id:0>5}_latest"),
        &[]).unwrap();

    Ok(())
}

