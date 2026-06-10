import os 
import shlex

from matplotlib import table
from lib.thread_utils import run_process_stream_output
import psycopg2
import psycopg2.extensions
import pprint 
import psycopg2.extras
from tabulate import tabulate

conn: psycopg2.extensions.connection = None 
dest_conn: psycopg2.extensions.connection = None 

def import_to_local():
    """
    Imports shapefile to local    
    """

    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS partitions.kano_raw_hf")
        conn.commit()

    dbname=os.environ["DB_NAME"]
    user=os.environ["DB_USER"]
    password=os.environ["DB_PASSWORD"]
    host=os.environ["DB_HOST"]
    port=os.environ["DB_PORT"]

    assert dbname == 'gmt'
    
    cmd_line_parts = [
        "ogr2ogr",
        "--config PG_USE_COPY YES",
        "-lco GEOMETRY_NAME=geom",
        "-lco FID=id",
        "-lco",
        shlex.quote("COLUMN_TYPES=globalid=uuid"),
        "-progress",
    shlex.quote(f"PG: host={host} port={port} dbname={dbname} user={user} password={password}"),
    #"/data/Kaduna_health_facilities_spatial_v1.0/Kaduna_health_facilities_spatial_v1.0.shp",
    "/data/Kano_health_facilities_spatial_v1.0/Kano_health_facilities_spatial_v1.0.shp",
    "-nln",
     shlex.quote("partitions.kano_raw_hf")
    ]

    conn.close()

    run_process_stream_output(" ".join(cmd_line_parts), cwd = "/rust")

    db_connect()

    with conn.cursor() as cur:
        cur.execute("""
    ALTER TABLE partitions.kano_raw_hf
    ADD COLUMN boundary_polygon uuid ;
                    """)
        conn.commit()


def set_boundaries(table_name = "kano_raw_hf"):
    

    with conn.cursor() as cur:
        # set exact lexo and geographic match
        cur.execute(f"""
with matches as (
    select raw.id, b3.global_id
    from partitions.{table_name} raw
    inner join boundary.polygon_latest b1 
        on b1.name = raw.statename and b1.level = 1
    inner join boundary.polygon_latest b2 
        on b2.level = 2 
            and b2.boundary_polygon = b1.global_id  
            and b2.name = raw.lganame
    inner join boundary.polygon_latest b3 
        on b3.level = 3 
            and b3.boundary_polygon = b2.global_id 
            and ST_INtersects(raw.geom, b3.geom) 
            and b3.name = raw.wardname
    WHERE raw.boundary_polygon is null
)
UPDATE partitions.{table_name} raw
SET boundary_polygon = m.global_id
FROM matches m
WHERE m.id = raw.id
AND raw.boundary_polygon is null
;                
                    
                    """)
        
# --set exact lexo matches
        cur.execute(f"""
with matches as (
    select raw.id, b3.global_id
    from partitions.{table_name} raw
    inner join boundary.polygon_latest b1 
        on b1.name = raw.statename 
            and b1.level = 1
    inner join boundary.polygon_latest b2 
        on b2.level = 2 
            and b2.boundary_polygon = b1.global_id  
            and b2.name = raw.lganame
    inner join boundary.polygon_latest b3 
        on b3.level = 3 
            and b3.boundary_polygon = b2.global_id 
            and b3.name = raw.wardname
    WHERE raw.boundary_polygon is null
)
UPDATE partitions.{table_name} raw
SET boundary_polygon = m.global_id
FROM matches m
WHERE m.id = raw.id
AND raw.boundary_polygon is null
                    """)
        
        # --set exact geographic matches, close lex
        cur.execute(f"""
with matches as (
    select raw.id, b3.global_id
    from partitions.{table_name} raw
    inner join boundary.polygon_latest b3 
        on b3.level = 3 
            and ST_INtersects(raw.geom, b3.geom) 
            and levenshtein(b3.name,raw.wardname) <= 3
    inner join boundary.polygon_latest b2 
        on b2.level = 2 
            and b3.boundary_polygon = b2.global_id 
            and levenshtein(b2.name, raw.lganame) <= 1
    inner join boundary.polygon_latest b1 
        on b1.level = 1 
            and b2.boundary_polygon = b1.global_id 
            AND b1.name = raw.statename
    WHERE raw.boundary_polygon is null
)
UPDATE partitions.{table_name} raw
SET boundary_polygon = m.global_id
FROM matches m
WHERE m.id = raw.id
AND raw.boundary_polygon is null
;
""")
        conn.commit()


def set_kano_wards():
    table_name = "kano_raw_hf"

    # Set boundary specific to the kano shapefile
    with conn.cursor() as cur:
        # set geographic match for explicit cases
        cur.execute(f"""
with matches as (
    select raw.id, b3.global_id
    from partitions.{table_name} raw
    inner join boundary.polygon_latest b3 
        on b3.level = 3 
            and ST_INtersects(raw.geom, b3.geom) 
    WHERE raw.boundary_polygon is null
)
UPDATE partitions.{table_name} raw
SET boundary_polygon = m.global_id
FROM matches m
WHERE m.id = raw.id
AND raw.boundary_polygon is null                    
AND raw.wardname IN (
'Unknown', 'Kura Sarki', 'Dambatta 1', 'Tudun Wada A', 'Tudun Wada B', 'Ragada',
'Kabo', 'Yan Kamaye'
)
        """)

        # Close lex matches

        # --set exact geographic matches, close lex
        cur.execute(f"""
with matches as (
    select raw.id, b3.global_id
    from partitions.{table_name} raw
    inner join boundary.polygon_latest b3 
        on b3.level = 3 
            and levenshtein(b3.name,raw.wardname) <= 3
    inner join boundary.polygon_latest b2 
        on b2.level = 2 
            and b3.boundary_polygon = b2.global_id 
            and levenshtein(b2.name, raw.lganame) <= 2
    inner join boundary.polygon_latest b1 
        on b1.level = 1 
            and b2.boundary_polygon = b1.global_id 
            AND b1.name = raw.statename
    WHERE raw.boundary_polygon is null
)
UPDATE partitions.{table_name} raw
SET boundary_polygon = m.global_id
FROM matches m
WHERE m.id = raw.id
AND raw.boundary_polygon is null
;
""")

    conn.commit()

def see_remaining_matches(table_name = "kano_raw_hf"):
    sql = f"""
    --see remaining lex & geo
select raw.id, 
raw.statename, raw.lganame, raw.wardname, 
 
g1.name as geo_state, g2.name as geo_lga, g3.name as geo_ward,

n3.name as candidate_ward,
levenshtein(n3.name, raw.wardname),
ST_Distance(raw.geom::geography, n3.geom::geography)

 from partitions.{table_name} raw
left join boundary.polygon_latest n1 on n1.level = 1 and raw.statename = n1.name
--in kaduna lga name can be a bit off
left join boundary.polygon_latest n2 on n2.level = 2 and n2.boundary_polygon = n1.global_id and levenshtein(n2.name, raw.lganame) <= 1
left join boundary.polygon_latest n3 on n3.level = 3 and n3.boundary_polygon = n2.global_id
    AND ST_Distance(raw.geom::geography, n3.geom::geography) < 2500
left join boundary.polygon_latest g3 on g3.level = 3 and ST_INtersects(raw.geom, g3.geom)
left join boundary.polygon_latest g2 on g2.level = 2 and g3.boundary_polygon = g2.global_id
left join boundary.polygon_latest g1 on g1.level = 1 and g2.boundary_polygon = g1.global_id
where raw.boundary_polygon is null
order by id, levenshtein(n3.name, raw.wardname);
"""
    with conn.cursor(cursor_factory=psycopg2.extras.NamedTupleCursor) as cur:
        cur.execute(sql)

        rows = cur.fetchall()

        print(tabulate(rows, headers=
                       ["id", 
                        "Raw State",
                        "Raw LGA",
                        "Raw Ward",
                        "Geo State",
                        "Geo LGA",
                        "Geo Ward",
                        "Candidate Ward",
                        "Leven dist",
                        "Geo Dist"
                        ], tablefmt="grid"))

        # for r in rows:
        #     pprint.pp(rows)

def db_connect():
    global conn
    global dest_conn

    conn = psycopg2.connect(
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"]
    )

    dest_conn = psycopg2.connect(
        dbname=os.environ.get("DEST_DB_NAME", "gmt"),
        user=os.environ.get("DEST_DB_USER", "postgres"),
        password=os.environ.get("DEST_DB_PASSWORD", "postgres"),
        host=os.environ.get("DEST_DB_HOST", "db"),
        port=os.environ.get("DEST_DB_PORT", "5432")
    )




def check_exists_in_correct_ward(table_name = "kano_raw_hf"):
    """
    Make sure this HF exists in the correct ward with name and location matching
    """

    # First make a optimized table like latest but including deletions

    sql = f"""
    --DROP TABLE IF EXISTS partitions.hf_ids;
    DROP MATERIALIZED VIEW IF EXISTS partitions.hf_ids; 

    CREATE MATERIALIZED VIEW partitions.hf_ids AS 
    SELECT DISTINCT ON (boundary_polygon, global_id)
        boundary_polygon, global_id,
        version_id, is_deleted
    FROM partitions.all_ids
        where partition_table_schema = 'partitions_health_facility_point'
    ORDER BY boundary_polygon, global_id, version_id DESC;
    
    CREATE INDEX hf_ids_guid ON partitions.hf_ids (global_id);

    """

    with conn.cursor() as cur:
        cur.execute(sql)

        conn.commit()

        # Show all that do not exist in the correct ward
        sql = f"""
        --raw.boundary_polygon is the chosen ward from the queries to match the 
        --boundary properly 
SELECT raw.id, raw.globalid,
    raw.wardname,
    r2.name as "Correct LGA", r3.name as "Correct Ward",
    raw.name as "HF Name",
    c2.name as "Current LGA", c3.name as "Current Ward",
    g3.name as "Geo ward",
    ai.version_id, ai.is_deleted,
    c.comment, c.publish_user
FROM partitions.{table_name} raw
inner join boundary.polygon_latest r3 on r3.global_id = raw.boundary_polygon
inner join boundary.polygon_latest r2 on r3.boundary_polygon = r2.global_id
inner join boundary.polygon_latest r1 on r2.boundary_polygon = r1.global_id
left join partitions.hf_ids ai on ai.global_id =  raw.globalid
left join master.commits c on c.id = ai.version_id
left join boundary.polygon_latest c3 on c3.global_id = ai.boundary_polygon
left join boundary.polygon_latest c2 on c3.boundary_polygon = c2.global_id
left join boundary.polygon_latest c1 on c2.boundary_polygon = c1.global_id
left join boundary.polygon_latest g3 ON ST_Intersects(raw.geom, g3.geom) and g3.level = 3
WHERE NOT EXISTS (
    SELECT 1 FROM partitions.hf_ids
    WHERE hf_ids.global_id = raw.globalid
        AND hf_ids.boundary_polygon = raw.boundary_polygon
)
order by raw.id
        """

        cur.execute(sql)

        rows = cur.fetchall()

        print(tabulate(rows,         tablefmt="grid"))

        print(f"\n{sql}\nLength of rows not in correct ward {len(rows)}")

        # Exists in the wrong ward
        sql = """
        SELECT raw.id, raw.globalid,
raw.lganame, raw.wardname,
r2.name as "Correct LGA", r3.name as "Correct Ward",
c2.name as "Current LGA", c3.name as "Current Ward",
g3.name as "Geo ward",
raw.name as "HF Name",
ai.version_id, ai.is_deleted,
c.comment, c.publish_user
FROM partitions.kano_raw_hf raw
inner join boundary.polygon_latest r3 on r3.global_id = raw.boundary_polygon
inner join boundary.polygon_latest r2 on r3.boundary_polygon = r2.global_id
inner join boundary.polygon_latest r1 on r2.boundary_polygon = r1.global_id
left join partitions.hf_ids ai on ai.global_id =  raw.globalid
left join master.commits c on c.id = ai.version_id
left join boundary.polygon_latest c3 on c3.global_id = ai.boundary_polygon
left join boundary.polygon_latest c2 on c3.boundary_polygon = c2.global_id
left join boundary.polygon_latest c1 on c2.boundary_polygon = c1.global_id
left join boundary.polygon_latest g3 ON ST_Intersects(raw.geom, g3.geom) and g3.level = 3
WHERE EXISTS (
    SELECT 1 FROM partitions.hf_ids
    WHERE hf_ids.global_id = raw.globalid
        AND hf_ids.boundary_polygon != raw.boundary_polygon
        AND not hf_ids.is_deleted
)
order by raw.id
"""

        cur.execute(sql)

        rows = cur.fetchall()

        print(tabulate(rows, tablefmt="grid"))

        print(f"\n{sql}\nLength of rows in different ward, not deleted {len(rows)}")


def main():
    
    db_connect()

    # import_to_local()
    # #
    # set_boundaries()
    # #
    # set_kano_wards()
    # #
    # see_remaining_matches()

    check_exists_in_correct_ward()

if __name__ == "__main__":
    main()



