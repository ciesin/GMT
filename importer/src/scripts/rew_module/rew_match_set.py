import json
import uuid
from pathlib import Path
from typing import List
import psycopg2.extensions
import psycopg2.extras
from tabulate import tabulate
from scripts.rew_module.rew_helpers import print_db_rows

from scripts.rew_module.rew_parse import DB_CONSTANTS

REW_TO_REMOVE = ['ung', 'gabas', 'l/gidan', 'fulani', 'gidan', 'unguwar']    
GMT_TO_REMOVE = ['unguwar', 'gabas', 'gidan', 'fulanin', 'fulani', 'layin']
CHOICES_BASE_PATH = Path("/data/rew/choices")    

def get_sn_regex(source_sql: str, strs_to_remove: List[str]) -> str:    
    src = source_sql 
    
    # case insensitive
    # positive look behind of \W matches any non-word character, like [^[:word:]]
    # or beginning
    # then what we are looking for
    # then space or end
    for rem in strs_to_remove:
        src = fr"""regexp_replace({src}, '(?i)(?<=\W|^){rem}(\s|$)', '')"""   

    return src     

def get_rew_sn_regex(source_sql: str, strs_to_remove: List[str]) -> str:
    
    
    src = source_sql 
    
    # case insensitive
    # positive look behind of \W matches any non-word character, like [^[:word:]]
    # or beginning
    # then what we are looking for
    # then space or end
    for rem in strs_to_remove:
        src = rf"""regexp_replace({src}, '(?i)(?<=\W|^){rem}(\s|$)', '')"""   

    return src   


def get_cte_sn_ids_in_catchment() -> str:
    
    return f"""
sn_ids_catch AS (
    --Also get outreaches
    --Distinct is because same settlement can be in outreach + fixed post
    --And because include + generated
    SELECT DISTINCT 
        sn.global_id as sn_guid, 
        r_hf.id as hf_id, 
        TRUE as in_catch 
    FROM
    {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r_hf 
    INNER JOIN partitions.hf_view_latest hf 
        ON hf.global_id = r_hf.global_id OR hf.parent = r_hf.global_id
    INNER JOIN partitions.ci_view_latest ci 
        ON ci.health_facility_point = hf.global_id and ci.type != 'exclude'
    INNER JOIN partitions.sp_view_latest sp 
        ON sp.global_id = ci.settlement_part
    INNER JOIN partitions.sn_view_latest sn 
        ON sn.settlement_part = sp.global_id
    WHERE sn.is_primary
        AND r_hf.gmt_state = %(state_name)s
        AND r_hf.gmt_lga = %(lga_name)s
)
    """
    

def match_gmt_sets_obvious(cur: psycopg2.extensions.cursor, lga_name: str, state_name: str):
    
    # Match settlements with something in the same ward, in the catchment
    # and with a high similiarity score    
    sql = f"""
WITH 
--only select settlements in catchment
{get_cte_sn_ids_in_catchment()},    
best_match AS (
    select DISTINCT ON (r_hf.file_path,
            sn.global_id,
            r_set.name)
        r_hf.file_path,
        sn.global_id,
        r_set.name,
        similarity(sn.name, r_set.name) as sim
    from sn_ids_catch sn_ids
        inner join partitions.sn_view_latest sn on sn.global_id = sn_ids.sn_guid
        inner join {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} r_set 
            on r_set.hf_id = sn_ids.hf_id
        inner join {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r_hf 
            on r_hf.id = sn_ids.hf_id
        inner join partitions.hf_view_latest gmt_hf 
            ON gmt_hf.global_id = r_hf.global_id
        inner join boundary.polygon_latest b3 
            on b3.global_id = gmt_hf.boundary_polygon
        inner join boundary.polygon_latest b2 
            on b2.global_id = b3.boundary_polygon
        inner join boundary.polygon_latest b1 
            on b1.global_id = b2.boundary_polygon
    WHERE 
        -- same ward
        gmt_hf.boundary_polygon = sn.boundary_polygon 
        
        -- The current GMT LGA being processed
        AND b2.name = %(lga_name)s AND b1.name = %(state_name)s
    ORDER BY r_hf.file_path,
            sn.global_id,
            r_set.name, sim DESC
    
)
select *
    from best_match bm
    where sim > 0.99
    """
    
    dict_args = {'lga_name': lga_name, 'state_name': state_name}
    cur.execute(sql, dict_args)
        
    best_matches = cur.fetchall()
    
    print(f"Obvious matches in catchment, ward, and matching name - {len(best_matches)}")
    
    for filePath, snGuid, rewSetName, simScore in best_matches:
        # print(f"Applying {filePath} {snGuid} {rewSetName} with sim score {simScore}")
        
#         cur.execute(f"""
# UPDATE {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} as set
# SET global_id = %s
# FROM {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} hf 
# WHERE hf.file_path = %s
# AND set.name = %s
# AND hf.id = set.hf_id
#                     """, (snGuid, filePath, rewSetName))
        cur.execute(f"""
    INSERT INTO {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET_M2M} 
    (set_id, global_id)
    SELECT set.id, %s
    FROM {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} set
    INNER JOIN {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} hf 
        ON hf.id = set.hf_id
    WHERE hf.file_path = %s
        AND set.name = %s
                            """, (snGuid, filePath, rewSetName))
        
        if cur.rowcount != 1:
            raise Exception(f"Row count != 1, was {cur.rowcount}\nfile path: [{filePath}] snGuid: {snGuid} Name: {rewSetName}")


def match_gmt_chosen(cur, lga_name):
    
    choices_path = CHOICES_BASE_PATH / f"{lga_name}.json"
    
    try:
        with open(choices_path, 'r') as file:
            choices_list = json.load(file)
    except FileNotFoundError:
        choices_list = []  # If the file does not exist, start with an empty list
                 
    # zero_guid = str(uuid.UUID(int=0))   
    
    to_check = []              

    print(f"Applying {len(choices_list)}")
    for choice in choices_list:
        filePath = choice["file_path"]
        sn_guid = choice["SN Guid"]
        rew_set_name = choice["REW name"]
    
#         cur.execute(f"""
# UPDATE {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} as set
# SET global_id = %s
# FROM {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} hf 
# WHERE hf.file_path = %s
# AND set.name = %s
# AND hf.id = set.hf_id
#                     """, (sn_guid, filePath, rew_set_name))
        cur.execute(f"""
    INSERT INTO {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET_M2M}
    (set_id, global_id)
    SELECT set.id, %s
    FROM  {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} as set
    INNER JOIN {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} hf 
        ON hf.id = set.hf_id
    WHERE hf.file_path = %s
        AND set.name = %s        
                    """, (sn_guid, filePath, rew_set_name))
        
        assert cur.rowcount <= 1
        
        if cur.rowcount != 1:
            assert  cur.rowcount == 0
            print(f"Did not find [{filePath}] set name rew [{rew_set_name}], going to check later for {sn_guid}")
            to_check.append( (sn_guid, filePath,) )
            

    # Once we have set everything, check ones we couldn't apply
    # If this settlement was merged, the settlement name might not exist anymore
    
    for to_check_args in to_check:
        # so it's ok if we find something with same global_id, fitle path but not the name
        cur.execute(f"""
SELECT set.id, set.name
FROM {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} set 
INNER JOIN {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET_M2M} m2m
    on m2m.set_id = set.id
INNER JOIN {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} hf 
    ON hf.id = set.hf_id
WHERE m2m.global_id = %s AND hf.file_path = %s
--merged should have both
AND set.anc IS NOT NULL 
AND set.type IS NOT NULL 
""", to_check_args)
        r = cur.fetchall()
        
        sn_guid, filePath = to_check_args
        if len(r) == 0:
            raise Exception(f"Row count != 1, was {cur.rowcount}\nfile path: [{filePath}] snGuid: {sn_guid}")
        else:
            rew_set_name = r[0][1]
            print(f"Settlement was merged -- file path: [{filePath}] Name: {rew_set_name}")
        
        
    print(f"Finished Applying {len(choices_list)}")
   

def show_stl_missing(conn, lga_name, state_name):
    # Show cases where a settlement is not in the GMT Settlements tab
    sql = f"""
    --Find all settlements matched
select b1.name, b2.name, b3.name, s.name, m2m.global_id, sn.uninhabited, sn.estimated_pop, sp.computed_pop

from {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} s
INNER JOIN {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET_M2M} m2m on m2m.set_id = s.id
inner join partitions.sn_view_latest sn  on sn.global_id = m2m.global_id
inner join partitions.sp_view_latest sp  on sp.global_id = sn.settlement_part
inner join boundary.polygon_latest b3 on b3.global_id = sn.boundary_polygon
inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
where m2m.global_id != '00000000-0000-0000-0000-000000000000'
--exclude if in catchment
and not exists (
    select 1 from partitions.hf_view_latest hf
    inner join boundary.polygon_latest b3 on b3.global_id = hf.boundary_polygon
    inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
    inner join partitions.ci_view_latest ci on ci.health_facility_point = hf.global_id and ci.type != 'exclude'
    inner join partitions.sp_view_latest sp  on sp.global_id = ci.settlement_part
    inner join partitions.sn_view_latest sn  on sn.settlement_part = sp.global_id
    WHERE b2.name = %(lga_name)s
        and b1.name = %(state_name)s
    and sn.global_id = m2m.global_id
)
--exclude if in LGA via attribute
AND NOT EXISTS (
    SELECT 1 FROM partitions.sn_view_latest sn
    inner join boundary.polygon_latest b3 on b3.global_id = sn.boundary_polygon
    inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
    inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
    WHERE b2.name = %(lga_name)s
        and b1.name = %(state_name)s
        AND sn.is_primary
)
--and not sn.uninhabited

order by global_id
;
"""
    print_db_rows(
        conn, sql, 
        "Rows matched with REW that are not in the GMT - Stls tab", 
        {
            'lga_name': lga_name,
            'state_name': state_name
        })
    


def consolidate_matches(conn: psycopg2.extensions.connection):
    """
    For same REW hf, we want to combine entries that
    have different REW names but match the same GMT settlement
    Where one is only in target pop sheet 
    and the other is only in the Catchment area services sheet
    
    The Catchment area services sheet entry will be deleted
    and merged into the target population sheet
    """
    
    # just see matches
    sql = f"""
CREATE TEMPORARY TABLE temp_rew_set_to_merge AS    
WITH m2m_agg AS (
    select 
        m2m.set_id, 
        array_agg(m2m.global_id ORDER BY m2m.global_id) as global_id_array
    from {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET_M2M} m2m
    WHERE m2m.global_id != '00000000-0000-0000-0000-000000000000'
    group by m2m.set_id
)    
select 
    --we can have multiple so we want to merge just 2
    DISTINCT ON (s_tp.id)
    s_tp.id as s_tp_id,
    --Catchment area services
    s_cas.id as s_cas_id,
    case 
        when length(s_tp.name) >= length(s_cas.name) then s_tp.name
        else s_cas.name
    end as rew_set_name,
    s_cas.*
from {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} s_tp
INNER JOIN m2m_agg m2m_agg_tp 
    ON m2m_agg_tp.set_id = s_tp.id
INNER JOIN {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} s_cas
    ON s_tp.hf_id = s_cas.hf_id
        and s_tp.id != s_cas.id
INNER JOIN m2m_agg m2m_agg_cas
    ON m2m_agg_cas.set_id = s_cas.id    
where
    s_tp.type IS NOT NULL
    AND s_cas.anc IS NOT NULL
    AND (s_tp.anc is null) <> (s_cas.anc is null)
    and (s_tp.type is null) <> (s_cas.type is null)
    --all sorted m2m matches are the same
    AND m2m_agg_cas.global_id_array = m2m_agg_tp.global_id_array
order by s_tp.id, similarity(s_tp.name, s_cas.name) DESC
;
"""
    with conn.cursor() as cur:
        cur.execute(sql)
        
        conn.commit()

    sql = f"""
select 
    s_tp.name as "Target Pop Name", 
    s_cas.name as "Catchment Area Services Name", 
    s_tp.id as "Target Pop Id", 
    s_cas.id as "Catchment Area Services Id", 
    sn.name as "GMT Set Name",
    m.rew_set_name as "To set name"
    
    --Will always be true false false true 
    --s_tp.anc is null as "S1 missing cas",
    --s_cas.anc is null as "S2 missing cas",
    --s_tp.type is null as "S1 missing tp",
    --s_cas.type is null as "S2 missing tp"    
from 
temp_rew_set_to_merge m
inner join {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} s_tp
    on m.s_tp_id = s_tp.id
inner join {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} s_cas
    on m.s_cas_id = s_cas.id        
--the same so just join cas
inner join {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET_M2M} m2m    
    on m2m.set_id = s_cas.id
inner join partitions.sn_view_latest sn
    on sn.global_id = m2m.global_id
   
    """
    
    print_db_rows(conn, sql, "Going to merge these")
               
    # print_db_rows(conn, "SELECT * FROM temp_rew_set_to_merge", "raw temp table")
    
    sql = f"""
DELETE FROM {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET_M2M} m2m
WHERE m2m.set_id IN (
    SELECT s_cas_id FROM temp_rew_set_to_merge
);

DELETE FROM {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} s
WHERE s.id IN (
    SELECT s_cas_id FROM temp_rew_set_to_merge
);

UPDATE {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} AS s
SET 
    name = t.rew_set_name,

    dist_fp = t.dist_fp,
    dist_out = t.dist_out,
    dist_mobile = t.dist_mobile,
    
    sessions = t.sessions,
    ri_yes_no = t.ri_yes_no,
    anc = t.anc,
    labour_delivery = t.labour_delivery,
    family_planning = t.family_planning
FROM temp_rew_set_to_merge t 
WHERE t.s_tp_id = s.id;

    """
    
    with conn.cursor() as cur:
        cur.execute(sql)
        
        conn.commit()
    

def get_ranked_matches_sql() -> str:
    sql = f"""
--look at settlement name matches
--Match the HF and create a bbox
with gmt_lga_sns AS (
    SELECT
        sn.global_id
    FROM partitions.sn_view_latest sn          
    inner join boundary.polygon_latest b3 
        on b3.global_id = sn.boundary_polygon
    inner join boundary.polygon_latest b2 
        on b2.global_id = b3.boundary_polygon
    inner join boundary.polygon_latest b1 
        on b1.global_id = b2.boundary_polygon
    WHERE b2.name = %(lga_name)s
        and b1.name = %(state_name)s
        AND sn.is_primary
), 
--Any settlement in a catchment in this LGAs HFs
gmt_lga_catch_sns AS (
    
    select sn.global_id 
    from partitions.hf_view_latest hf
    inner join boundary.polygon_latest b3 
        on b3.global_id = hf.boundary_polygon
    inner join boundary.polygon_latest b2 
        on b2.global_id = b3.boundary_polygon
    inner join boundary.polygon_latest b1 
        on b1.global_id = b2.boundary_polygon
    inner join partitions.ci_view_latest ci 
        on ci.health_facility_point = hf.global_id 
            and ci.type != 'exclude'
    inner join partitions.sp_view_latest sp 
        on sp.global_id = ci.settlement_part
    inner join partitions.sn_view_latest sn 
        on sn.settlement_part = sp.global_id
    WHERE b2.name = %(lga_name)s
        and b1.name = %(state_name)s
        and sn.is_primary
),
sn_available_ids AS (
    select distinct global_id
    from (
        select * FROM gmt_lga_sns UNION select * from gmt_lga_catch_sns
    ) sq    
),
--Large bbox around all HFs
hf_bbox AS (
    SELECT
        r_hf.id as hf_id,
        ST_Transform(
            ST_SetSRID(
                ST_MakeBox2D(
                    ST_Point(
                        ST_XMin(envelope_3857) - %(buffer_size)s,
                        ST_YMin(envelope_3857) - %(buffer_size)s
                    ),
                    ST_Point(
                        ST_XMax(envelope_3857) + %(buffer_size)s,
                        ST_YMax(envelope_3857) + %(buffer_size)s
                    )
                ),
                3857
            ),
            4326
        ) AS geom
    FROM
        {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r_hf
    INNER JOIN partitions.hf_view_latest gmt_hf ON r_hf.global_id = gmt_hf.global_id
    CROSS JOIN LATERAL (
        SELECT ST_Transform(ST_Envelope(gmt_hf.geom), 3857) AS envelope_3857
    ) AS sq_env
    WHERE r_hf.gmt_state = %(state_name)s
        AND r_hf.gmt_lga = %(lga_name)s
),
  --Get all sn ids either in the bbox
sn_ids_geo AS (
    SELECT sn.global_id as sn_guid, hf_bbox.hf_id as hf_id,
        False as in_catch
    FROM
    sn_available_ids
    INNER JOIN partitions.sn_view_latest sn
        ON sn_available_ids.global_id = sn.global_id
    INNER JOIN hf_bbox 
        ON ST_Intersects(hf_bbox.geom, sn.geom)
    --not needed but doesn't hurt since we joined on sn_available_ids  
    WHERE sn.is_primary
),  
--this is to know exactly which catchment
{get_cte_sn_ids_in_catchment()},
sn_ids_all AS (
    select distinct on (sn_guid, hf_id) *
    from (
        select * FROM sn_ids_geo UNION select * from sn_ids_catch
    ) sq    
    --in catch true first
    order by sn_guid, hf_id, in_catch desc
),
sim_scores AS (
    select r_set.name, sn.name as gmt_name,
        similarity(
            {get_sn_regex('r_set.name', REW_TO_REMOVE)}, 
            {get_sn_regex('sn.name', GMT_TO_REMOVE)}
            ) as sim,
        sn_ids.hf_id, r_set.id as set_id, sn.geom as gmt_sn_geom,
        sn_ids.in_catch, 
        sn_ids.sn_guid,
        gmt_hf.boundary_polygon = sn.boundary_polygon as in_ward,
        ST_Distance(sn.geom::geography, gmt_hf.geom::geography) as dist
    from sn_ids_all sn_ids
    inner join partitions.sn_view_latest sn on sn.global_id = sn_ids.sn_guid
    inner join {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} r_set on r_set.hf_id = sn_ids.hf_id
    inner join {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r_hf on r_hf.id = sn_ids.hf_id
    inner join partitions.hf_view_latest gmt_hf ON gmt_hf.global_id = r_hf.global_id
), with_rank as (
    SELECT  ROW_NUMBER() OVER (
        PARTITION BY hf_id, set_id 
        ORDER BY (
            sim + 
            case when in_ward then 0.1 else 0 end +
            case when in_catch then 0.25 else 0 end +
            -- 10,000 meters == -0.1
            -- 1,000 meters == -0.01
            -dist / 100000
        ) DESC
    ) AS rank, *
    FROM sim_scores
)
select r_hf.file_path,
    gmt_hf.name,
    wr.sn_guid,
    r_set.name as "REW Set Name", gmt_name, 
    --remove common terms
    {get_rew_sn_regex('r_set.name', REW_TO_REMOVE)} as "REW Set Name xformed",
    {get_sn_regex('gmt_name', GMT_TO_REMOVE)} as "GMT Name xformed",
    wr.rank, wr.sim,
    wr.dist,
    wr.in_catch,
    wr.in_ward
from with_rank wr
inner join {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r_hf on r_hf.id = wr.hf_id
inner join {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} r_set on r_set.id = wr.set_id
inner join partitions.hf_view_latest gmt_hf ON gmt_hf.global_id = r_hf.global_id
inner join partitions.sn_view_latest gmt_sn ON gmt_sn.global_id = wr.sn_guid
inner join boundary.polygon_latest gmt_sn_b3 on gmt_sn_b3.global_id = gmt_sn.boundary_polygon
inner join boundary.polygon_latest gmt_hf_b3 on gmt_hf_b3.global_id = gmt_hf.boundary_polygon
where wr.rank <= 10 
    --still unmatched
    and NOT EXISTS (
        SELECT 1 FROM {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET_M2M} m2m 
        WHERE m2m.set_id = r_set.id
    ) --r_set.global_id is null
order by r_hf.file_path, r_set.name, wr.rank
;
"""
    return sql 
   
    
def match_gmt_sets(conn: psycopg2.extensions.connection, lga_name: str, state_name: str):
    """
    :param conn: 
    :param lga_name: GMT Lga name
    :param state_name: GMT State name
    """    

    # the settlements we want to consider are the ones in the GMT - STL excel sheet
    # These are all the settlements attributed to the LGA
    # + any settlement in a catchment
    
    with conn.cursor() as cur:
        # clear all matches
        dict_args = {'lga_name': lga_name, 'state_name': state_name}
        cur.execute(f"""
--UPDATE {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET}
--set global_id = null;
DELETE FROM {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET_M2M} m2m_del
WHERE m2m_del.set_id IN (
    SELECT set_id FROM 
        {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET_M2M} r_m2m
        INNER JOIN {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} r_set 
            ON r_m2m.set_id = r_set.id   
        INNER JOIN {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r_hf 
            ON r_set.hf_id = r_hf.id
    WHERE r_hf.gmt_state = %(state_name)s
        AND r_hf.gmt_lga = %(lga_name)s
)
                    """, dict_args)
                
        match_gmt_sets_obvious(cur, lga_name, state_name)
        
        match_gmt_chosen(cur, lga_name)

    conn.commit()
    
    show_stl_missing(conn, lga_name, state_name)
    
    consolidate_matches(conn)
    
    # Now we go through, adding choices to the lga choices file
    choices_path = CHOICES_BASE_PATH / f"{lga_name}.json"
        
    with conn.cursor() as cur:
        
        sql = get_ranked_matches_sql()
        cur.execute(sql, {
            'buffer_size': 20000,
            'lga_name': lga_name,
            'state_name': state_name
        })
        
        rows = cur.fetchall()
        
        # get unique file_paths
        file_paths = set([r[0] for r in rows]) 
        
        total_rows = len(rows)
        rows_seen_count = 0
        
        file_paths = sorted(list(file_paths))
        
        for fp in file_paths:
            print(f"For filePath = \"{fp}\"")
            headers=["SN Guid", "REW name", "GMT name", 
                     "REW name xform", "GMT name xform", 
                     "Rank", "Sim", "Dist", "In catch", "In Ward"]
        
            # want to give choices, then print the code block afterwards
        
            fp_rows = [r[2:] for r in rows if r[0] == fp]
            
            # now group by the REW Settlement name
            rew_set_name_list = sorted(list(set([r[1] for r in fp_rows])))
            
            for rsn_index, rew_set_name in enumerate(rew_set_name_list):
                
                set_rows = [r for r in fp_rows if r[1] == rew_set_name]
                
                rows_seen_count += len(set_rows)
                
                print(f"Deciding for [{rew_set_name}] rows seen {rows_seen_count} / {total_rows} == {100*rows_seen_count / total_rows:.1f}\n{rew_set_name_list[rsn_index:]}")
                                
            
                # also combine the 1st 2 columns
                #set_rows_f = [ [f"('{r[0]}', '{r[1]}'),"] + list(r[2:]) for r in set_rows]
        
                display_rows = [                    
                    r[1:] for r in set_rows
                ]
                display_headers = headers[1:]
        
                ts = tabulate(display_rows, headers=display_headers, tablefmt='orgtbl')
                print(ts)
                
                zero_guid = str(uuid.UUID(int=0))
                
                while True:
                    user_input = input("Please enter a rank to choose, 0 for nothing matches: ")
                    try:
                        user_choices_strs = user_input.split(",")
                        user_choices = []
                        for uc in user_choices_strs:
                            user_choices.append( int(uc) )
                        print(f"You entered the integers: {user_choices}")
                        break
                    except ValueError:
                        print("That's not a valid integer. Please try again.")
                        
                # Read the existing JSON objects from the file
                try:
                    with open(choices_path, 'r') as file:
                        choices_list = json.load(file)
                except FileNotFoundError:
                    choices_list = []  # If the file does not exist, start with an empty list
                    
                for uc_int in user_choices:
                    if uc_int == 0:
                        # headers=["SN Guid", "REW name", "GMT name", "Rank", "Sim", "Dist", "In catch", "In Ward"]
                        chosen_row = [
                            zero_guid, rew_set_name, "No GMT Settlement match Found", -1, 0, 0, False, False
                        ]
                    else:
                        assert uc_int > 0
                        chosen_row = set_rows[uc_int-1]
                        
                    chosen_as_json = dict(zip(headers, chosen_row))
                    
                    chosen_as_json["file_path"] = str(fp)
                    chosen_as_json["num_gmt_matches"] = len(user_choices)
                    
                    choices_list.append(chosen_as_json)
                
                # Write the dictionary to the JSON file
                choices_path.parent.mkdir(parents=True, exist_ok=True)
                
                with open(choices_path, 'w') as file:
                    for c in choices_list:
                        if "num_gmt_matches" not in c:
                            c["num_gmt_matches"] = 1
                    json.dump(choices_list, file, indent=4)


    # print(sql)