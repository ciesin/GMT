use crate::raster::{Raster, RasterStats};
use gdal::raster::{Driver, GDALDataType};
//use gdal::spatial_ref::SpatialRef;
use anyhow::{Result};
use crate::io::InputOgrLayer;
use gdal::vector::{Dataset, OGRwkbGeometryType, Geometry, OGREnvelope};
use gdal::raster::global_func::rasterize;
use std::fs::create_dir_all;
use gdal::raster::driver::{DEFAULT_RASTER_OPTIONS, GTIFF_DRIVER};
use std::path::Path;
use itertools::Itertools;
use log::{debug,};
use bitvec::prelude::*;
use gdal::raster::types::GdalType;

type DefBitVec = BitVec::<u8, Msb0>;

//x, y ; column, row
#[derive(Debug, Copy, Clone, PartialEq)]
struct RasterCoord {
    row: f64,
    col: f64,
}

#[derive(Debug)]
struct Edge {
    //y_min: f64,     // smallest value of y (when edge enters)
    //y_max: f64,     // largest value of y (when edge leaves)
    raster_x_hit: f64,
    // intersection point (init with x value at yMax)
    m_inv: f64,
    // dx/dy (inverse line increment)
    raster_y_min: u32,
    //min raster row is (-0.5, 0.5)
    raster_y_max: u32,
    //label: String,
}


impl Edge {
    fn new(top_coord: &RasterCoord, bot_coord: &RasterCoord, //, label: String
    ) -> Self {
        //because 1st row is above the last row
        assert!(top_coord.row < bot_coord.row);

        let dy = top_coord.row - bot_coord.row;
        let dx = top_coord.col - bot_coord.col;

        assert!(top_coord.row >= 0.);
        assert!(bot_coord.row >= 0.);

        //we want y_min to be rounded down and y_max to be rounded up
        //this is because we want the real segment to actually intersect the middle of these raster squares
        //note the 0.5 pixel height is because we want the center
        let raster_y_min = (top_coord.row + 0.5).floor() as u32;
        let raster_y_max = (bot_coord.row + 0.5).floor() as u32;

        // (x0 - x1) / (y0 - y1) = dx / dy
        // x0 - x1 = (dx / dy) * (y0-y1)
        // x0 =  (dx / dy) * (y0-y1) + x1
        let raster_x_hit = top_coord.col + ((raster_y_min as f64 + 0.5) - top_coord.row) * dx / dy;

        Self {
            //x at raster_y_min+0.5
            raster_x_hit,
            m_inv: dx / dy,
            raster_y_min,
            raster_y_max,
            // label: format!("{} raster_x_hit: {} y min/max {}, {}.  What {} + {} - {} * {}/{}",
            //                label, raster_x_hit, raster_y_min, raster_y_max,
            //                top_coord.col, top_coord.row, raster_y_min, dx, dy),
        }
    }
}

/// Given the gdal geometry, returns the dimensions of the raster
/// that would contain the rasterized version of the geometry
pub fn get_window_stats(geometry: &Geometry, snap_stats: &RasterStats) -> (RasterStats, OGREnvelope)
{
    let in_ext = geometry.envelope();

    let x_left = snap_stats.bounds_x(snap_stats.calc_x(in_ext.MinX));
    let x_right = snap_stats.bounds_x(snap_stats.calc_x(in_ext.MaxX));
    let y_top = snap_stats.bounds_y(snap_stats.calc_y(in_ext.MaxY));
    let y_bottom = snap_stats.bounds_y(snap_stats.calc_y(in_ext.MinY));

    let mut window_stats = snap_stats.clone();
    window_stats.origin_x = snap_stats.calc_x_coord(x_left);
    window_stats.origin_y = snap_stats.calc_y_coord(y_top);
    window_stats.num_cols = ((x_right - x_left) + 1) as u32;
    window_stats.num_rows = ((y_bottom - y_top) + 1) as u32;
    window_stats.gdal_type = u8::gdal_type();
    window_stats.no_data_value = 0.;

    (window_stats, in_ext)
}

///
/// Rasterizes the given multipolygon by hand
/// Will return a bit vector where 1 means the square
/// has a center that intersects the polygon
pub fn rasterize_polygon_nogdal(window_stats: &RasterStats, geometry: &Geometry) -> Result<DefBitVec> {

    let mut bv_rasterized = DefBitVec::new();
    bv_rasterized.resize((window_stats.num_rows * window_stats.num_cols) as _, false);

    assert_eq!(geometry.geometry_type(), OGRwkbGeometryType::wkbMultiPolygon);

    //Read in all the edges

    let poly_count = geometry.geometry_count();

    let mut edge_list = Vec::new();

    for p in 0..poly_count {
        let poly = geometry.get_geometry(p);
        assert_eq!(poly.geometry_type(), OGRwkbGeometryType::wkbPolygon);

        let ring_count = poly.geometry_count();

        for r in 0..ring_count {
            let ring = poly.get_geometry(r);

            let pt_count = ring.point_count();

            assert!(pt_count > 3);
            assert_eq!(ring.get_point(0), ring.get_point((pt_count - 1) as _));

            let mut raster_coords = Vec::with_capacity(pt_count);

            for pt_idx in 0..pt_count {
                let p1 = ring.get_point(pt_idx as _);

                let r1 = RasterCoord {
                    row: ((p1[1] - window_stats.origin_y) / window_stats.pixel_height),
                    col: ((p1[0] - window_stats.origin_x) / window_stats.pixel_width),
                };

                raster_coords.push(r1);
            }

            for pt_idx in 0..pt_count - 1 {
                let r1 = &raster_coords[pt_idx];
                let r2 = &raster_coords[pt_idx + 1];

                let (top_coord, bot_coord) = if r1.row < r2.row {
                    (&r1, &r2)
                } else {
                    (&r2, &r1)
                };

                //skip horizontal edges
                if r1.row == r2.row {
                    continue;
                }

                let edge =
                    Edge::new(top_coord, bot_coord); //, format!(
                //     "raster (r{}, c{}) to (r{}, c{}) coords {}, {} to {}, {}",
                //     top_coord.row,
                //     top_coord.col,
                //     bot_coord.row,
                //     bot_coord.col,
                //     p1.0, p1.1, p2.0, p2.1
                // ));

                if edge.raster_y_min < edge.raster_y_max {
                    edge_list.push(edge);
                } else {
                    //println!("Ignoring edge {:?}", &edge);
                }
            }
        }
    }

    //println!("Have {} edges", edge_list.len());

    //lowest raster y min last
    edge_list.sort_by(|e1, e2| e2.raster_y_min.cmp(&e1.raster_y_min));

    let mut current_row = 0;

    let mut active_edges = Vec::with_capacity(edge_list.len());

    while (!edge_list.is_empty() || !active_edges.is_empty()) && current_row < window_stats.num_rows {
        //println!("Starting row {}", current_row);

        //consider edges whose y_max >= current_y and y_min <= current_y
        //anything earlier in the edge_list has a y_min that is too high
        //and we stop looking when the y_min

        //Move those edges from the ET to the AET for which holds:
        while !edge_list.is_empty() {
            let last_elem = edge_list.last().unwrap();
            if last_elem.raster_y_min == current_row {
                active_edges.push(edge_list.pop().unwrap());
                continue;
            }

            if last_elem.raster_y_min > current_row {
                break;
            }

            //edge case, first edge is above
            if last_elem.raster_y_min < current_row {
                edge_list.pop().unwrap();
            }
        }

        let mut x_hit_list = active_edges.iter().map(|e| e.raster_x_hit).collect_vec();
        x_hit_list.sort_by(|a, b| a.partial_cmp(b).unwrap());

        // for a in active_edges.iter() {
        //     println!("{}", &a.label);
        // }

        //println!("X intersections: {}", x_hit_list.iter().map(|x| format!("{}", x)).join(", "));

        let mut x_hit_idx = 0;
        let mut parity = 0;

        for col in 0..window_stats.num_cols {
            while x_hit_idx < x_hit_list.len() && x_hit_list[x_hit_idx] < 0.5 + col as f64 {
                x_hit_idx += 1;
                parity = 1 - parity;
            }
            bv_rasterized.set((current_row * window_stats.num_cols + col) as usize, parity == 1);
        }


        //Remove anything in active_edges that no longer applies
        for i in (0..active_edges.len()).rev() {
            if active_edges[i].raster_y_max == 1 + current_row {
                active_edges.swap_remove(i);
            }
        }

        //Increment x intersection
        for a in active_edges.iter_mut() {
            a.raster_x_hit += a.m_inv;
        }

        current_row += 1;
    }

    Ok(bv_rasterized)
}

pub fn rasterize_polygon(
    snap_raster: &Path, input_layer: &InputOgrLayer, output_path: &Path,
    all_touched: bool,
    gdal_type: GDALDataType::Type,
    fid_field: Option<&str>,
    no_data_value: f64
) -> Result<()>
{
    let snap_raster = Raster::read(snap_raster, true);
    debug!("Use snap raster: {:?} with stats {}", snap_raster.path, snap_raster.stats);

    if !output_path.parent().unwrap().is_dir() {
        create_dir_all(output_path.parent().unwrap())?;
    }

    let drv = Driver::get(GTIFF_DRIVER)?;

    //Create the raster with appropriate projection, no data value, datatype, etc.
    {
        debug!("Creating output tif {:?}", output_path);

        //just want to create it and close it
        let ds = drv.create_with_band_type(
            output_path.to_str().unwrap(),
            snap_raster.stats.num_cols as isize,
            snap_raster.stats.num_rows as isize, 1, gdal_type,
            &DEFAULT_RASTER_OPTIONS
            )?;

        debug!("Created output tif {:?}", output_path);

        let output_raster_band = ds.rasterband(1)?;

        debug!("setting no data to 0");
        output_raster_band.set_no_data_value(no_data_value)?;
        output_raster_band.fill(no_data_value)?;

        let left = snap_raster.stats.origin_x;
        let top = snap_raster.stats.origin_y;
        let raster_tile_size_x = snap_raster.stats.pixel_width;
        let raster_tile_size_y = snap_raster.stats.pixel_height;

        //because y is the top not the bottom
        assert!(raster_tile_size_y < 0.0);
        debug!("setting geo transform & projection");
        ds.set_geo_transform(&[left, raster_tile_size_x, 0.0, top, 0.0, raster_tile_size_y])?;
        ds.set_projection(&snap_raster.stats.projection)?;

        debug!("Set projection to {}", &ds.projection());

    }

    //let output_raster = Raster::read(output_path.to_path_buf(), false);

    let dataset = Dataset::open(&input_layer.ogr_conn_str).unwrap();

    let layer_name = if input_layer.layer_name.is_empty() {
        dataset.layer(0)?.name()
    } else {
        input_layer.layer_name.clone()
    };

    /*
    cmd_line_components = [
        os.path.join(cfg.OSGEO_BIN_DIR, "gdal_rasterize"),
        "-a id",
        f"-l \"{schema_name}.{table_name}\"",
        'PG:"%s"' % (geo_db_utils.get_gdal_connection_string(cfg, cfg.LOCAL_PREFIX),),
        "\"{}\"".format(feature_tif_path)
    ]
     */

    let the_fid_field = fid_field.unwrap_or("FID");
    let mut sql = format!("SELECT {} as the_fid FROM \"{}\"",
                          &the_fid_field,
                          &layer_name);
    if let Some(af) = input_layer.attribute_filter.as_ref() {
        sql.push_str(" WHERE ");
        sql.push_str(af);
    }

    let mut options :Vec<&str> = vec![
        "-a", "the_fid",
        "-sql",
        &sql,
        //Use this dialect so we can use FID even with SQL sources
        "-dialect",
        "OGRSQL"
    ];

    if all_touched {
        options.push("-at");
    }

    rasterize(
        &dataset,&output_path, &options
    )?;

    debug!("Done rasterize");

    Ok(())
}