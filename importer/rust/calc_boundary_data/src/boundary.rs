use std::collections::{HashMap, HashSet};
use std::env;
use std::iter::FromIterator;
use uuid::Uuid;

//use crate::cmd_calc_boundary_data_rs::DefBitVec;
use postgres::{Client, Transaction};
use anyhow::Result;
use itertools::Itertools;
use log::debug;
use gdal::vector::{Geometry, OGRwkbGeometryType};
use geo_util::raster::{get_window_stats, Raster, rasterize_polygon_nogdal};
use crate::hf::HfInfo;

pub(crate) struct BoundaryInfo {
    hf_guids: Vec<Uuid>,
    hf_names: Vec<String>,

    computed_pop: f64,

    //postgres int is signed
    num_pop_squares: i32,

    //[minx, miny, maxx, maxy]
    bbox: [f64; 4],
}

pub(crate) struct BoundaryIdInfo {
    pub(crate) boundary_id: u32,
    boundary_guid: Uuid,

    //Inside we look at settlement parts, outside we also consider HF
    //the update set is what was passed in originally, this is assumed to contain
    //all the surrounding boundaries.  To make sure those SP are correct, we also need
    //the surrounding boundaries of the surrounding boundaries
    pub(crate) in_update_set: bool
}

pub(crate) struct BoundaryIds {
    pub(crate) id_list: Vec< BoundaryIdInfo >,
    guid_to_index: HashMap<Uuid, usize>,
    //id_to_index: HashMap<u32, usize>,
}

impl BoundaryIds {
    pub(crate) fn get_boundary_id(&self, boundary_guid: &Uuid) -> Option<u32> {
        if let Some(index) = self.guid_to_index.get(boundary_guid) {
            Some(self.id_list[*index].boundary_id)
        } else {
            None
        }
    }
}
//
// const BOUNDARY_ID_QUERY: &str = "
//     SELECT id FROM partitions.boundary_id
//     WHERE global_id = $1
//     ";
//
// pub(crate) fn get_partition_number(
//     client: &mut Transaction,
//     boundary_global_id: &Uuid,
// ) -> Result<u32> {
//     let results = client.query(BOUNDARY_ID_QUERY, &[&boundary_global_id])?;
//
//     Ok(results[0].get::<_, i32>(0) as u32)
// }

const EXTENT_PADDING_METERS: u16 = 3000;



/// returns boundary_id, boundary_guid pairs
pub(crate) fn get_surrounding_boundaries(
    client: &mut Client,
    boundary_guids: &Vec<Uuid>, ) -> Result<BoundaryIds> {

    let boundary_operating_level: u16 = env::var("OPERATIONAL_BOUNDARY_LEVEL").unwrap().parse().unwrap();

    let in_arg = boundary_guids.iter().map( |b_guid| format!("'{}'", b_guid)).join(", ");
    let mut boundary_filter = String::from("");
    if in_arg.chars().count() > 0 {
        boundary_filter.push_str(" b.global_id  IN (");
        boundary_filter.push_str(&in_arg);
        boundary_filter.push_str(") AND ");
    }
    let boundary_query = format!("
WITH
agg_extent_4326 AS (
    SELECT ST_Extent(b.geom) as geom_4326
    FROM boundary.polygon_latest b
    WHERE {boundary_filter}
        b.level = {boundary_operating_level}
),
agg_extent_3857 AS (
    SELECT ST_Transform( ST_SetSrid(a.geom_4326, 4326), 3857) as geom_envelope
    FROM agg_extent_4326 a
),
extended_extent AS (
    SELECT ST_Transform(ST_SetSRID(
        ST_MakeBox2D(
            ST_Point(
                ST_XMin(a.geom_envelope) - {EXTENT_PADDING_METERS},
                ST_YMin(a.geom_envelope) - {EXTENT_PADDING_METERS}
            ),
            ST_Point(
                ST_XMax(a.geom_envelope) + {EXTENT_PADDING_METERS},
                ST_YMax(a.geom_envelope) + {EXTENT_PADDING_METERS}
            )
        ), 3857), 4326) as geom FROM agg_extent_3857 a
)
SELECT bid.id, bid.global_id
FROM boundary.polygon_latest b
    INNER JOIN partitions.boundary_id bid ON b.global_id = bid.global_id
    , extended_extent ee
WHERE ST_Intersects(ee.geom, b.geom)
    AND b.level = {boundary_operating_level}
", EXTENT_PADDING_METERS = EXTENT_PADDING_METERS);

    let in_update_set: HashSet<Uuid> = HashSet::from_iter(boundary_guids.iter().cloned());

    let results = client.query(&boundary_query, &[]).unwrap();

    let id_list = results.iter().map(|row| {
        let boundary_id = row.get::<_, i32>(0) as u32;
        let boundary_guid = row.get::<_, Uuid>(1);
        BoundaryIdInfo {
            boundary_id,
            boundary_guid,
            in_update_set: in_update_set.contains(&boundary_guid)
        }
    }).collect_vec();

    let mut guid_to_index = HashMap::with_capacity(id_list.len());
    //let mut id_to_index = HashMap::with_capacity(id_list.len());


    for (idx, b_id_info) in id_list.iter().enumerate() {
        guid_to_index.insert(b_id_info.boundary_guid, idx);
        //id_to_index.insert(b_id_info.boundary_id, idx);
    }

    debug!("Retrieved {} total boundaries for initial list {}", id_list.len(), boundary_guids.len());

    Ok( BoundaryIds {
        id_list,
        guid_to_index,
        //id_to_index
    })
}


pub(crate) fn get_pop_raster_index(client: &mut Client,
    boundary_guid: &Uuid,
    pop_rasters: &Vec<Raster>,
) -> Result<usize>
{
    let boundary_query = format!("
    SELECT (ST_XMin(ext) + ST_XMax(ext)) / 2, (ST_YMin(ext) + ST_YMax(ext)) / 2
    FROM (
        SELECT ST_Envelope(b.geom) AS ext FROM
        boundary.polygon_latest b
        WHERE b.global_id = $1 AND b.geom IS NOT NULL AND NOT ST_IsEmpty(b.geom)
    ) sq
    ");

    let results = client.query(&boundary_query, &[&boundary_guid]).unwrap();

    if results.is_empty() {
        //boundary has empty or null geometry
        return Ok(0);
    }

    assert_eq!(1, results.len());

    let b_row = &results[0];

    let x: f64 = b_row.get(0);
    let y: f64 = b_row.get(1);

    //Find the raster this boundary belongs to
    let pop_raster_index = pop_rasters.iter().position(|pr| {
        let row_x = pr.stats.calc_x(x);
        let row_y = pr.stats.calc_y(y);
        pr.stats.bounds_x(row_x) == row_x && pr.stats.bounds_y(row_y) == row_y
    }).expect("No suitable raster found");

    Ok(pop_raster_index)

}

pub(crate) fn get_boundary_info(client: &mut Transaction,
                                boundary_guid: &Uuid,
                                pop_raster: &Raster,
                                hf_info: &HfInfo,
) -> Result<BoundaryInfo>
{
    let boundary_query = format!("
    SELECT ST_AsBinary(b.geom, 'XDR')
    FROM boundary.polygon_latest b
    WHERE b.global_id = $1 AND b.geom IS NOT NULL AND NOT ST_Isempty(b.geom)
    ");

    let results = client.query(&boundary_query, &[&boundary_guid]).unwrap();

    if results.is_empty() {
        //boundary has empty or null geometry
        return Ok(BoundaryInfo {
            hf_guids: vec![],
            hf_names: vec![],
            computed_pop: 0.0,
            num_pop_squares: 0,
            bbox: [0.0, 0.0, 0.0, 0.0],
        });
    }
    assert_eq!(1, results.len());

    let b_row = &results[0];

    let geom_bytes: Vec<u8> = b_row.get(0);

    //Even if we don't need a db update (updating settlement part)
    //We still need to compute the stuff for catchment items

    let mut gdal_geom = Geometry::empty(OGRwkbGeometryType::wkbMultiPolygon)?;

    // debug!("Importing bytes {}", buf.len());
    gdal_geom.import_ewkb_bytes_raw(&geom_bytes).unwrap();

    
    let pop_stats = &pop_raster.stats;
    
    let (b_raster_stats, b_bbox) = get_window_stats(&gdal_geom, &pop_stats);

    debug!("Bounding box of boundary {:?}", b_bbox);
    let b_raster = rasterize_polygon_nogdal(&b_raster_stats, &gdal_geom)?;

    let b_origin_x_offset = pop_stats.calc_x_round(b_raster_stats.origin_x);
    let b_origin_y_offset = pop_stats.calc_y_round(b_raster_stats.origin_y);


    let pop_data: Vec<f64> = pop_raster.band().read_as(
        (
            b_origin_x_offset,
            b_origin_y_offset
        ),
        (
            b_raster_stats.num_cols,
            b_raster_stats.num_rows
        ),
    )?;

    let mut computed_pop = 0.0;
    let mut num_pop_squares = 0;

    //Zonal stats on boundary raster
    for b_raster_row in 0..b_raster_stats.num_rows {
        for b_raster_col in 0..b_raster_stats.num_cols {
            let b_index = (b_raster_col + b_raster_row * b_raster_stats.num_cols) as usize;

            if !b_raster.get(b_index).unwrap() {
                continue;
            }

            let pop_value = pop_data[b_index];
            if b_raster_stats.is_nodata(pop_value) {
                continue;
            }

            if pop_value <= 0.0 {
                continue;
            }

            num_pop_squares += 1;
            computed_pop += pop_value;
        }
    }

    let mut hf_in_boundary = hf_info.hf_list.iter().filter(
                                  |hf| &hf.boundary_polygon == boundary_guid
                              ).collect_vec();

    hf_in_boundary.sort_by( |a,b| a.name.cmp(&b.name));

    let hf_guids = hf_in_boundary.iter().map( |hf| hf.global_id).collect_vec();
    let hf_names = hf_in_boundary.iter().map( |hf| hf.name.clone()).collect_vec();

    Ok(BoundaryInfo {
        hf_guids,
        hf_names,
        computed_pop,
        num_pop_squares,
        bbox: [b_bbox.MinX, b_bbox.MinY, b_bbox.MaxX, b_bbox.MaxY],
    })
}


pub(crate) fn update_boundary(client: &mut Transaction,
                              boundary_guid: &Uuid,
                              data: &BoundaryInfo,
) -> Result<()> {
    client.execute(&format!("
UPDATE boundary.polygon AS to_update
SET
    num_pop_squares = $1,
    computed_pop = $2,

    hf_guids = $3,
    hf_names = $4,

    bbox = $5

FROM boundary.polygon_latest latest
WHERE to_update.global_id = latest.global_id AND to_update.version_id = latest.version_id
AND latest.global_id = $6

    "), &[
        &data.num_pop_squares,
        &data.computed_pop,
        &data.hf_guids,
        &data.hf_names,
        &data.bbox.as_ref(),
        &boundary_guid,
    ]).unwrap();



    Ok(())
}
