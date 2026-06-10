from scripts.rew_module.rew_helpers import print_db_rows
from scripts.rew_module.rew_parse import DB_CONSTANTS
from scripts.rew_module.rew_match_set import get_sn_regex
import psycopg2.extensions

REW_TO_REMOVE = ['health', 'heath', 'clinic', 'post', 'Center', 'h post', 'hp', 'facility phc', 'H/POSA']
GMT_TO_REMOVE = ['health post', 'health clinic', 'Primary Health Center', r'\(dawakin Tofa\)']


def match_gmt_hfs(conn: psycopg2.extensions.connection, lga_name: str, state_name: str):
    """
    :param conn: 
    :param lga_name: GMT lga name
    :param state_name: GMT state name, not one in spreadsheet
    
    """
    
    # do a 1st pass where the best names are matched
    do_match_sql = f"""    
WITH gmt_names AS (
    select b1.name as state, b2.name as lga, b3.name as ward, 
        --include the alt names
        lower(hf.name) as name,        
        lower(array_to_string(hf.synonyms, ' ')) as alt_name,
        hf.global_id 
    from partitions.hf_view_latest hf
    inner join boundary.polygon_latest b3 on b3.global_id = hf.boundary_polygon
    inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
    inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
    where b2.name = %(lga_name)s AND b1.name = %(state_name)s
    and hf.type = 'fixed_post'
    --Not matched yet
    and not exists (
        SELECT 1 FROM 
        {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} h 
        WHERE h.global_id = hf.global_id
    )
), rew_names AS (
    select hf.file_path, hf.id, lower(hf.name) as name
    from {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} hf
), sim_scores AS (
    SELECT 
        DISTINCT ON (r.id) 
        r.id, g.global_id, 
        similarity(
            {get_sn_regex('g.name', GMT_TO_REMOVE)},
            {get_sn_regex('r.name', REW_TO_REMOVE)}
        ) + similarity(
            {get_sn_regex('g.alt_name', GMT_TO_REMOVE)},
            {get_sn_regex('r.name', REW_TO_REMOVE)}
        ) as sim
    FROM gmt_names g
    CROSS JOIN rew_names r
    ORDER BY r.id, sim DESC
)
UPDATE {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} AS to_set
SET global_id = ss.global_id
FROM sim_scores ss 
WHERE ss.id = to_set.id
    AND to_set.global_id is NULL 
    AND to_set.gmt_state = %(state_name)s
    AND to_set.gmt_lga = %(lga_name)s
;"""

    clear_ties_sql = f"""
--clear the worst ties, worst one is hf1
WITH ties AS (
    select gmt_hf.name,
    hf1.id AS worst_match_id,
    hf1.file_path,
    hf1.name, similarity(hf1.name, gmt_hf.name),
    hf2.id,
    hf2.file_path,
    hf2.name, similarity(hf2.name, gmt_hf.name)
    from {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} hf1
    inner join {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} hf2 
        on hf1.global_id = hf2.global_id and hf1.id != hf2.id
    inner join partitions.hf_view_latest gmt_hf on hf1.global_id = gmt_hf.global_id
    
    inner join boundary.polygon_latest b3 on b3.global_id = gmt_hf.boundary_polygon
    inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
    inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
    
    where similarity(hf1.name, gmt_hf.name) < similarity(hf2.name, gmt_hf.name)
        AND b2.name =  %(lga_name)s AND b1.name = %(state_name)s
)
UPDATE {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} AS to_set
SET global_id = NULL 
FROM ties 
WHERE to_set.id = ties.worst_match_id
    AND to_set.gmt_state = %(state_name)s
    AND to_set.gmt_lga = %(lga_name)s
    """
    
    with conn.cursor() as cur:
        dict_args = {'lga_name': lga_name, 'state_name': state_name}
        cur.execute(do_match_sql, dict_args)
        cur.execute(clear_ties_sql, dict_args)
        
        # do a 2nd pass
        cur.execute(do_match_sql, dict_args)
        cur.execute(clear_ties_sql, dict_args)
        
        conn.commit()
    
   
        # this sql shows the unmatched health facility best matches 
        sql = f"""
        
WITH gmt_names AS (
    select 
        b1.name as state, b2.name as lga, b3.name as ward, 
        lower(hf.name) as name,
        hf.global_id 
    from partitions.hf_view_latest hf
        inner join boundary.polygon_latest b3 on b3.global_id = hf.boundary_polygon
        inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
        inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
    --limit to LGA
    where b2.name = %s
    and hf.type = 'fixed_post'
    and not exists (
        SELECT 1 FROM
        {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r
        where r.global_id = hf.global_id
    )
), rew_names AS (
    select hf.file_path, hf.id, lower(hf.name) as name
    from {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} hf
    where hf.global_id is null
), sim_scores AS (
    SELECT g.name as gmt_name, r.name as rew_name, g.global_id, r.id, similarity(g.name, r.name) as sim
    FROM gmt_names g
    CROSS JOIN rew_names r
), with_rank AS (
    SELECT *,
    ROW_NUMBER() OVER (PARTITION BY id ORDER BY sim DESC) AS rank
    FROM sim_scores
)
select
    b1.name as state, b2.name as lga, b3.name as gmt_ward, r.ward as rew_ward,
    wr.gmt_name, wr.rew_name,
    wr.sim, wr.rank from with_rank wr
inner join partitions.hf_view_latest hf on hf.global_id = wr.global_id
inner join boundary.polygon_latest b3 on b3.global_id = hf.boundary_polygon
    inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
    inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
    inner join {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r on r.id = wr.id
    WHERE rank <= 10
    order by r.id, rank
;
"""
        # review
        sql = f"""
    select
         
        substring(r_hf.file_path FROM (char_length(r_hf.file_path) - 
            position('/' IN reverse(r_hf.file_path)) + 2) FOR 20) as "File Path",
         
        --r_hf.name as  "REW Name", 
        --gmt_hf.name as "GMT Name",
        {get_sn_regex('gmt_hf.name', GMT_TO_REMOVE)} as "GMT Xform Name",
        {get_sn_regex('r_hf.name', REW_TO_REMOVE)} as "REW Xform Name",
        '[' || array_to_string(gmt_hf.synonyms, ' ') || ']' as "GMT Alt Name",
        r_hf.ward as "REW Ward", 
        b3.name as "GMT Ward"
    from {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r_hf
        left join partitions.hf_view_latest gmt_hf
            on r_hf.global_id = gmt_hf.global_id
        left join boundary.polygon_latest b3 on b3.global_id = gmt_hf.boundary_polygon
        left join boundary.polygon_latest b2 
            on b2.global_id = b3.boundary_polygon and b2.name = %(lga_name)s
        left join boundary.polygon_latest b1 
            on b1.global_id = b2.boundary_polygon and b1.name = %(state_name)s
    WHERE r_hf.gmt_state = %(state_name)s
       AND r_hf.gmt_lga = %(lga_name)s
        """
        
    print_db_rows(conn, sql, "HF Match Review", dict_args)
        

    # Dups
    sql = f"""
select
    r_hf.file_path,
    r_hf.name, 
    gmt_hf.name,
    '[' || array_to_string(gmt_hf.synonyms, ' ') || ']' as alt_name,
    r_hf.ward as r_ward, 
    b3.name as gmt_ward
from {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r_hf
    inner join partitions.hf_view_latest gmt_hf
        on r_hf.global_id = gmt_hf.global_id
    inner join {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r_hf_dup
        on r_hf.global_id = r_hf_dup.global_id
            AND r_hf.id > r_hf_dup.id
    left join boundary.polygon_latest b3 on b3.global_id = gmt_hf.boundary_polygon
    left join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon and b2.name = %(lga_name)s
    left join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon and b1.name = %(state_name)s
;
    """
       
    print_db_rows(conn, sql, "Dups!!!", dict_args)
        
    # GMT w/ no match
    
    sql = f"""
select
    'N/A' as file_path,
    'N/A' as rew_name, 
    gmt_hf.name,
    {get_sn_regex('gmt_hf.name', GMT_TO_REMOVE)} as "Name Xform",
    '[' || array_to_string(gmt_hf.synonyms, ' ') || ']' as alt_name,
    'N/A' as r_ward, 
    b3.name as gmt_ward
from 
    partitions.hf_view_latest gmt_hf
    inner join boundary.polygon_latest b3 on b3.global_id = gmt_hf.boundary_polygon
    inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
    inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
where not exists (
    select 1 FROM {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r_hf where r_hf.global_id = gmt_hf.global_id        
) AND b2.name = %(lga_name)s and b1.name = %(state_name)s
AND gmt_hf.type = 'fixed_post'
;
    """
    
    print_db_rows(conn, sql, "Unmatched GMT", dict_args)