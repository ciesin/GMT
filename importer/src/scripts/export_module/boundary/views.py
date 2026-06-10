from scripts.export_module.db_constants import *
import scripts.export_module.indicator_constants as ic
import psycopg2.extensions


def create_boundary_edit_views(conn: psycopg2.extensions.connection):
    b_short_name_map = ic.build_b_short_name_map()

    ward_view = b_short_name_map[ic.IND_BOUNDARY_ADJUSTMENTS_TO_THE_WARD_BOUNDARY]
    lga_view = b_short_name_map[ic.IND_BOUNDARY_ADJUSTMENTS_TO_THE_LGA_BOUNDARY]
    state_view = b_short_name_map[ic.IND_BOUNDARY_ADJUSTMENT_TO_THE_STATE_BOUNDARY]

    border_distance_tolerance = 1000

    sql = f"""
    CREATE VIEW {SCHEMA_EXPORT}.{VIEW_BOUNDARY_ADJ_DIFF} AS
    SELECT a.global_id,
        a.name,

        --The difference can have a very thin border leftover
        --so we use a negative buffer in meters to get rid of it
        ST_Buffer(ST_SymDifference(
                a.geom,
                b3.geom
        )::geography, -0.01)::geometry AS geom,        
        b1_guid,
        b2_guid,
        b3_guid,
        state_name,
        lga_name,
        ward_name,
        a.comment,
        is_state_boundary,
        is_lga_boundary
    FROM {SCHEMA_EXPORT}.{TABLE_BOUNDARY_ADJ} a
        INNER JOIN boundary.polygon_latest b3 ON b3.global_id = a.b3_guid   
    ;

    CREATE VIEW {SCHEMA_EXPORT}.{ward_view} AS
    SELECT * FROM {SCHEMA_EXPORT}.{TABLE_BOUNDARY_ADJ};
    
    CREATE VIEW {SCHEMA_EXPORT}.{lga_view} AS
    SELECT a.* FROM {SCHEMA_EXPORT}.{TABLE_BOUNDARY_ADJ} a
        INNER JOIN boundary.polygon_latest b3 ON b3.global_id = a.b3_guid
        INNER JOIN boundary.polygon_latest b2 ON b2.global_id = a.b2_guid 
        INNER JOIN {SCHEMA_EXPORT}.{VIEW_BOUNDARY_ADJ_DIFF} diff
            ON diff.global_id = a.global_id
    --Need to check the symetric difference of the change touches (or is close enough to) the LGA boundary
    WHERE a.is_lga_boundary AND 
        ST_Distance(
            diff.geom::geography,
            --Distance to the boundary of the LGA
            ST_Boundary(b2.geom)::geography
        ) <= {border_distance_tolerance}
    ;
    
    CREATE VIEW {SCHEMA_EXPORT}.{state_view} AS
    SELECT a.* FROM {SCHEMA_EXPORT}.{TABLE_BOUNDARY_ADJ} a
        INNER JOIN boundary.polygon_latest b3 ON b3.global_id = a.b3_guid
        INNER JOIN boundary.polygon_latest b1 ON b1.global_id = a.b1_guid
        INNER JOIN {SCHEMA_EXPORT}.{VIEW_BOUNDARY_ADJ_DIFF} diff
            ON diff.global_id = a.global_id
    WHERE a.is_state_boundary AND 
        ST_Distance(
            diff.geom::geography,
            ST_Boundary(b1.geom)::geography
        ) <= {border_distance_tolerance}
    ;

   

    """

    with conn.cursor() as cur:
        cur.execute(sql)
        conn.commit()
