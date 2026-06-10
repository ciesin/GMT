from scripts.export_module.db_constants import *
import psycopg2.extensions


def remove_changed_boundary_from_deleted(conn: psycopg2.extensions.connection,):
    # We don't want changed boundaries to count as deleted

    sql = f"""
    DELETE FROM {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_DELETED_DEMOTED}
    WHERE global_id IN (
        SELECT global_id FROM
        {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_AFTER_PILOT} a 
        WHERE a.changed_boundary
    )
    """

    with conn.cursor() as cur:
        cur.execute(sql)

        conn.commit()


def trim_geopode_settlements(conn: psycopg2.extensions.connection,):
    target_table_name = TABLE_SETTLEMENTS_GEOPODE

    sql = f"""
    CREATE INDEX idx_exp_global_id 
    ON {SCHEMA_EXPORT}.{target_table_name} (global_id);
    
    CREATE INDEX idx_exp_version_id 
    ON {SCHEMA_EXPORT}.{target_table_name} (version_id);
    
    CREATE INDEX idx_exp_is_primary 
    ON {SCHEMA_EXPORT}.{target_table_name} (is_primary);
    """

    with conn.cursor() as cur:
        cur.execute(sql)
        conn.commit()

        sql = f"""
DELETE FROM {SCHEMA_EXPORT}.{target_table_name} AS d 
WHERE EXISTS (
    SELECT 1 FROM {SCHEMA_EXPORT}.{target_table_name} e 
    WHERE e.global_id = d.global_id
    AND e.version_id > d.version_id
    )        
        """

        cur.execute(sql)
        print(f"Removed {cur.rowcount} old versions in {SCHEMA_EXPORT}.{target_table_name}")

        sql = f"""
CREATE INDEX idx_exp_geom ON {SCHEMA_EXPORT}.{target_table_name}
    USING GIST(geom) ;
        """

        cur.execute(sql)

        conn.commit()
        

def add_set_indexes(conn: psycopg2.extensions.connection, target_table_name: str):

    with conn.cursor() as cur:
        sql = f"""
        CREATE INDEX idx_{target_table_name}_global_id ON {SCHEMA_EXPORT}.{target_table_name}
            (global_id);
            
        CREATE INDEX idx_{target_table_name}_geom ON {SCHEMA_EXPORT}.{target_table_name}
            USING GIST(geom) ;
                """

        cur.execute(sql)

        conn.commit()
