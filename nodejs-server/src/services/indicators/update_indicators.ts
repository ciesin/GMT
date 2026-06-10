
/*
Retrieves the leaf boundary nodes (so usually level=3 / wards) that need updating
 */
import {Job} from "bull";
import {get_current_version_id} from "../../db-read/get_current_version";
import {getPartitionId, pool} from "../../db-read/common";
import {
  getLatestSchemaTableName,
    handle_get_latest_version_from_partitions_impl,
} from "../../db-read/get_latest_version";
import {
  CATCHMENT_STATUS_COMPLETE,
    GeoJsonHealthFacility,
    GeoJsonSettlementName,
    GeoJsonSettlementPart,
    HealthFacilityType,
    PARTICIPATING_PROPERTY,
    UninhabitedOption,
    UNKNOW_UNINHABITED_OPTION,
} from "../../server-interfaces/GeoJson";
import {
    hfEligibleFDC,
    hfNeedsFDC_NeedCoordsUpdate,
    settlementHasPopulationDiscrepencyIssue,
    snEligbleFDC,
    snNeedsFDC_NeedCoordsUpdate,
    snNeedsFDC_NeedNameUpdate
} from "../../server-interfaces/utils/indicator.util";
import {getNumberOrDefault} from "../../server-interfaces/utils/string.util";
import { getSurroundingBoundaryPartionIds } from "../../db-read/get_surrounding_boundaries";

import GMT_CONFIG from "../../config/gmt.config";
import { isEmpty } from "../../server-interfaces/utils/geom.util";
import {RequestAllIndicatorParameters} from "../../api/db-write/indicator_update";

export async function getOperatingBoundariesToProcess(job: Job, jobParameters: RequestAllIndicatorParameters): Promise<Array<string>> {
    await job.log("getOperatingBoundariesToProcess");

    let version = await get_current_version_id();

    if (jobParameters.forceRefresh) {
        //by setting the version to a very high number, we make the query below return everything
        //version id is a bigint, but max int4 should be plenty
        version = 2147483647;
    }

    const to_do = await pool.query(
        {
            text: `
                SELECT ib.boundary_polygon
                FROM indicators.boundary AS ib
                         INNER JOIN boundary.polygon_latest bpl ON ib.boundary_polygon = bpl.global_id
                WHERE (ib.version_id IS NULL or ib.version_id < ${version})
                  AND bpl.level = ${GMT_CONFIG.maxBoundaryLevel}
            `,
            rowMode: 'array',
        });


    await job.log(`getOperatingBoundariesToProcess: ${to_do.rowCount} that have versionId < ${version}`);

    return to_do.rows.map(row => row[0]);
}

export async function updateOperatingBoundary(job: Job, leafBoundaryId: string, enumMap : Map<IndicatorEnumName, Map<string, number>>): Promise<boolean> {

    await job.log(`updateOperatingBoundary start ${leafBoundaryId}`);
    
    const boundaryStats = await computeBoundaryStatsForBoundary(job, leafBoundaryId);
    await job.log(`boundaryStats.level ${boundaryStats.level}`);
    await job.log(`GMT_CONFIG.maxBoundaryLevel ${GMT_CONFIG.maxBoundaryLevel}`);
    if (boundaryStats.level != GMT_CONFIG.maxBoundaryLevel) {
      await job.log(`skipping non operating boundary level ${leafBoundaryId}`);
      return false;
    }

    if (!boundaryStats[PARTICIPATING_PROPERTY]) {
      return await updateNonParticipatingOperatingBoundary(job, leafBoundaryId, enumMap, boundaryStats.version);
    }

    const partitionIdList = await getSurroundingBoundaryPartionIds(leafBoundaryId);

    const hfStats = await computeHfStatsForBoundary(job, leafBoundaryId, enumMap);

    const setStats = await computeSetStatsForBoundary(job, leafBoundaryId, partitionIdList, enumMap);

    const boundary_mp_status = [0,0,0,0];
    const boundary_data_quality = [0,0,0,0];

    //Only count if we have least 1 settlement
    if (setStats.num_set_total > 0) {
      const perc = (setStats.num_set_total - setStats.num_set_mgn) / setStats.num_set_total;
      boundary_data_quality[percToIndex(perc)] = 1;
    }

    //Only count if we have at least 1 fixed post health facility performing RI
    if (hfStats.num_fp_ri > 0) {
      const completedIndex = enumMap.get("hf_microplan_status").get(CATCHMENT_STATUS_COMPLETE);      
      const perc = hfStats.num_fp_mp_status[completedIndex] / hfStats.num_fp_ri;
      boundary_mp_status[percToIndex(perc)] = 1;
    }
    
    
    let varNum = 2;
    const update_query = {
        text: `
            UPDATE indicators.boundary
            SET version_id               = $2,

            num_fp                       = $${++varNum},
            num_fp_ri                    = $${++varNum},
            num_fp_level_of_care         = $${++varNum},
            num_outreach                 = $${++varNum},

            num_fp_mp_status             = $${++varNum},
            num_fp_public                = $${++varNum},
            num_fp_private               = $${++varNum},
            
            num_set_total            = $${++varNum},
            num_set_mgn = $${++varNum},
            num_set_prob = $${++varNum},
            num_set_problematic = $${++varNum},
            num_set_uninhabited = $${++varNum},
            num_set_pop_diff = $${++varNum},

            num_boundary_participating = $${++varNum},
            num_no_hf = $${++varNum},
            num_no_settlements = $${++varNum},
            num_no_geometry = $${++varNum},
            num_boundary_corrections = $${++varNum},

            boundary_mp_status  = $${++varNum},
            boundary_data_quality = $${++varNum},

            boundary_pop = $${++varNum},
            catchment_pop_fp            = $${++varNum},
            catchment_pop_outreach          = $${++varNum},
            catchment_pop_unclaimed         = $${++varNum},
            catchment_pop_problematic       = $${++varNum}
            
            WHERE boundary_polygon = $1
        `,
        values: [
            leafBoundaryId,
            boundaryStats.version,

            hfStats.num_fp,
            hfStats.num_fp_ri,
            hfStats.num_hf_level_of_care,
            hfStats.num_outreach,
            
            hfStats.num_fp_mp_status,
            hfStats.num_fp_public, 
            hfStats.num_fp_private,
            
            setStats.num_set_total,
            setStats.num_set_mgn, 
            setStats.num_set_prob, 
            setStats.num_set_problematic,
            setStats.num_set_uninhabited,
            setStats.num_set_pop_diff,

            1,
            hfStats.num_fp <= 0 ? 1 : 0,
            setStats.num_set_total <= 0 ? 1 : 0,
            boundaryStats.num_no_geometry,
            boundaryStats.num_boundary_corrections,

            boundary_mp_status,
            boundary_data_quality,

            boundaryStats.boundary_pop,
            setStats.catchment_pop_fp,
            setStats.catchment_pop_outreach,
            setStats.catchment_pop_unclaimed,
            setStats.catchment_pop_problematic,

        ],
        rowMode: 'array',
    };

    await pool.query(update_query);
    //await job.log(`getOperatingBoundariesToProcess: ${update_result.rowCount}`);

    await job.log(`updateOperatingBoundary finished: ${leafBoundaryId}`);

    return true;
}

export async function updateNonParticipatingOperatingBoundary(job: Job, leafBoundaryId: string, enumMap : Map<IndicatorEnumName, Map<string, number>>, versionId: number): Promise<boolean> {

  await job.log(`updateNonParticipatingOperatingBoundary start ${leafBoundaryId}`);
  
  

  const emptyFpMpStatus = new Array<number>(enumMap.get("hf_microplan_status").size).fill(0);
  const emptyLevelOfCare = new Array<number>(enumMap.get("hf_level_of_care").size).fill(0);
  const emptyProblematic = new Array<number>(enumMap.get("sn_problematic").size).fill(0);
  const emptyUninhabited = new Array<number>(enumMap.get("sn_uninhabited_reason").size).fill(0);
  
  let varNum = 2;
  const update_query = {
      text: `
          UPDATE indicators.boundary
          SET version_id               = $2,

          num_fp                       = 0,
          num_fp_ri                    = 0,
          num_fp_level_of_care         = $${++varNum},
          num_outreach                 = 0,

          num_fp_mp_status             = $${++varNum},
          num_fp_public                = 0,
          num_fp_private               = 0,
          
          num_set_total            = 0,
          num_set_mgn = 0,
          num_set_prob = 0,
          num_set_problematic = $${++varNum},
          num_set_uninhabited = $${++varNum},
          num_set_pop_diff = 0,

          num_boundary_participating = 0,
          num_no_hf = 0,
          num_no_settlements = 0,
          num_no_geometry = 0,
          num_boundary_corrections = 0,

          boundary_mp_status  = ARRAY[0, 0, 0, 0],
          boundary_data_quality = ARRAY[0, 0, 0, 0],

          boundary_pop = 0,
          catchment_pop_fp            = 0,
          catchment_pop_outreach          = 0,
          catchment_pop_unclaimed         = 0
          
          
          WHERE boundary_polygon = $1
      `,
      values: [
          leafBoundaryId,
          versionId,
          emptyLevelOfCare,
          emptyFpMpStatus,
          emptyProblematic,
          emptyUninhabited,
      ],
      rowMode: 'array',
  };

  await pool.query(update_query);
  //await job.log(`getOperatingBoundariesToProcess: ${update_result.rowCount}`);

  await job.log(`updateOperatingBoundary finished: ${leafBoundaryId}`);

  return true;
}


interface CatchmentInfo {
  health_facility_point: string,

  population_perc: number,

  health_facility_type: HealthFacilityType,

  //uuid of settlement part
  settlement_part: string,
}



async function fetchCatchmentItemsForBoundary(job: Job, leafBoundaryId: string, partitionIdList: Array<number>) : Promise<Map<string, Array<CatchmentInfo>>> {

  //settlement part global id =>  list of catchment items 
  const spIdToCatchmentList = new Map<string, Array<CatchmentInfo>>();

  if (!Array.isArray(partitionIdList) || partitionIdList.length <= 0) {
    await job.log(`${leafBoundaryId} does not contain any surrounding wards, perhaps it has no geometry or the geometry is empty?`);
    return spIdToCatchmentList;
  }

  const leafPartitionId = await getPartitionId(pool, leafBoundaryId);

  if (leafPartitionId == null) {
    await job.log(`${leafBoundaryId} does not contain a partition id`);
    return spIdToCatchmentList;
  }

  //Normally every settlement part in the boundary partition should have their boundary_polygon value == to the boundary associated with that partition
  const spLatestViewName = getLatestSchemaTableName("settlement", "part", leafPartitionId);

  //Because the generated ci / ri items also belong to the same boundary as sp, we don't need to join adj. boundaries

  //See comment ci.rs::create_ci_items
  //and in GeoJsonCatchmentProperties in GeoJson.ts
  const riLatestViewName = getLatestSchemaTableName( "ri", "catchment_item", leafPartitionId);

  //To avoid database problems, do at most CHUNK_SIZE of them at a time
  const CHUNK_SIZE = 5;

  for(let startingIndex = 0; startingIndex < partitionIdList.length; startingIndex += CHUNK_SIZE) {

    const partitionIdSlice = partitionIdList.slice(startingIndex, startingIndex+CHUNK_SIZE);

    //const withRiClause = buildWithClause(partitionIdSlice, "partitions_ri_catchment_item.ri_catchment_item_");
    const withHfClause = buildWithClause(partitionIdSlice, "partitions_health_facility_point.health_facility_point_");
    //const withSpClause = buildWithClause(partitionIdList, "partitions_settlement_part.settlement_part_");

    //We look at the settlement parts in this boundary, though the related catchment items could be part of other boundaries

    //The with statements are causing problems, so run the queries in batches
    //Only generated are needed because excluded won't yield any and includes will create appropriate generated clauses
    const query = `
SELECT 
  ri.health_facility_point, 
  ri.settlement_part,
  ri.population_perc, 
  hf.type as health_facility_type
FROM ${riLatestViewName} ri
INNER JOIN (${withHfClause}) hf on hf.global_id = ri.health_facility_point
INNER JOIN ${spLatestViewName} sp on sp.global_id = ri.settlement_part
WHERE sp.boundary_polygon = '${leafBoundaryId}' AND ri.type = 'generated'
    `;
    const {rows: catchmentItems} = await pool.query(query);

    for (const ci of catchmentItems as Array<CatchmentInfo>) {

      //init array if needed
      if (!spIdToCatchmentList.has(ci.settlement_part)) {
          spIdToCatchmentList.set(ci.settlement_part, []);
      }

      spIdToCatchmentList.get(ci.settlement_part)!.push(ci);
    }
  }

  return spIdToCatchmentList;
}

interface BoundaryStats {
  boundary_pop: number;
  num_no_geometry: number;
  num_boundary_corrections: number;
  [PARTICIPATING_PROPERTY]: boolean;
  level: number;
  
  version: number;
}

async function computeBoundaryStatsForBoundary(job: Job, leafBoundaryId: string) : Promise<BoundaryStats> {
  const query = `  
  SELECT 
  b.computed_pop as boundary_pop, 
  b.geom IS NULL as geom_null,
  ST_IsEmpty(b.geom) as geom_empty,
  COALESCE( (b.properties->'${PARTICIPATING_PROPERTY}')::bool, false) AS ${PARTICIPATING_PROPERTY},
  b.level as level
  FROM boundary.polygon_latest b where global_id = '${leafBoundaryId}'
    `;
  const {rows} = await pool.query(query);
  if (rows.length != 1) {
    job.log(`Expected 1 and only 1 row for boundary ${leafBoundaryId}`);
  }

  //By inspection, resolved entries are not user created edits
  const boundaryEditsCountQuery = `  
  SELECT COUNT(*) as pe_count
  FROM boundary.polygon_edited_latest p 
  WHERE boundary_polygon = '${leafBoundaryId}'
    AND (p.properties->>'is_edit')::boolean IS TRUE
    AND (p.properties->>'resolved')::boolean IS FALSE
    `;
  const {rows: boundaryEditsCountRows} = await pool.query(boundaryEditsCountQuery);
  if (boundaryEditsCountRows.length != 1) {
    job.log(`Expected 1 and only 1 row for boundary ${leafBoundaryId}`);
  }

  const versionId = await get_current_version_id();

  return {
    boundary_pop: rows[0].boundary_pop,
    num_no_geometry: (rows[0].geom_null || rows[0].geom_empty) ? 1 : 0,
    participating: rows[0][PARTICIPATING_PROPERTY],
    level: rows[0].level,
    num_boundary_corrections: boundaryEditsCountRows[0]["pe_count"],
    version: versionId
  }
}

interface HfStats {
    //Is microplan ready means all catchment status == complete
    num_fp_mp_status: number[];
    num_fp_public: number;
    num_fp_private: number;
    num_hf_fdc_required: number;
    num_fp: number;
    num_fp_ri: number,
    num_outreach: number;

    num_hf_level_of_care: Array<number>;
}
async function computeHfStatsForBoundary(job: Job, leafBoundaryId: string, enumMap : Map<IndicatorEnumName, Map<string, number>>) : Promise<HfStats> {
    
    const levelOfCareMap = enumMap.get("hf_level_of_care");
    const mpStatusMap = enumMap.get("hf_microplan_status");
    
    const stats : HfStats = {
        num_fp: 0, 
        num_hf_fdc_required: 0, 
        num_fp_mp_status: new Array<number>(mpStatusMap.size).fill(0), 
        num_fp_private: 0,
        num_fp_public: 0,
        num_fp_ri: 0,
        num_outreach: 0,
        num_hf_level_of_care: new Array<number>(levelOfCareMap.size).fill(0),
    };
    const hfs = await handle_get_latest_version_from_partitions_impl("health_facility",
        "point", [leafBoundaryId]);

    

    await job.log(`Processing ${hfs.list.length} hfs for ${leafBoundaryId}`);

    for (const hf of hfs.list as Array<GeoJsonHealthFacility>) {

      //Hfs without a geometry are currently not counted, they are also not dealt with currently in the problem tab
      if (isEmpty(hf)) {
        continue;
      }
      //await job.log(`Processing HF ${hf.properties.name}`);

      if (hf.properties.type == "outreach") {
        stats.num_outreach += 1;
        continue;
      }

      if (hf.properties.type != "fixed_post") {
        continue;
      }


      const hasRI = hf.properties.services.includes('Routine Immunization');

      if (hasRI) {
        stats.num_fp_ri += 1;
      }
      stats.num_fp += 1;

      //Private can be null, so we don't always count a private or public
      if (hf.properties.private === true) {
        stats.num_fp_private += 1;
      }
      if (hf.properties.private === false) {
        stats.num_fp_public += 1;
      }

      if (hasRI) {
        const index = mpStatusMap.get(hf.properties.mp_status) ?? 0;
        stats.num_fp_mp_status[index] += 1;
      }

      if (hfEligibleFDC(hf) && hfNeedsFDC_NeedCoordsUpdate(hf)) {
          stats.num_hf_fdc_required += 1;
      }

      const levelOfCare = hf.properties.level_of_care ?? "Unknown";

      const index = levelOfCareMap.get(levelOfCare) ?? 0;
      stats.num_hf_level_of_care[index] += 1;
    }

    return stats;
}

interface SettlementStats {
    num_set_total : number;
    
    num_set_mgn: number;
    num_set_prob: number;
    num_set_problematic : number[];
    num_set_uninhabited : number[];
    num_set_pop_diff: number;

    catchment_pop_unclaimed : number;
    catchment_pop_fp : number;
    catchment_pop_outreach: number;
    catchment_pop_problematic: number;
    
    num_set_fdc_required : number;
    num_set_unclaimed : number;
    num_set_multiple_claimed : number;

}

export type IndicatorEnumName = "sn_uninhabited_reason" | "hf_level_of_care" | "sn_problematic" | "hf_microplan_status";
export const allIndicatorEnums: Array<IndicatorEnumName> = ["hf_level_of_care", "sn_uninhabited_reason", "sn_problematic", "hf_microplan_status" ];

export async function getEnumMap(enum_name: IndicatorEnumName) : Promise<Map<string, number>> {
  
  const query = `  
  SELECT enum_range(NULL::${enum_name})::text[] as enum_values;  
    `;
  const {rows} = await pool.query(query);

  //await job.log("Enum map" + JSON.stringify(rows));
    
  //Query returns 1 row with an array of the possible enum values
  const enumValues: Array<string> = rows[0].enum_values;

  const retMap = new Map<string, number>();

  for(const [index, enumString] of enumValues.entries()) {
    retMap.set(enumString, index);
  }

  return retMap;
}

async function computeSetStatsForBoundary(job: Job, leafBoundaryId: string, partitionIdList: Array<number>, enumMap : Map<IndicatorEnumName, Map<string, number>>) : Promise<SettlementStats> {

    const setStats : SettlementStats = {
        catchment_pop_fp: 0,
        catchment_pop_outreach: 0,
        catchment_pop_unclaimed: 0,
        catchment_pop_problematic: 0,
        num_set_fdc_required: 0,
        num_set_multiple_claimed: 0,
        num_set_total: 0,
        num_set_mgn: 0,
        num_set_prob: 0,
        num_set_problematic: [],
        num_set_uninhabited: [],
        num_set_unclaimed: 0,
        num_set_pop_diff: 0,
    };

    const settlements = await handle_get_latest_version_from_partitions_impl("settlement",
        "name", [leafBoundaryId]);

    const parts = await handle_get_latest_version_from_partitions_impl("settlement",
        "part", [leafBoundaryId]);

    const uninhabitedReasonMap = enumMap.get("sn_uninhabited_reason");
    const problematicMap = enumMap.get("sn_problematic");
        
    //Watch list of catchment items per settlement name
    const spIdToCatchmentList = await fetchCatchmentItemsForBoundary(job, leafBoundaryId, partitionIdList);

    //build map from part id to part
    const idToPart = new Map<string, GeoJsonSettlementPart>();
    parts.list.forEach(v => idToPart.set(v.properties.global_id, v as GeoJsonSettlementPart));

    for (const name of settlements.list as Array<GeoJsonSettlementName>) {

        //Ignore sub place names
        if (!name.properties.is_primary) {
            continue;
        }

        const part = idToPart.get(name.properties.settlement_part);

        if (!part) {
            continue;
        }

        if (name.properties.uninhabited) {
          //Check if we need to initialize the problematic array
          if(setStats.num_set_uninhabited.length == 0) {
            setStats.num_set_uninhabited = new Array<number>(uninhabitedReasonMap.size).fill(0);
            //await job.log(`Initialize setStats num_set_uninhabited=${JSON.stringify(setStats.num_set_uninhabited)} map=${JSON.stringify(uninhabitedReasonMap)} size=${uninhabitedReasonMap.size}`);
          }

          const reason: UninhabitedOption = name.properties.uninhabited_reason ?? UNKNOW_UNINHABITED_OPTION;
          const index = uninhabitedReasonMap.get(reason) ?? 0;
          setStats.num_set_uninhabited[index] += 1;

          //await job.log(`Incremented setStats index=${index} reason=${reason} num_set_uninhabited=${JSON.stringify(setStats.num_set_uninhabited)} `);
        }
        if (name.properties.problematic.length > 0) {
          setStats.num_set_prob += 1;

          //Check if we need to intialize the problematic array
          if(setStats.num_set_problematic.length == 0) {
            setStats.num_set_problematic = new Array<number>(problematicMap.size).fill(0);
          }

          for(const p of name.properties.problematic) {
            const index = problematicMap.get(p) ?? 0;
            setStats.num_set_problematic[index] += 1;
          }
        }
        // computeCatchmentItemPop
        setStats.num_set_total += 1;

        const setPop = getNumberOrDefault(part.properties.computed_pop, 0);

        if (settlementHasPopulationDiscrepencyIssue(name, part)) {
          setStats.num_set_pop_diff += 1;
        }

        const ciList: Array<CatchmentInfo> = spIdToCatchmentList.get(part.properties.global_id) || [];

        let cPopTotal = 0;

        for (const ci of ciList) {
          const cPop = (ci.population_perc / 100.0) * setPop;

          //await job.log(`For ${name.properties.name} ci % ${ci.population_perc} guid ${ci.health_facility_point}`);

          if (ci.health_facility_type == "fixed_post") {
            setStats.catchment_pop_fp += cPop;            
          } else if (ci.health_facility_type == "outreach") {
            setStats.catchment_pop_outreach += cPop;
          }

          if (name.properties.problematic.length > 0) {
            setStats.catchment_pop_problematic += cPop;
          }

          cPopTotal += cPop;
        }

        //await job.log(`For ${name.properties.name} unclaimed ${setPop} - ${cPopTotal} == ${setPop - cPopTotal}`);

        setStats.catchment_pop_unclaimed += setPop - cPopTotal;

        if (snNeedsFDC_NeedNameUpdate(name)) {
          setStats.num_set_mgn += 1;
        }

        if (snEligbleFDC(name) && (snNeedsFDC_NeedCoordsUpdate(name) || snNeedsFDC_NeedNameUpdate(name))) {
            setStats.num_set_fdc_required += 1;
        }
    }

    return setStats;
}


export async function pruneTable(job: Job) {
    await job.log("Pruning entries for deleted boundaries");

    const num_deleted = await pool.query(
        `
            DELETE
            FROM indicators.boundary ib
            WHERE ib.boundary_polygon NOT IN
                  (
                      SELECT global_id
                      FROM boundary.polygon_latest bpl
                  )`);


    await job.log(`Num deleted: ${num_deleted.rowCount}`);
}

export async function initEntries(job: Job) {
    await job.log("Initializing entries");

    const num_initialized = await pool.query(
        `
            INSERT INTO indicators.boundary AS ib
            SELECT bpl.global_id
            FROM boundary.polygon_latest bpl
            WHERE bpl.global_id NOT IN
                  (
                      SELECT ib_inner.boundary_polygon
                      FROM indicators.boundary ib_inner
                  )`);


    await job.log(`Num initialized: ${num_initialized.rowCount}`);
}


export async function updateNonLeafLevel(job: Job, level: number) {

    //const version = await get_current_version_id();
    //--WHERE (ib.version_id IS NULL or ib.version_id < ${version})

    const {rows: columnList} = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'indicators' 
          AND table_name = 'boundary'
          AND column_name not in ('boundary_polygon', 'version_id');
    `);
    //const tableColumns: Array<string> = column_list.map(cl => cl.column_name);

    const sumClause = columnList.map(row => (row.data_type == 'ARRAY' ? 'array_sum' : 'sum') + `(${row.column_name}) as ${row.column_name}`
    ).join(',\n');
    const assignClause = columnList.map(row => `${row.column_name} = u.${row.column_name}`).join(',\n');

    const update_query = {
        text: `
            with boundary_ids as 
            (
              SELECT boundary_polygon as level${level}_id, global_id as level${level + 1}_id
              FROM boundary.polygon_latest level${level + 1}
              WHERE level${level + 1}.level = ${level + 1}
            ), updates as 
            (
            SELECT
                level${level}_id,
                min (version_id) as version_id,
                ${sumClause}
            FROM indicators.boundary ib
              INNER JOIN boundary_ids
              ON boundary_ids.level${level + 1}_id = ib.boundary_polygon
            GROUP BY level${level}_id
            )
            UPDATE indicators.boundary
            SET version_id               = u.version_id,
            ${assignClause}
            FROM updates u
            WHERE boundary_polygon = u.level${level}_id
        `
        , rowMode: 'array',
    };

    let presult = await pool.query(update_query);

    await job.log(`Aggregrated update for level ${level}: ${presult.rowCount}`);

}

type PREFIX = "partitions_settlement_part.settlement_part_" | "partitions_settlement_name.settlement_name_" | "partitions_ri_catchment_item.ri_catchment_item_" | "partitions_health_facility_point.health_facility_point_";
function buildWithClause(partitionIdList: Array<number>, prefix: PREFIX) : string {
  let sqlClauses = [];
  for(const partitionId of partitionIdList) {
    sqlClauses.push(`SELECT * FROM ${prefix}${partitionId.toString().padStart(5, '0')}_latest`);
  }
  return sqlClauses.join(" UNION ALL ");
}

function percToIndex(perc: number) : number {
  //0 to 20%
  if (perc < 0.2) {
    return 0;
  }
  //[20,50)
  if (perc < 0.5) {
    return 1;
  }
  //[50, 80)
  if (perc < 0.8) {
    return 2;
  }
  return 3;
}