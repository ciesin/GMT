use std::collections::{HashSet, HashMap};
use uuid::Uuid;
use anyhow::Result;
use postgres::binary_copy::BinaryCopyInWriter;
use postgres::{Client, Transaction};
use postgres::types::Type;
use geos::{SimpleContextHandle, SimpleGeometry};
use serde::{Deserialize, Serialize};
use log::{debug};
use crate::boundary::BoundaryIds;

use crate::sp::{AllSpInfo, };
use crate::hf::{HfInfo,};

#[derive(Eq, Hash, PartialEq, Serialize, Deserialize, Clone)]
pub(crate) struct ExcludedKey {
    pub(crate) hf_guid: Uuid,
    pub(crate) sp_guid: Uuid,
}



pub(crate) fn create_ci_items(
    client: &mut Transaction,
    data: &AllSpInfo,
    hf_info: &HfInfo,
    boundary_id: u32,
    boundary_guid: &Uuid,
) -> Result<()> {


    let version_id_rows = client.query("
SELECT max(id) FROM master.commits;
    ", &[]).unwrap();

    let version_id: i64 = version_id_rows[0].get(0);

    client.execute(&format!("
    DELETE FROM
    partitions_ri_catchment_item.ri_catchment_item_{boundary_id:0>5} ci
    WHERE type = 'generated'
    "), &[])?;


    let copy_sql = format!("
COPY partitions_ri_catchment_item.ri_catchment_item_{boundary_id:0>5}
(

    global_id,
    version_id,
    boundary_polygon,
    geom,

    settlement_part,
    health_facility_point,

    population_perc,
    properties
) FROM STDIN BINARY
", boundary_id = boundary_id);


    let hf_items = &hf_info.hf_list;

    let context = SimpleContextHandle::new();
    let geom_point = SimpleGeometry::create_point_xy(&context,
                                                     0.0,
                                                     0.0).unwrap();
    geom_point.set_srid(4326);

    let ewkb = geom_point.ewkb()?;

    //let pg_conn = PgConnection::new(&args.gmt_database_pg_conn)?;
    let copy_writer = client.copy_in(&copy_sql).unwrap();
    let mut bin_writer = BinaryCopyInWriter::new(copy_writer, &[
        Type::UUID,
        Type::INT8,
        Type::UUID,
        Type::BYTEA,
        Type::UUID,
        Type::UUID,
        Type::FLOAT4,
        Type::JSONB,
    ]);


    let empty_json: serde_json::Value = serde_json::from_str("{}")?;

    let mut num_items = 0;

    for (sp_idx, sp_catchment_info) in data.vec_sp_catchment_info.iter().enumerate() {

        let sp_info = &data.vec_sp_info[sp_idx];

        //Settlement parts are filtered for primary/uninhabited in the 1st python step

        //Non excluded ri.catchment_items are owned by the settlement part
        //Excluded are owned by the health facility
        if sp_info.boundary_id != boundary_id {
            continue;
        }

        let total_sp_pop = sp_catchment_info.hf_map.total_pop as f32;

        // //Prune, must be at least 1% of total population
        // let min_pop = (total_sp_pop / 100.0) as f64;
        //
        // let mut pruned_hf_map = sp_catchment_info.hf_map.clone();
        //
        // pruned_hf_map.retain( |hf_guid, sp_value| {
        //     if hf_guid == &HF_GUID_NONE {
        //         return false;
        //     }
        //     sp_value.get_pop() >= min_pop
        // });
        //
        // //get new total
        // let total_sp_pop = pruned_hf_map.iter().fold(0.0, |acc, (_key, value)| {
        //     acc + value.get_pop()
        // }) as f32;

        for (&hf_index, &sp_value) in sp_catchment_info.hf_map.hf_idx_to_pop.iter() {

            //let hf_index = hf_info.guid_to_index[hf_guid];
            let hf = &hf_items[hf_index];

            let population_perc = 100.0 * sp_value as f32 / total_sp_pop;

            let global_id = Uuid::new_v4();

            num_items += 1;

            bin_writer.write(&[
                &global_id,
                &version_id,
                boundary_guid,
                &ewkb.as_ref(),
                &sp_info.sp_guid,
                &hf.global_id,
                &population_perc,
                &empty_json
                //https://stackoverflow.com/questions/35600070/postgres-jsonb-specification-for-copy-in-binary-format
                // pg_conn.copy_data(&3i32.to_be_bytes())?;
                // pg_conn.copy_data(&[1])?;
                // pg_conn.copy_data(&"{}".as_bytes())?;
            ]).unwrap();
        }

    }

    let num_updated = bin_writer.finish().unwrap();
    debug!("CI Num updated in db {} {}", num_updated, num_items);

    client.execute(
        &format!("REFRESH MATERIALIZED VIEW partitions_ri_catchment_item.ri_catchment_item_{boundary_id:0>5}_latest"),
        &[]).unwrap();

    Ok(())
}


pub(crate) fn get_exclusions(client: &mut Client,
                  boundary_ids: &BoundaryIds,
) -> Result<HashSet<ExcludedKey>> {

    let mut ret = HashSet::new();

    for b_id_info in boundary_ids.id_list.iter() {

        if !b_id_info.in_update_set {
            continue;
        }

        let boundary_id = b_id_info.boundary_id;

        let rows = client.query(&format!("
    SELECT health_facility_point, settlement_part
    FROM partitions_ri_catchment_item.ri_catchment_item_{boundary_id:0>5}_latest ci
    INNER JOIN partitions_health_facility_point.health_facility_point_{boundary_id:0>5}_latest hf
    ON ci.health_facility_point = hf.global_id
    WHERE ci.type = 'exclude'"), &[]).unwrap();


        for row in rows.iter()
        {
            let hf_guid = row.get::<_, Uuid>(0);
            let sp_guid: Uuid = row.get(1);

            ret.insert(ExcludedKey {
                hf_guid,
                sp_guid,
            });
        }
    }

    Ok(ret)
}

pub (crate) type SettlementToHealthFacilityInclusion = HashMap<Uuid, Vec<Uuid>>;

// Returns map of settlement point id => list of health facility ids explicitly included
pub(crate) fn get_inclusions(client: &mut Client,
  boundary_ids: &BoundaryIds,
) -> Result<SettlementToHealthFacilityInclusion> {

  let mut ret: HashMap<Uuid, Vec<Uuid>> = HashMap::new();

  for b_id_info in boundary_ids.id_list.iter() 
  {

    if !b_id_info.in_update_set {
      continue;
    }

    let boundary_id = b_id_info.boundary_id;

    //Might be a good idea to add constraints on the ri partition table, one per hf / sp guid pair
    //We still assume there are no dups 
    let rows = client.query(&format!("
    SELECT health_facility_point, settlement_part
    FROM partitions_ri_catchment_item.ri_catchment_item_{boundary_id:0>5}_latest ci
    INNER JOIN partitions_health_facility_point.health_facility_point_{boundary_id:0>5}_latest hf
    ON ci.health_facility_point = hf.global_id
    WHERE ci.type = 'include'"), &[]).unwrap();


    for row in rows.iter()
    {
      let hf_guid = row.get::<_, Uuid>(0);
      let sp_guid: Uuid = row.get(1);

      let current_health_facilities = ret.entry(sp_guid).or_insert_with(|| Vec::new());

      current_health_facilities.push(hf_guid);
    }
  }

  Ok(ret)
}

pub(crate) fn get_custom_catchment_health_facility_ids(client: &mut Client,
  boundary_ids: &BoundaryIds,
) -> Result<HashSet<Uuid>> {

  let mut ret: HashSet<Uuid> = HashSet::new();

  for b_id_info in boundary_ids.id_list.iter() 
  {

    if !b_id_info.in_update_set {
      continue;
    }

    let boundary_id = b_id_info.boundary_id;

    //Might be a good idea to add constraints on the ri partition table, one per hf / sp guid pair
    //We still assume there are no dups 
    let rows = client.query(&format!("
    SELECT health_facility_point
    FROM partitions_ri_catchment_item.ri_catchment_item_{boundary_id:0>5}_latest ci    
    WHERE ci.type = 'include'"), &[]).unwrap();


    for row in rows.iter()
    {
      let hf_guid = row.get::<_, Uuid>(0);
      

      ret.insert(hf_guid);
    }
  }

  Ok(ret)
}
