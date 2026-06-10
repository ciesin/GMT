from scripts.export_module.db_constants import *
import psycopg2
import psycopg2.extensions


def create_boundary_tables_and_populate(conn: psycopg2.extensions.connection):
    """
    Populates the wards that we will be processing
    
    :param conn: 
    """    
    sql = f"""
    CREATE TABLE {SCHEMA_EXPORT}.{TABLE_WARDS} AS 
    select b3.global_id as ward_guid, 
          b1.name as state_name, 
          b2.name as lga_name, 
          b3.name as ward_name, 
          b2.global_id as lga_guid,
          b1.global_id as state_guid,
          b3.geom 
           from
    boundary.polygon_latest b1
    inner join boundary.polygon_latest b2 on b2.boundary_polygon = b1.global_id and b2.level = 2
    inner join boundary.polygon_latest b3 on b3.boundary_polygon = b2.global_id and b3.level = 3
    
    where 
    b1.name IN ( 'Kaduna','Kano')
    
     --and b2.name in ('Dambatta','Dawakin Kudu', 'Dawakin Tofa', 'Gabasawa', 'Gaya', 'Ungogo')
     --and b2.name in ('Giwa', 'Chikun')
     
     and b2.name in (
        --kano lgas
        'Dambatta','Dawakin Kudu', 
        'Dawakin Tofa', 'Gabasawa', 
        'Gaya', 'Ungogo',
        
        --kaduna lgas
        'Giwa', 'Chikun'
        )
     
     --temp
       --and b3.global_id = 'fc46b5fc-b215-493b-9bbe-6e0ddcff8e1b' 
      -- AND b3.global_id = '4afb77cd-763e-491e-8904-9bb38ef2a370'
    AND b1.level = 1
    order by b1.name, b2.name, b3.name;
    
    CREATE INDEX idx_exp_wards_geom ON {SCHEMA_EXPORT}.{TABLE_WARDS}
    USING GIST(geom) ;
    """

    with conn.cursor() as cur:
        cur.execute(sql)

        sql = f"""
        CREATE TABLE {SCHEMA_EXPORT}.{TABLE_LGAS} AS 
        WITH lga_guids AS (
            SELECT DISTINCT lga_guid FROM {SCHEMA_EXPORT}.{TABLE_WARDS}
        )        
        select  
              b1.name as state_name, 
              b2.name as lga_name,
              b2.global_id as lga_guid,
              b1.global_id as state_guid,
              b2.geom 
        from
        lga_guids
            inner join boundary.polygon_latest b2 
                on b2.global_id = lga_guids.lga_guid 
            inner join boundary.polygon_latest b1
                on b1.global_id = b2.boundary_polygon
        
        order by b1.name, b2.name
        """

        cur.execute(sql)

        sql = f"""
            CREATE TABLE {SCHEMA_EXPORT}.{TABLE_STATES} AS
            WITH state_guids AS (
                SELECT DISTINCT state_guid FROM {SCHEMA_EXPORT}.{TABLE_LGAS}
            )             
            select  
                  b1.name as state_name,
                  b1.global_id as state_guid,
                  b1.geom 
            from
            state_guids
                inner join boundary.polygon_latest b1 
                    on b1.global_id = state_guids.state_guid 
                
            order by b1.name
        """

        cur.execute(sql)

        conn.commit()


def create_boundary_edit_tables(conn: psycopg2.extensions.connection):
    # how close the ward to lga or state boundaries to be considered on the boundary

    BOUNDARY_DIST_TOLERANCE = 100
    sql = f"""
    CREATE TABLE IF NOT EXISTS {SCHEMA_EXPORT}.{TABLE_BOUNDARY_ADJ}
    (
        id SERIAL PRIMARY KEY,
        global_id uuid NOT NULL,
        name text NOT NULL,
        geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
        b1_guid uuid NOT NULL,
        b2_guid uuid NOT NULL,
        b3_guid uuid NOT NULL,
        state_name text NOT NULL,
        lga_name text NOT NULL,
        ward_name text NOT NULL,
        
        comment text NOT NULL,
        is_state_boundary bool NOT NULL,
        is_lga_boundary bool NOT NULL
        
    );
    
    INSERT INTO {SCHEMA_EXPORT}.{TABLE_BOUNDARY_ADJ}
    (
        global_id,
        name,
        geom,
        b1_guid,
        b2_guid,
        b3_guid,
        state_name,
        lga_name,
        ward_name,
        comment,
        is_state_boundary,
        is_lga_boundary
    )
    
    select
        pe.global_id,
        b3.name,
        pe.geom,
        b1.global_id,
        b2.global_id,
        b3.global_id,
        b1.name,
        b2.name,
        b3.name, 
        pe.properties->>'comment' as comment,
        ST_Distance(
            ST_Boundary(b1.geom)::geography,
            ST_Boundary(b3.geom)::geography
        ) < {BOUNDARY_DIST_TOLERANCE} AS is_state_boundary,
        ST_Distance(
            ST_Boundary(b2.geom)::geography,
            ST_Boundary(b3.geom)::geography
        ) < {BOUNDARY_DIST_TOLERANCE} AS is_lga_boundary
      
    from boundary.polygon_edited_latest pe
    --Take just resolved edits, where the global_ids will match
    INNER JOIN boundary.polygon_latest b3 ON b3.global_id = pe.global_id 
    INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
    INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
    --5 are the baseline ones, we want things that have been changed
    where pe.version_id > 5;
    """

    with conn.cursor() as cur:
        cur.execute(sql)
        conn.commit()
