use uuid::Uuid;
use postgres::{Transaction};
use anyhow::Result;
use log::debug;
use gdal::spatial_ref::SpatialRef;
use gdal::vector::{Geometry, OGREnvelope, OGRwkbGeometryType};

pub(crate) struct BoundaryInfo {
  pub(crate) boundary_id: u32,
  //pub(crate) boundary_guid: Uuid,
  pub(crate) envelope: OGREnvelope,
}


/// returns boundary_id, boundary_guid pairs
pub(crate) fn get_boundary(
    client: &mut Transaction,
    boundary_guid: &Uuid ) -> Result<BoundaryInfo> {


    let boundary_query = format!("

SELECT bid.id, bid.global_id,
    ST_AsBinary(b.geom, 'XDR')
    FROM boundary.polygon_latest b
INNER JOIN partitions.boundary_id bid ON bid.global_id = b.global_id
    WHERE b.global_id = $1
", );

    let results = client.query(&boundary_query, &[&boundary_guid]).unwrap();

    assert_eq!(1, results.len());

    let boundary_row = &results[0];

    let boundary_id = boundary_row.get::<_,i32>(0) as u32;
    //let boundary_guid = boundary_row.get(1);
    let geom_bytes: Vec<u8> = boundary_row.get(2);

    //Even if we don't need a db update (updating settlement part)
    //We still need to compute the stuff for catchment items

    let mut gdal_geom = Geometry::empty(OGRwkbGeometryType::wkbMultiPolygon)?;

    // debug!("Importing bytes {}", buf.len());
    gdal_geom.import_ewkb_bytes_raw(&geom_bytes).unwrap();

    let envelope = gdal_geom.envelope();

    debug!("Retrieved boundary");

    Ok( BoundaryInfo {
        boundary_id,
        //boundary_guid,
        envelope
    })
}


pub(crate) fn get_laea_spatial_ref(extent: &OGREnvelope) -> Result<SpatialRef> {
    let center_x = (extent.MinX + extent.MaxX) / 2.0;
    let center_y = (extent.MinY + extent.MaxY) / 2.0;

    let laea = SpatialRef::from_proj4(&format!(
        "+proj=laea +lat_0={} +lon_0={} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
        center_y, center_x
    ))?;

    Ok(laea)
}