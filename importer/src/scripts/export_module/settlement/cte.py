from scripts.export_module.db_constants import *

def get_catchments_subquery(sn_table_name) -> str:
    """
    For each sn name, sum of the pop_perc of generate items
    per hf type (outreach/fixed_post)

    use generated only b/c include will create generated entries
    only primary, inhabited settlements considered
    """
    return f"""
    catchments AS (
        SELECT sn.global_id, hf.type, SUM(ci.population_perc) AS pop_perc FROM 
        {SCHEMA_SN}.{sn_table_name}_latest sn
        INNER JOIN partitions.ci_view_latest ci ON 
            ci.settlement_part = sn.settlement_part AND 
            ci.type = 'generated'
        INNER JOIN partitions.hf_view_latest hf ON
            ci.health_facility_point = hf.global_id
        WHERE sn.is_primary AND NOT COALESCE(sn.uninhabited, False)
        GROUP BY sn.global_id, hf.type 
    )
    """


def get_sp_bbox_subquery(sp_table_name) -> str:
    """
    Creates a bounding box around each settlement part
    """
    return f"""
    --For the distance calculations, 1st step is we need bounding boxes f the SP
    --This is to optimize finding the closest HF to the polygon
    sp_hf_bbox AS (
        SELECT sp.global_id, ST_Transform(ST_SetSRID(
            ST_MakeBox2D(
                ST_Point(
                    ST_XMin(envelope_3857) - {BBOX_SP_BUFFER_3857_METERS},
                    ST_YMin(envelope_3857) - {BBOX_SP_BUFFER_3857_METERS}
                ),
                ST_Point(
                    ST_XMax(envelope_3857) + {BBOX_SP_BUFFER_3857_METERS},
                    ST_YMax(envelope_3857) + {BBOX_SP_BUFFER_3857_METERS}
                )
            ), 3857), 4326) as geom
        from {SCHEMA_SP}.{sp_table_name}_latest sp
        -- https://stackoverflow.com/a/65847555
        CROSS JOIN LATERAL (
            select ST_Transform(ST_Envelope(sp.geom), 3857) as envelope_3857
        ) AS sq_env
    )
    """
    

def get_closest_fp_query(sp_table_name) -> str:
    # which fixed post is closest to the settlement part
    # has a bbox to make this a bit faster
    # We also want to restrict this to FP that are doing RI
    return f"""
    closest_fp_hf AS (
        SELECT 
            sp.global_id AS sp_guid, 
            MIN(ST_Distance(sp.geom::geography, hf.geom::geography)) as dist 
        FROM {SCHEMA_SP}.{sp_table_name}_latest sp
        INNER JOIN sp_hf_bbox 
            ON sp_hf_bbox.global_id = sp.global_id
        INNER JOIN partitions.hf_view_latest hf 
            ON 'Routine Immunization' = ANY(hf.services)
                AND ST_Intersects(sp_hf_bbox.geom, hf.geom)
                AND hf.type = 'fixed_post'
        GROUP BY sp.global_id
    )
    """

