from scripts.export_module.db_constants import *
import psycopg2.extensions


def create_catchment_table(
    conn: psycopg2.extensions.connection,
    baseline_conn: psycopg2.extensions.connection):
    """
    Creates the catchment polygons in the database
    """
    with conn.cursor() as cur:
        sql = f"""
    --temp
    DROP TABLE IF EXISTS {SCHEMA_EXPORT}.{TABLE_CATCHMENT_POLYGONS};
    
    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_CATCHMENT_POLYGONS} (
        id SERIAL PRIMARY KEY,
        geom GEOMETRY(Polygon, 4326) NOT NULL,
        
        hf_guid uuid NOT NULL,
        fixed_post_name text NOT NULL,
        outreach_name text,
        is_outreach bool NOT NULL,
        
        b1_guid uuid NOT NULL,
        b2_guid uuid NOT NULL,
        b3_guid uuid NOT NULL,
        state_name text NOT NULL,
        lga_name text NOT NULL,
        ward_name text NOT NULL,
        
        gis_pop double precision NOT NULL,
        est_gis_pop double precision NOT NULL,
        est_pop double precision NOT NULL,

        is_before_pilot bool NOT NULL
    );

    CREATE OR REPLACE VIEW {SCHEMA_EXPORT}.{TABLE_CATCHMENT_POLYGONS}_before_pilot
    AS SELECT * FROM  {SCHEMA_EXPORT}.{TABLE_CATCHMENT_POLYGONS} where is_before_pilot;


    CREATE OR REPLACE VIEW {SCHEMA_EXPORT}.{TABLE_CATCHMENT_POLYGONS}_after_pilot
    AS SELECT * FROM  {SCHEMA_EXPORT}.{TABLE_CATCHMENT_POLYGONS} where NOT is_before_pilot;
    """

        cur.execute(sql)

        # Create a stored procedure we'll need

        sql = f"""
--make raster functions available        
--create extension IF NOT EXISTS postgis_raster;

--converts a bit field into a 2d double array, which we need to set raster values        
CREATE OR REPLACE FUNCTION convert_bit_varying_to_double_precision(bit_data bit varying, raster_width int, raster_height int)
RETURNS double precision[][]
AS $$
DECLARE
    i int;
    j int;
    row_idx int;
    col_idx int;
    result double precision[][];
BEGIN
    -- Initialize the result array with dimensions specified by raster_width and raster_height
    result := array_fill(0.0::double precision, ARRAY[raster_height, raster_width]);

    -- Loop through each byte in the bytea data
    FOR i IN 0 .. length(bit_data) - 1 LOOP
        col_idx := i % raster_width; -- Column index (i mod raster_width)
        row_idx := i / raster_width; -- Row index (i / raster_width)

        --RAISE LOG 'Processed bit at position (%, %)', row_idx, col_idx;
        -- Loop through each bit in the current byte

        --postgresql array 1 based
        result[1+row_idx][1+col_idx] :=
                CASE WHEN get_bit(bit_data, i) > 0 THEN 1.0 ELSE 0.0 END;

    END LOOP;

    RETURN result;
END;
$$
LANGUAGE plpgsql;
"""
        cur.execute(sql)
        conn.commit()

    # we also need this on training
    with baseline_conn.cursor() as cur:
        cur.execute(sql)
        baseline_conn.commit()
        

def create_hf_tables(conn: psycopg2.extensions.connection,):
    sql = f"""

    CREATE TYPE export_tag AS ENUM (
        'grid3_geopode',
        'before_pilot',
        'after_pilot'
    );

    CREATE SCHEMA IF NOT EXISTS {SCHEMA_EXPORT};

    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_GMT_HF_BASE}
    (
        --no primary key, inheritance doesn't work with that anyway
        global_id uuid NOT NULL,

        --Needed to distinguish between grid3/geopode
        --and with the kano & kaduna update
        version_id int NOT NULL,

        name text NOT NULL,
        geom GEOMETRY(Point, 4326) NOT NULL,
        b1_guid uuid NOT NULL,
        b2_guid uuid NOT NULL,
        b3_guid uuid NOT NULL,
        state_name text NOT NULL,
        lga_name text NOT NULL,
        ward_name text NOT NULL,
        type hf_type NOT NULL,

        tag export_tag NOT NULL,

        is_deleted boolean NOT NULL,
        
        --to this hf only
        computed_catchment_pop double precision,
        
        --prevent inserts to base table
        --https://stackoverflow.com/questions/9545783/how-to-prevent-inserts-in-the-parent-table
        CHECK (false) no inherit
    );
    
    --Use inheritance instead of like since we want to be able
    --to query the base table for FP + Outreach
    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_GMT_FP_BASE}
    (
                    
        has_ri bool NOT NULL,

        --if there exists in another boundary with same global id (normally deleted too)
        changed_boundary bool NOT NULL,
        
        --synonyms , seperated if more than 1
        alt_names text NOT NULL,
        
        --Type in the UI
        level_of_care hf_level_of_care NOT NULL,
        
        outreach_count int NOT NULL,
        
        --Unclear if this is any outreach or a child, for now, doing any outreach
        dist_closest_outreach DOUBLE PRECISION DEFAULT NULL,
        
        --Unique constraints are not inherited
        UNIQUE(global_id, tag, b3_guid),
        CHECK(type = 'fixed_post'),
        CHECK(computed_catchment_pop is NOT NULL OR tag = 'grid3_geopode'),
        CHECK(dist_closest_outreach IS NOT NULL OR tag != 'after_pilot' OR is_deleted)
    ) INHERITS ({SCHEMA_EXPORT}.{TABLE_GMT_HF_BASE});
    
    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_GMT_OUTREACH_BASE}
    (
        parent_hf uuid NOT NULL,
        
        --Aka is a custom catchment
        has_explicit_include bool NOT NULL,
        
        dist_closest_outreach DOUBLE PRECISION,
        dist_parent DOUBLE PRECISION,
        
        --Unique constraints are not inherited
        UNIQUE(global_id, tag, b3_guid),
        CHECK(type = 'outreach'),
        CHECK(dist_closest_outreach IS NOT NULL OR is_deleted),
        CHECK(dist_parent IS NOT NULL OR is_deleted),
        CHECK(computed_catchment_pop is NOT NULL)
    ) INHERITS ({SCHEMA_EXPORT}.{TABLE_GMT_HF_BASE});
        """
    with conn.cursor() as cur:
        cur.execute(sql)
        conn.commit()        