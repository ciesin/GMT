from scripts.export_module.db_constants import *
from scripts.export_module.hf.cte import get_hf_catchments_subsquery, get_hf_outreach_count_subsquery, \
    get_closest_outreach_to_outreach_query, get_closest_outreach_to_fp_query
import psycopg2.extensions

def add_before_pilot_hf(
    conn: psycopg2.extensions.connection,
    baseline_conn: psycopg2.extensions.connection, 
    boundary_row: BoundaryRow):
    """
    This is the initial geopode import (Nigeria database schema v5, displayed version 3 (2022-09-12))
    + the Kano/Kaduna HF updates 
    
    This is copied from training, where the before pilot data is maintained that way
    
    See xfer_to_local.py::transfer_table for the gmt_training version where clause
    and need_to_xfer_partition

    """
    hf_table_name = "health_facility_point_" + str(boundary_row.partition_id).zfill(5)

    # This is ran on the baseline db connection 
    # which points to training which has the Grid3 + Kano/Kaduna updates
    # this is to also have the correct catchment calculations done
    baseline_sql = f"""
    WITH {get_hf_catchments_subsquery(hf_table_name)},
        {get_hf_outreach_count_subsquery(hf_table_name)}
    SELECT 
        hf.global_id,
        hf.name, 
        hf.geom, 

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name,

        hf.type,
        
        ('Routine Immunization' = ANY(services)) AS has_ri,
        
        COALESCE(catchments.gis_pop, 0) as computed_catchment_pop,

        hf.version_id, 
        
        ARRAY_TO_STRING(hf.synonyms, ', ') as alt_names,
        
        outreach_count.out_count AS outreach_count,
        
        hf.level_of_care

    FROM {SCHEMA_HF}.{hf_table_name}_latest hf 
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = hf.boundary_polygon 
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    LEFT JOIN catchments ON catchments.global_id = hf.global_id 
    INNER JOIN outreach_count ON outreach_count.global_id = hf.global_id 
    WHERE hf.type = 'fixed_post'
    """

    with baseline_conn.cursor() as baseline_cur:
        baseline_cur.execute(baseline_sql)
        baseline_rows = baseline_cur.fetchall()

    sql = f"""
    INSERT INTO {SCHEMA_EXPORT}.{TABLE_GMT_FP_BASE} (

        global_id, name, geom, 

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,

        type, has_ri, computed_catchment_pop, 

        version_id, alt_names, outreach_count,
        
        level_of_care,

        is_deleted, changed_boundary,
        tag
    )    
    VALUES (
        --repeat this for the # of values we have
        {'%s, ' * 16}
        
        False, False,
        'before_pilot'
    );
            """
    with conn.cursor() as cur:
        for row in baseline_rows:
            cur.execute(sql, row)

        # print(f"Inserted {cur.rowcount} into {SCHEMA_EXPORT}.{target_table_name}")

def add_after_pilot_hf(
    conn: psycopg2.extensions.connection,
    boundary_row: BoundaryRow):
    """
    Adds the hf from the latest view

    This is used as the base table by views for many of the
    :param boundary_row:

    """
    hf_table_name = "health_facility_point_" + str(boundary_row.partition_id).zfill(5)

    # Because include/excludes are owned by the health facility, they are in the same partition
    ci_table_name = "ri_catchment_item_" + str(boundary_row.partition_id).zfill(5)

    # List of column names
    columns = ["global_id", "geom", "is_deleted", 
               "boundary_polygon", "name", 
               "type", "services", "parent", "version_id", 
               "synonyms", "level_of_care"]

    # Join the list elements into a single string separated by ', '
    hf_columns = ', '.join(columns)


    # fp
    fp_sql = f"""    
    INSERT INTO {SCHEMA_EXPORT}.{TABLE_GMT_FP_BASE} (

        global_id, name, geom, 

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,

        type, has_ri, computed_catchment_pop,
        
        alt_names, outreach_count,
        
        dist_closest_outreach,
        
        level_of_care,
        
        changed_boundary,
        is_deleted,
        version_id,
        tag
    )
    WITH 
        latest_with_deleted AS (
            SELECT DISTINCT ON (global_id) 
            {hf_columns}
            FROM {SCHEMA_HF}.{hf_table_name}
            ORDER BY global_id, version_id DESC
        ),    
        {get_hf_catchments_subsquery(hf_table_name)},
        {get_hf_outreach_count_subsquery(hf_table_name)},
        {get_closest_outreach_to_fp_query(hf_table_name)}
    SELECT 
        hf.global_id,
        hf.name, 
        hf.geom, 

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name,

        hf.type,        
        ('Routine Immunization' = ANY(services)) AS has_ri,        
        COALESCE(catchments.gis_pop, 0) as computed_catchment_pop,
        
        ARRAY_TO_STRING(hf.synonyms, ', ') as alt_names,
        
        --deleted hfs will have this as NULL
        COALESCE(outreach_count.out_count, 0) AS outreach_count,
        
        fp_closest_outreach.dist AS dist_closest_outreach,
        
        hf.level_of_care,
        
        EXISTS (
            --look in the view that includes adj. boundaries
            --don't use latest to also check deleted ones
            SELECT 1 FROM partitions.hf_view all_hf
            WHERE hf.global_id = all_hf.global_id
                AND hf.boundary_polygon != all_hf.boundary_polygon
        ) AS changed_boundary,

        hf.is_deleted,
        hf.version_id,
        'after_pilot'

    FROM latest_with_deleted hf 
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = hf.boundary_polygon 
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    LEFT JOIN catchments ON catchments.global_id = hf.global_id
    LEFT JOIN outreach_count 
        ON outreach_count.global_id = hf.global_id 
    LEFT JOIN fp_closest_outreach 
        ON fp_closest_outreach.fp_guid = hf.global_id
    WHERE hf.type = 'fixed_post'
        """

    outreach_sql = f"""    
        INSERT INTO {SCHEMA_EXPORT}.{TABLE_GMT_OUTREACH_BASE} (

            global_id, name, geom, 

            b1_guid, b2_guid, b3_guid,
            state_name, lga_name, ward_name,

            type, computed_catchment_pop,
            
            parent_hf, has_explicit_include,
            dist_closest_outreach,
            dist_parent,
            
            is_deleted,
            version_id,
            tag
        )
        WITH
            latest_with_deleted AS (
                SELECT DISTINCT ON (global_id) 
                {hf_columns}
                FROM {SCHEMA_HF}.{hf_table_name}
                ORDER BY global_id, version_id DESC
            ),    
            {get_hf_catchments_subsquery(hf_table_name)},
            {get_closest_outreach_to_outreach_query(hf_table_name)}  
        SELECT 
            hf.global_id,
            hf.name, 
            hf.geom, 

            b1.global_id,
            b2.global_id,
            b3.global_id,

            b1.name,
            b2.name,
            b3.name,

            hf.type,
            COALESCE(catchments.gis_pop, 0) as computed_catchment_pop,
            
            hf.parent,
            
            EXISTS (
                SELECT 1 FROM {SCHEMA_CI}.{ci_table_name}_latest ci 
                WHERE ci.type = 'include'
                    AND ci.health_facility_point = hf.global_id
            ) AS has_explicit_include,
            
            closest_outreach.dist AS dist_closest_outreach,
            
            --cast to geography to have meters distance
            ST_Distance(hf.geom::geography, hf_fp.geom::geography) as dist_parent,

            hf.is_deleted,
            hf.version_id,
            'after_pilot'

        FROM latest_with_deleted hf 
        INNER JOIN boundary.polygon_latest b3 ON b3.global_id = hf.boundary_polygon 
        INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
        INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
        LEFT JOIN catchments ON catchments.global_id = hf.global_id
        LEFT JOIN closest_outreach ON closest_outreach.out1_guid = hf.global_id
        INNER JOIN latest_with_deleted hf_fp 
            ON hf_fp.global_id = hf.parent
        WHERE hf.type = 'outreach'
            """

    with conn.cursor() as cur:
        cur.execute(fp_sql)

        print(
            f"Inserted {cur.rowcount} into {SCHEMA_EXPORT}.{TABLE_GMT_FP_BASE} from {SCHEMA_HF}.{hf_table_name}_latest")

        cur.execute(outreach_sql)

        print(
            f"Inserted {cur.rowcount} into {SCHEMA_EXPORT}.{TABLE_GMT_OUTREACH_BASE} from {SCHEMA_HF}.{hf_table_name}_latest")

        conn.commit()

def add_grid3_geopode_hf(
    conn: psycopg2.extensions.connection,
    boundary_row: BoundaryRow
):
    """
    Adds the hf from before kano/kaduna updates

    
    """
    hf_table_name = "health_facility_point_" + str(boundary_row.partition_id).zfill(5)

    columns = ["global_id", "geom", "is_deleted", 
               "boundary_polygon", "name", 
           "type", "services", "parent", 
           "version_id", "synonyms", "level_of_care"]

    # Join the list elements into a single string separated by ', '
    hf_columns = ', '.join(columns)

    # fp
    fp_sql = f"""    
    INSERT INTO {SCHEMA_EXPORT}.{TABLE_GMT_FP_BASE} (

        global_id, name,
        alt_names,
        geom, 

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,

        type, has_ri, computed_catchment_pop,
        
        changed_boundary,
        is_deleted,
        version_id,
        tag,
        
        outreach_count,
        level_of_care
    )
    WITH 
        latest_with_deleted AS (
            SELECT DISTINCT ON (global_id) 
            {hf_columns}
            FROM {SCHEMA_HF}.{hf_table_name}
            --see comment in add_geopode_settlements regarding versions
            --this is just geopode
            WHERE version_id <= 18
            ORDER BY global_id, version_id DESC
        )
    SELECT 
        hf.global_id,
        hf.name, 
        
        ARRAY_TO_STRING(hf.synonyms, ', ') as alt_names,
        
        hf.geom, 

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name,

        hf.type,        
        ('Routine Immunization' = ANY(services)) AS has_ri,        
        NULL as computed_catchment_pop,
        
        False AS changed_boundary,

        hf.is_deleted,
        hf.version_id,
        'grid3_geopode' as tag,
        
        --no outreaches in geopode
        0 as outreach_count,
        
        hf.level_of_care

    FROM latest_with_deleted hf 
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = hf.boundary_polygon 
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    WHERE hf.type = 'fixed_post'
        AND NOT hf.is_deleted
        """


    with conn.cursor() as cur:
        cur.execute(fp_sql)

        print(
            f"Inserted {cur.rowcount} into {SCHEMA_EXPORT}.{TABLE_GMT_FP_BASE} from {SCHEMA_HF}.{hf_table_name}_latest")

        conn.commit()

def add_catchments(conn: psycopg2.extensions.connection,
    baseline_conn: psycopg2.extensions.connection, 
    boundary_row: BoundaryRow):

    hf_table_name = "health_facility_point_" + str(boundary_row.partition_id).zfill(5)

    with_sql = f"""
    with hf_raster_fields as (
        select
            hf.catchment_raster,
            hf.raster_width,
            hf.raster_height,
            hf.origin_x,
            hf.origin_y,
            hf.global_id
         from {SCHEMA_HF}.{hf_table_name}_latest hf
    ), hf_raster AS (
        SELECT 
            r.global_id,
            sq.raster_with_values 
        FROM hf_raster_fields r,
        LATERAL (
            SELECT ST_SetValues(
                ST_AddBand(
                    ST_MakeEmptyRaster(
                        r.raster_width,
                        r.raster_height,
                        r.origin_x::float8,
                        r.origin_y::float8,
                        --worldpop pixel size
                        0.000833333330000::float8, 
                        -0.000833333330000::float8, 
                        0::float8, 0::float8, 
                        4326),
                    1, --band
                    '1BB'::text,  -- Pixel type: 1-bit Boolean
                    0, --initial value
                    0 --no data value
                ),
                1, --band,
                1, 1,  -- X, Y (1-based index)
                convert_bit_varying_to_double_precision(r.catchment_raster, r.raster_width, r.raster_height)
            ) as raster_with_values
        ) sq
    ), hulls AS (
        SELECT
            r.global_id,
            ST_ConvexHull(ST_Collect(dp.geom)) AS geom
            --ST_Multi(ST_Collect(dp.geom)) AS geom
        FROM hf_raster r
            CROSS JOIN LATERAL ST_DumpAsPolygons(r.raster_with_values, 1, True) as dp 
        GROUP BY r.global_id
    ), {get_hf_catchments_subsquery(hf_table_name)}
    """

    select_sql = f"""
    SELECT 
        hulls.geom,
        hf.global_id,
        COALESCE(parent.name, hf.name),
        CASE WHEN hf.type = 'outreach' THEN hf.name ELSE NULL END,
        hf.type = 'outreach',
        COALESCE(c.gis_pop, 0),
        COALESCE(c.est_gis_pop, 0),
        COALESCE(c.est_pop, 0),

        b1.global_id,
        b2.global_id,
        b3.global_id,

        b1.name,
        b2.name,
        b3.name,
        False as is_before_pilot
    from {SCHEMA_HF}.{hf_table_name}_latest hf
    INNER JOIN hulls ON hulls.global_id = hf.global_id
    LEFT JOIN {SCHEMA_HF}.{hf_table_name}_latest parent ON hf.parent = parent.global_id    
    LEFT JOIN catchments c ON c.global_id = hf.global_id
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = hf.boundary_polygon
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    """

    sql = f"""
    {with_sql}
    INSERT INTO {SCHEMA_EXPORT}.{TABLE_CATCHMENT_POLYGONS}
    (
        geom,
        hf_guid,
        fixed_post_name,
        outreach_name,
        is_outreach,
        gis_pop,
        est_gis_pop,
        est_pop,

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,
        is_before_pilot
    )
    {select_sql}
    """

    with conn.cursor() as cur:
        cur.execute(sql)

        conn.commit()

    baseline_select = f"""
    {with_sql}
    {select_sql.replace('False as is_before_pilot', 'True as is_before_pilot')}
    """

    with baseline_conn.cursor() as cur:
        cur.execute(baseline_select)
        baseline_catchments = cur.fetchall()

    assert 'True as is_before_pilot' in baseline_select

    insert_sql = f"""
    INSERT INTO {SCHEMA_EXPORT}.{TABLE_CATCHMENT_POLYGONS}
    (
        geom,
        hf_guid,
        fixed_post_name,
        
        outreach_name,
        is_outreach,
        gis_pop,
        
        est_gis_pop,
        est_pop,

        b1_guid, b2_guid, b3_guid,
        state_name, lga_name, ward_name,
        is_before_pilot
    ) VALUES (
        %s, %s, %s,
        %s, %s, %s,

        %s, %s,

        %s, %s, %s,
        %s, %s, %s,
        %s
    )
    """
    with conn.cursor() as cur:
        for r in baseline_catchments:
            cur.execute(insert_sql, r)

        conn.commit()
