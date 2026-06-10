from scripts.export_module.db_constants import *
import psycopg2.extensions


def create_settlement_tables(
    conn: psycopg2.extensions.connection,
):
    # table used as base table for table we'll make for each stat
    sql = f"""
    CREATE SCHEMA IF NOT EXISTS {SCHEMA_EXPORT};
    
    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_BASE}
    (
        id SERIAL PRIMARY KEY,
        global_id uuid NOT NULL,
        version_id int NOT NULL,
        name text NOT NULL,
        geom GEOMETRY(Point, 4326) NOT NULL,
        b1_guid uuid NOT NULL,
        b2_guid uuid NOT NULL,
        b3_guid uuid NOT NULL,
        state_name text NOT NULL,
        lga_name text NOT NULL,
        ward_name text NOT NULL,

        --We use LIKE so this will be copied over
        --Only global_id because the is before pilot are split into 2 different tables
        --unlike the outreach/fp tables which mix both before/after pilot
        UNIQUE(global_id)
        
        --prevent inserts to base table
        --https://stackoverflow.com/questions/9545783/how-to-prevent-inserts-in-the-parent-table
        --Can't use this since NO INHERIT only works for inheritance, not LIKE
        -- CHECK (false) no inherit       
    );
    
    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_BASE}
    (
        --Just use for common schema, not inheritance
        LIKE {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_BASE} INCLUDING ALL,        
        estimated_pop DOUBLE PRECISION,
        computed_pop DOUBLE PRECISION NOT NULL,
        fixed_catchment_perc DOUBLE PRECISION NOT NULL,
        uncovered_catchment_perc DOUBLE PRECISION NOT NULL,
        
        distance_closest_fp DOUBLE PRECISION,
        
        alt_names text NOT NULL
                
        --prevent inserts to base table
        --https://stackoverflow.com/questions/9545783/how-to-prevent-inserts-in-the-parent-table
        --Can't use this since NO INHERIT only works for inheritance, not LIKE
        --CHECK (false) no inherit
    );
    
    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GEOPODE}
    (
        --schema, not inheritance
        LIKE {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_BASE} INCLUDING ALL,
        is_primary bool NOT NULL
    ) ;
    
    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_BEFORE_PILOT}
    (
        LIKE {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_BASE} INCLUDING ALL
    ) ;

    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_DELETED_DEMOTED}
    (
        LIKE {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_BASE} INCLUDING ALL,
        is_primary bool NOT NULL,
        is_deleted bool NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_AFTER_PILOT}
    (
        --schema, not inheritance
        LIKE {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_BASE} INCLUDING ALL,
        
        hard_to_reach bool NOT NULL,
        nomadic bool NOT NULL,
        riverine bool NOT NULL,
        uninhabited bool NOT NULL,
        outreach_catchment_perc DOUBLE PRECISION NOT NULL,
        
        --Has a ci row with type='exclude' with a type=fixed_post HF to this SN's settlement part
        excluded_fixed_post bool NOT NULL,
        
        --Has a ci row with type='exclude' with an type=outreach HF to this SN's settlement part
        excluded_outreach bool NOT NULL,
        
        in_custom_catchment bool NOT NULL,
        
        
        --Excluded from an outreach, and include by an outreach with same parent hf
        excluded_custom_same_outreach bool NOT NULL,
        --Excluded by an outreach, and include by a different outreach with different parent hf
        excluded_custom_diff_outreach bool NOT NULL,
        
        --Excluded from an FP, and include by an outreach with same parent hf as the FP
        --Note FP cannot have custom includes
        excluded_custom_same_fp bool NOT NULL,
        
        --Excluded from an FP, and include by an outreach with different parent hf as the FP
        excluded_custom_diff_fp bool NOT NULL,

        --if there exists in another boundary with same global id (normally deleted too)
        changed_boundary bool NOT NULL
        
        --Failed for kaduna
        --CHECK(distance_closest_fp IS NOT NULL)
    ) ;
        
    
    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_SETTLEMENT_PARTS}
    (
        id SERIAL PRIMARY KEY,
        global_id uuid NOT NULL,
        
        sn_global_id uuid NOT NULL,
        
        name text NOT NULL,
        geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
        b1_guid uuid NOT NULL,
        b2_guid uuid NOT NULL,
        b3_guid uuid NOT NULL,
        state_name text NOT NULL,
        lga_name text NOT NULL,
        ward_name text NOT NULL,

        gis_pop DOUBLE PRECISION NOT NULL,

        uninhabited bool NOT NULL,
        is_before_pilot bool NOT NULL,
        UNIQUE (global_id, is_before_pilot)
        
    );

    --Not indicators so we create the views by hand
    CREATE OR REPLACE VIEW {SCHEMA_EXPORT}.{TABLE_SETTLEMENT_PARTS}_before_pilot
    AS SELECT * FROM {SCHEMA_EXPORT}.{TABLE_SETTLEMENT_PARTS} WHERE is_before_pilot;
    
    CREATE OR REPLACE VIEW {SCHEMA_EXPORT}.{TABLE_SETTLEMENT_PARTS}_after_pilot
    AS SELECT * FROM {SCHEMA_EXPORT}.{TABLE_SETTLEMENT_PARTS} WHERE NOT is_before_pilot;
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        conn.commit()
