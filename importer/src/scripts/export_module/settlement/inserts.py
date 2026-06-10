from scripts.export_module.db_constants import *
from scripts.export_module.settlement.cte import get_catchments_subquery, get_sp_bbox_subquery, get_closest_fp_query
import psycopg2.extensions

def add_before_pilot_gmt_settlements(
        conn: psycopg2.extensions.connection,
        baseline_conn: psycopg2.extensions.connection,
        boundary_row: BoundaryRow):
    """
    Adds the settlements from the latest view from training

    This is GMT Pilot before

    """
    sn_table_name = "settlement_name_" + str(boundary_row.partition_id).zfill(5)
    sp_table_name = "settlement_part_" + str(boundary_row.partition_id).zfill(5)

    target_table_name = TABLE_SETTLEMENTS_GMT_BEFORE_PILOT

    baseline_sql = f"""
    WITH 
        {get_catchments_subquery(sn_table_name)},
        {get_sp_bbox_subquery(sp_table_name)},
        {get_closest_fp_query(sp_table_name)}
    SELECT 
        sn.global_id,
        sn.version_id,
        
        sn.name, 
        sn.geom, 

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name,
        
        sn.estimated_pop,
        sp.computed_pop,
        
        COALESCE(fp_c.pop_perc, 0) AS fixed_catchment_perc,
        --no outreaches in baseline export
        100 - COALESCE(fp_c.pop_perc, 0) AS uncovered_catchment_perc,
    
        fp_d.dist AS distance_closest_fp,
        
        array_to_string(sn.synonyms, ', ') AS alt_names
    
    FROM {SCHEMA_SN}.{sn_table_name}_latest sn 
    INNER JOIN {SCHEMA_SP}.{sp_table_name}_latest sp ON sn.settlement_part = sp.global_id
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = sn.boundary_polygon 
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    LEFT JOIN catchments fp_c ON fp_c.global_id = sn.global_id AND fp_c.type = 'fixed_post'
    LEFT JOIN closest_fp_hf fp_d ON fp_d.sp_guid = sp.global_id
    WHERE sn.is_primary
    """

    with baseline_conn.cursor() as baseline_cur:
        baseline_cur.execute(baseline_sql)
        baseline_rows = baseline_cur.fetchall()

        parts_sql = f"""
        SELECT 
        sp.global_id,
        
        sn.global_id AS sn_global_id,
        
        sn.name, 
        sp.geom, 

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name,
        
        sp.computed_pop,
        sn.uninhabited,
        True
    FROM {SCHEMA_SN}.{sn_table_name}_latest sn 
    INNER JOIN {SCHEMA_SP}.{sp_table_name}_latest sp ON sn.settlement_part = sp.global_id
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = sp.boundary_polygon
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    WHERE sn.is_primary
        AND sp.split_type != 'auto_split_parent'
        """

        baseline_cur.execute(parts_sql)
        before_pilot_sp_rows = baseline_cur.fetchall()

    sql = f"""
    INSERT INTO {SCHEMA_EXPORT}.{target_table_name} (

        global_id, 
        version_id,
        name, geom, 

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,
                
        estimated_pop, computed_pop,
        
        fixed_catchment_perc, uncovered_catchment_perc,
    
        distance_closest_fp, alt_names
    )    
    VALUES (
        {', '.join(['%s'] * 16)}
    );
            """
    
    insert_sp_sql = f"""
    INSERT INTO {SCHEMA_EXPORT}.{TABLE_SETTLEMENT_PARTS} (

        global_id, sn_global_id,
        
        name, geom, 

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,
        
        gis_pop, uninhabited, is_before_pilot
    )
    VALUES (
        {', '.join(['%s'] * 13)}
    );    
    """

    with conn.cursor() as cur:
        for row in baseline_rows:
            cur.execute(sql, row)

        print(f"Inserted {len(baseline_rows)} into {SCHEMA_EXPORT}.{target_table_name} FROM {SCHEMA_SN}.{sn_table_name}_latest")

        for row in before_pilot_sp_rows:
            cur.execute(insert_sp_sql, row)

        print(f"Inserted {len(before_pilot_sp_rows)} into {SCHEMA_EXPORT}.{TABLE_SETTLEMENT_PARTS} FROM {SCHEMA_SP}.{sp_table_name}_latest")

        conn.commit()


def add_current_gmt_settlements(
        conn: psycopg2.extensions.connection,
        boundary_row: BoundaryRow):
    """
    Adds the settlements from the latest view

    This is used as the base table by views for many of the
    :param boundary_row:

    """
    sn_table_name = "settlement_name_" + str(boundary_row.partition_id).zfill(5)
    sp_table_name = "settlement_part_" + str(boundary_row.partition_id).zfill(5)

    target_table_name = TABLE_SETTLEMENTS_GMT_AFTER_PILOT

    sql = f"""
    WITH 
        {get_catchments_subquery(sn_table_name)},
        {get_sp_bbox_subquery(sp_table_name)},
        {get_closest_fp_query(sp_table_name)},
        --get exclusions/inclusions
        inc_exc AS (
            --hf_type: 'fixed_post',  'outreach'
            --ci_type: 'generated', 'include', 'exclude'
            SELECT 
                sp.global_id AS sp_guid, 
                hf.global_id as hf_guid, 
                hf.parent AS hf_parent_guid,
                hf.type as hf_type, 
                ci.type as ci_type
            FROM {SCHEMA_SP}.{sp_table_name}_latest sp
            --hf adj boundaries, so use partitions view which includes them
            INNER JOIN partitions.ci_view_latest ci 
                ON ci.settlement_part = sp.global_id
            INNER JOIN partitions.hf_view_latest hf 
                ON ci.health_facility_point = hf.global_id
        )
    INSERT INTO {SCHEMA_EXPORT}.{target_table_name} (

        global_id, 
        version_id,
        
        name, geom, 

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,
        
        alt_names,
        
        hard_to_reach,
        nomadic,
        riverine,
        uninhabited,
        
        outreach_catchment_perc,
        
        estimated_pop, computed_pop,
        
        fixed_catchment_perc, 
        uncovered_catchment_perc,
    
        distance_closest_fp,
        
        excluded_fixed_post,
        excluded_outreach,
        
        in_custom_catchment,
        
        --similar logic below but with fixed post
        excluded_custom_same_fp,
        excluded_custom_diff_fp,
        
        --Excluded from an outreach, and include by same outreach
        excluded_custom_same_outreach,
        --Excluded by an outreach, and include by a different outreach
        excluded_custom_diff_outreach,
        
        changed_boundary
    )    
    SELECT 
        sn.global_id,
        sn.version_id,
        
        sn.name, 
        sn.geom, 

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name,
        
        array_to_string(sn.synonyms, ', ') AS alt_names,
        
        ('Hard To Reach' = ANY(sn.problematic)) as hard_to_reach,
        ('Nomadic/Fulani' = ANY(sn.problematic)) as nomadic,
        ('Riverine' = ANY(sn.problematic)) as riverine,
        sn.uninhabited,
        
        COALESCE(o_c.pop_perc, 0) AS outreach_catchment_perc,
        
        sn.estimated_pop,
        sp.computed_pop,
        
        COALESCE(fp_c.pop_perc, 0) AS fixed_catchment_perc,
        
        100 - COALESCE(fp_c.pop_perc, 0) - COALESCE(o_c.pop_perc, 0) AS uncovered_catchment_perc,
    
        fp_d.dist AS distance_closest_fp,
        
        EXISTS ( 
            SELECT 1 
            FROM inc_exc
            WHERE inc_exc.sp_guid = sp.global_id
                AND inc_exc.hf_type = 'fixed_post'
                AND inc_exc.ci_type = 'exclude'
        ) AS excluded_fixed_post,
        
        EXISTS ( 
            SELECT 1 
            FROM inc_exc
            WHERE inc_exc.sp_guid = sp.global_id
                AND inc_exc.hf_type = 'outreach'
                AND inc_exc.ci_type = 'exclude'
        ) AS excluded_outreach,
        
        EXISTS ( 
            SELECT 1 
            FROM inc_exc
            WHERE inc_exc.sp_guid = sp.global_id
                AND inc_exc.ci_type = 'include'
        ) AS in_custom_catchment,
        
        --Excluded from an FP, and include by an outreach with same parent hf as the FP
        --because only outreaches can have includes
         EXISTS ( 
            SELECT 1 
            FROM inc_exc e
            --same hf
            INNER JOIN inc_exc i 
                ON i.sp_guid = e.sp_guid
                    AND i.ci_type = 'include'
                    AND e.hf_guid = i.hf_parent_guid
                    --Implicit that this is an outreach because it has a parent guid                   
            WHERE e.sp_guid = sp.global_id
                AND e.hf_type = 'fixed_post'
                AND e.ci_type = 'exclude'
        ) AS excluded_custom_same_fp,
        
        --Excluded from an FP, and include by an outreach with different parent hf as the FP
        EXISTS (
            SELECT 1 
            FROM inc_exc e
            INNER JOIN inc_exc i 
                ON i.hf_parent_guid != e.hf_guid 
                    AND i.sp_guid = e.sp_guid
                    AND i.ci_type = 'include'
                    AND i.hf_parent_guid IS NOT NULL
            WHERE e.sp_guid = sp.global_id
                AND e.hf_type = 'fixed_post'                
                AND e.ci_type = 'exclude'
        ) AS excluded_custom_diff_fp,
        
        --Excluded from an outreach, and include by an outreach with same parent hf
        EXISTS ( 
            SELECT 1 
            FROM inc_exc e
            INNER JOIN inc_exc i 
                ON i.hf_parent_guid = e.hf_parent_guid 
                    AND i.sp_guid = e.sp_guid
                    AND i.ci_type = 'include'
            WHERE e.sp_guid = sp.global_id
                AND e.hf_type = 'outreach'                
                AND e.ci_type = 'exclude'
        ) AS excluded_custom_same_outreach,
        
        --Excluded by an outreach, and include by a different outreach with different parent hf
        EXISTS (
            SELECT 1 
            FROM inc_exc e
            INNER JOIN inc_exc i 
                ON i.hf_parent_guid != e.hf_parent_guid 
                    AND i.sp_guid = e.sp_guid
                    AND i.ci_type = 'include'
            WHERE e.sp_guid = sp.global_id
                AND i.hf_type = 'outreach'                
                AND e.ci_type = 'exclude'
        ) AS excluded_custom_diff_outreach,
        
        EXISTS (
            --look in the view that includes adj. boundaries
            SELECT 1 FROM partitions.sn_view all_sn
            WHERE sn.global_id = all_sn.global_id
                AND sn.boundary_polygon != all_sn.boundary_polygon
        ) AS changed_boundary
        

    FROM {SCHEMA_SN}.{sn_table_name}_latest sn 
    INNER JOIN {SCHEMA_SP}.{sp_table_name}_latest sp ON sn.settlement_part = sp.global_id
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = sn.boundary_polygon 
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    LEFT JOIN catchments o_c ON o_c.global_id = sn.global_id AND o_c.type = 'outreach'
    LEFT JOIN catchments fp_c ON fp_c.global_id = sn.global_id AND fp_c.type = 'fixed_post'
    LEFT JOIN closest_fp_hf fp_d ON fp_d.sp_guid = sp.global_id
    WHERE sn.is_primary
        """

    with conn.cursor() as cur:
        cur.execute(sql)

        print(f"Inserted {cur.rowcount} into {SCHEMA_EXPORT}.{target_table_name} from {SCHEMA_SN}.{sn_table_name}_latest")

        sql = f"""
    INSERT INTO {SCHEMA_EXPORT}.{TABLE_SETTLEMENT_PARTS} (

        global_id, sn_global_id,
        
        name, geom, 

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,
        
        gis_pop, uninhabited, is_before_pilot
    )    
    SELECT 
        sp.global_id,
        sn.global_id,
        
        sn.name, 
        sp.geom, 

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name,
        
        sp.computed_pop,
        sn.uninhabited,
        False
    FROM {SCHEMA_SN}.{sn_table_name}_latest sn 
    INNER JOIN {SCHEMA_SP}.{sp_table_name}_latest sp ON sn.settlement_part = sp.global_id
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = sp.boundary_polygon
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    WHERE sn.is_primary
        AND sp.split_type != 'auto_split_parent'
        """

        cur.execute(sql)

        conn.commit()


def add_deleted_demoted_gmt_settlements(conn: psycopg2.extensions.connection,
        boundary_row: BoundaryRow):
    """
    

    """
    sn_table_name = "settlement_name_" + str(boundary_row.partition_id).zfill(5)
    
    target_table_name = TABLE_SETTLEMENTS_GMT_DELETED_DEMOTED

    before_table_name = TABLE_SETTLEMENTS_GMT_BEFORE_PILOT

    sn_columns = "global_id, version_id, name, geom, is_deleted, is_primary, boundary_polygon"

    # insert deleted first
    sql_deleted = f"""
    WITH latest_with_deleted AS (
        SELECT DISTINCT ON (global_id) 
        {sn_columns}
        FROM {SCHEMA_SN}.{sn_table_name} sn 
        ORDER BY global_id, version_id DESC
    )
    INSERT INTO {SCHEMA_EXPORT}.{target_table_name} (

        global_id, version_id,
        name, geom, 

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,
        
        is_primary,
        is_deleted
    )    
    SELECT 
        sn.global_id,
        sn.version_id,
        sn.name, 
        sn.geom, 

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name,
        sn.is_primary,
        sn.is_deleted
    FROM latest_with_deleted sn 
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = sn.boundary_polygon 
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    WHERE sn.is_deleted 
        AND EXISTS (
            --We can have cases where something moved boundaries, then was deleted again
            --so we only care about deletions of the settlement from the baseline
            SELECT 1 FROM {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_BEFORE_PILOT} b 
            WHERE b.global_id = sn.global_id 
                AND b.b3_guid = sn.boundary_polygon
        )
        --Also the deletion only counts if it doesn't exist in the adj. boundaries either
        --This check can pick up settlement existence in boundaries not being exported
        --so it is too broad
        /*AND NOT EXISTS (
            SELECT 1 FROM partitions.sn_view_latest p 
            WHERE p.global_id = sn.global_id
        )*/
        --getting some dup errors...
        AND NOT EXISTS (
            SELECT 1 FROM {SCHEMA_EXPORT}.{target_table_name} ch
            WHERE ch.global_id = sn.global_id 
        ) 
        --must have been in the pilot before hand
        AND EXISTS (
            SELECT 1 FROM {SCHEMA_EXPORT}.{before_table_name} ch2
            WHERE ch2.global_id = sn.global_id 
        ) 
        
        """
    
    # now something that was primary and now is not
    sql_demoted = f"""
    WITH latest_with_deleted AS (
        SELECT DISTINCT ON (global_id) 
        {sn_columns}
        FROM {SCHEMA_SN}.{sn_table_name} sn 
        ORDER BY global_id, version_id DESC
    )
    INSERT INTO {SCHEMA_EXPORT}.{target_table_name} (

        global_id, 
        version_id,
        name, geom, 

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,
        
        is_primary,
        is_deleted
    )    
    SELECT 
        sn.global_id,
        sn.version_id,
        
        sn.name, 
        sn.geom, 

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name,
        sn.is_primary,
        sn.is_deleted
    FROM {SCHEMA_SN}.{sn_table_name}_latest sn  
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = sn.boundary_polygon 
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    WHERE NOT sn.is_primary AND EXISTS (
        SELECT 1 FROM {SCHEMA_SN}.{sn_table_name} sn_prev_primary  
        WHERE sn_prev_primary.is_primary AND NOT sn_prev_primary.is_deleted
            AND sn_prev_primary.global_id = sn.global_id
            --don't need to check version_id because anything we find will be prior to latest
    ) 
    --with latest round there was a dup here, only want to count a demoted one once
    --perhaps it changed boundaries many times?
    AND NOT EXISTS (
        SELECT 1 FROM {SCHEMA_EXPORT}.{target_table_name} ch
        WHERE ch.global_id = sn.global_id 
    )
    --must have been in the pilot before hand
    AND EXISTS (
        SELECT 1 FROM {SCHEMA_EXPORT}.{before_table_name} ch2
        WHERE ch2.global_id = sn.global_id 
    ) 
    """

    with conn.cursor() as cur:
        cur.execute(sql_deleted)

        # print(sql_deleted)

        print(f"Inserted {cur.rowcount} into {SCHEMA_EXPORT}.{target_table_name} from {SCHEMA_SN}.{sn_table_name}_latest")

        cur.execute(sql_demoted)

        print(f"Inserted {cur.rowcount} into {SCHEMA_EXPORT}.{target_table_name} from {SCHEMA_SN}.{sn_table_name}_latest")

        conn.commit()


def add_geopode_settlements(
        conn: psycopg2.extensions.connection,
        boundary_row: BoundaryRow):

    sn_table_name = "settlement_name_" + str(boundary_row.partition_id).zfill(5)

    # <= 18 was the initial import 
    # 19 was the kano update
    # and there are kano corrections in 153,154
    # then kaduna is 269

    # However, here we just want geopode so its only versions 1-18 inclusive
    
    sn_columns = "global_id, version_id, name, geom, is_deleted, is_primary, boundary_polygon"

    sql = f"""
    INSERT INTO {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GEOPODE} (
        
        global_id, version_id,
        name, geom, 
        
        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,
        
        is_primary
    )    
    WITH latest_with_deleted AS (
            SELECT DISTINCT ON (global_id) 
            {sn_columns}
            FROM {SCHEMA_SN}.{sn_table_name} sn 
            WHERE sn.version_id <= 18
            ORDER BY global_id, version_id DESC
        )
    SELECT 
        sn.global_id,
        sn.version_id,
        
        sn.name, 
        sn.geom,         
        
        b1.global_id,
        b2.global_id,
        b3.global_id,
        
        b1.name,
        b2.name,
        b3.name,
        
        sn.is_primary
    FROM latest_with_deleted sn 
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = sn.boundary_polygon 
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    WHERE NOT sn.is_deleted
    ORDER BY sn.version_id DESC
    """

    with conn.cursor() as cur:
        cur.execute(sql)

        print(f"Inserted {cur.rowcount} into {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GEOPODE}")
