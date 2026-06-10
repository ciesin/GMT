from scripts.export_module.db_constants import *

def get_hf_catchments_subsquery(hf_table_name: str) -> str:
    # Generated are owned by sp
    return f"""
    catchments AS (
        SELECT 
            hf.global_id, 
            SUM(sp.computed_pop * ci.population_perc / 100) AS gis_pop,
            SUM(COALESCE(sn.estimated_pop,0) * ci.population_perc / 100) AS est_pop,
            SUM(COALESCE(sn.estimated_pop, sp.computed_pop) * ci.population_perc / 100) AS est_gis_pop 
        FROM {SCHEMA_HF}.{hf_table_name}_latest hf
        --need the view with adj. wards because can influence sp outside boundary
        INNER JOIN partitions.ci_view_latest ci ON 
            ci.health_facility_point = hf.global_id AND
            ci.type = 'generated'
        INNER JOIN partitions.sp_view_latest sp ON
            ci.settlement_part = sp.global_id
        INNER JOIN partitions.sn_view_latest sn ON
            sn.settlement_part = sp.global_id
        WHERE sn.is_primary AND NOT COALESCE(sn.uninhabited, False)
        GROUP BY hf.global_id 
    )
    """
    
def get_hf_outreach_count_subsquery(hf_table_name: str) -> str:
    # Generated are owned by sp
    return f"""
    outreach_count AS (
        SELECT 
            hf.global_id, 
            COUNT(out.global_id) as out_count
        FROM {SCHEMA_HF}.{hf_table_name}_latest hf
        --outreaches in theory could be in another boundary
        LEFT JOIN partitions.hf_view_latest out ON 
            out.parent = hf.global_id
            AND out.type = 'outreach'
        WHERE hf.type = 'fixed_post'
        GROUP BY hf.global_id 
    )
    """    
    

def get_closest_outreach_to_outreach_query(hf_table_name) -> str:
    # returns closest outreach to another outreach
    # The other outreach (out2) can be in the adj. wards
    return f"""
    closest_outreach AS (
        SELECT 
            out1.global_id AS out1_guid,
            out2.global_id AS out2_guid, 
            --cast to geography to have meters distance
            ST_Distance(out1.geom::geography, out2.geom::geography) as dist
        --https://postgis.net/workshops/postgis-intro/knn.html             
        FROM {SCHEMA_HF}.{hf_table_name}_latest out1
            CROSS JOIN LATERAL 
            (
                SELECT cj.global_id, cj.geom, out1.geom <-> cj.geom AS dist 
                FROM partitions.hf_view_latest cj
                WHERE cj.global_id != out1.global_id
                    AND cj.type = 'outreach'
                ORDER BY dist
                LIMIT 1
            ) out2
        WHERE out1.type = 'outreach'           
    )
    """    
    
def get_closest_outreach_to_fp_query(hf_table_name) -> str:
    # returns closest outreach to a fixed post
    # The other outreach (out2) can be in the adj. wards
    return f"""
    fp_closest_outreach AS (
        SELECT 
            out1.global_id AS fp_guid,
            out2.global_id AS out_guid, 
            --cast to geography to have meters distance
            ST_Distance(out1.geom::geography, out2.geom::geography) as dist
        --https://postgis.net/workshops/postgis-intro/knn.html             
        FROM {SCHEMA_HF}.{hf_table_name}_latest out1
            CROSS JOIN LATERAL 
            (
                SELECT cj.global_id, cj.geom, out1.geom <-> cj.geom AS dist 
                FROM partitions.hf_view_latest cj
                WHERE cj.global_id != out1.global_id
                    AND cj.type = 'outreach'
                ORDER BY dist
                LIMIT 1
            ) out2
        WHERE out1.type = 'fixed_post'
    )
    """        