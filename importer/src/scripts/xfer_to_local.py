import os
import psycopg2
from sqlmodel import SQLModel, create_engine, Session, select
from typing import List
from sqlalchemy.sql import text
import uuid
import lib.db_utils as db_utils
import json
import sys
from psycopg2.extras import DictCursor
import psycopg2.extras
from lib.thread_utils import run_process_stream_output
import pprint
from check_all_id_problems import record_ids
from create_views import get_db_name


XFER_BOUNDARY_GUID_LIST = [
    # Kano
    '4f4bd140-a2c6-4b0d-a94b-44d2332cf512',
    # Kaduna
    'aa13d807-45e2-4ba8-96ce-371126023935',
]

# for g_idx, g in enumerate(XFER_BOUNDARY_GUID_LIST):
#     if g not in VIEW_BOUNDARY_GUID_LIST:
#         raise Exception(f"#{g_idx+1}: {g} not in view")

# Initialize an empty dictionary to store indices of elements
index_dict = {}

# Loop through the list
for i, item in enumerate(XFER_BOUNDARY_GUID_LIST):
    # Check if the item is already in the dictionary
    if item in index_dict:
        # If yes, print the index of the duplicate item
        raise Exception(f"Duplicate {item} at indices: {index_dict[item]} and {i}")
    else:
        # If no, add the item to the dictionary with its index
        index_dict[item] = [i]

# XFER_BOUNDARY_GUID_LIST = VIEW_BOUNDARY_GUID_LIST

src_db_name = os.environ["DB_NAME"]
target_db_name = os.environ.get("DEST_DB_NAME", "gmt")

if target_db_name not in ("gmt", "gmt_dev", "gmt_test", "gmt_training"):
    raise Exception("Unexpected target db name")

if src_db_name == target_db_name:
    raise Exception(f"{src_db_name} == {target_db_name}")

target_conn = psycopg2.connect(
    dbname=target_db_name,
    user=os.environ.get("DEST_DB_USER", "postgres"),
    password=os.environ.get("DEST_DB_PASSWORD", "postgres"),
    host=os.environ.get("DEST_DB_HOST", "db"),
    port=os.environ.get("DEST_DB_PORT", "5432")
)
dest_conn = target_conn

source_conn = psycopg2.connect(
    dbname=src_db_name,
    user=os.environ["DB_USER"],
    password=os.environ["DB_PASSWORD"],
    host=os.environ["DB_HOST"],
    port=os.environ["DB_PORT"]
)
source_conn.set_session(readonly=True)

sp_schema_name = "partitions_settlement_part"
sn_schema_name = "partitions_settlement_name"
ci_schema_name = "partitions_ri_catchment_item"
hf_schema_name = "partitions_health_facility_point"


class Boundary(SQLModel):
    partition_id: int
    name: str
    global_id: uuid.UUID


def fetch_ids():
    """
    This fetches id related data to put into the
    partition.all_ids table

    This table is used to detect the issues checked in
    check_problems
    :return:
    """
    b_ids = get_all_boundary_ids()

    create_id_table()

    for b in b_ids:
        #     if b.partition_id <= 7640:
        #         continue
        record_ids(source_conn, dest_conn, b.partition_id, b.global_id, True)





def get_hf_basic_info(hf_guid):
    # with dest_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as dest_cur:
    with dest_conn.cursor(cursor_factory=psycopg2.extras.NamedTupleCursor) as dest_cur:
        sql = f"""
            SELECT
            ('Routine Immunization' = ANY(hf.services)) as has_ri,
            hf.type,
            hf.frequency,
            hf.global_id,
            hf.name,
            b3.name as boundary_name,
            ST_Intersects(hf.geom, b3.geom) as in_b3_geospatially
            FROM partitions.hf_view_latest hf
            INNER JOIN boundary.polygon_latest b3 on b3.global_id = hf.boundary_polygon  
            WHERE hf.global_id = %s
            """

        dest_cur.execute(sql, (hf_guid,))

        row = dest_cur.fetchone()

        return row


def get_hf_catchment(hf_guid):
    with dest_conn.cursor(cursor_factory=psycopg2.extras.NamedTupleCursor) as dest_cur:
        sql = f"""
            SELECT
            ci.type as ci_type,
            ci.population_perc,
            sp.computed_pop,
            sn.name as set_name,
            b3.name as boundary_name
            FROM partitions.hf_view_latest hf
            INNER JOIN partitions.ci_view_latest ci ON ci.health_facility_point = hf.global_id
            INNER JOIN partitions.sp_view_latest sp ON ci.settlement_part = sp.global_id
            INNER JOIN partitions.sn_view_latest sn ON sn.settlement_part = sp.global_id AND sn.is_primary
            INNER JOIN boundary.polygon_latest b3 on b3.global_id = sn.boundary_polygon
            WHERE hf.global_id = %s
            """

        dest_cur.execute(sql, (hf_guid,))

        rows = list(dest_cur.fetchall())

        return rows


def investigate_fixed_post(fp_guid):
    # Prints details on a fixed post

    dest_cur = dest_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # basic info
    fp_row = get_hf_basic_info(fp_guid)

    print("*" * 80)
    print("*" * 80)
    print("Basic Info")

    # pprint.pp(fp_row)
    print(
        f"Fixed post [{fp_row.name:>30}] with freq {fp_row.frequency} has RI? {fp_row.has_ri} type {fp_row.type} in ward {fp_row.boundary_name}? {fp_row.in_b3_geospatially}")
    print("*" * 80)
    hf_catch = get_hf_catchment(fp_guid)

    print(f"Fixed post existing catchment")
    for r in hf_catch:
        pprint.pp(r)

    rows = get_nearby_settlements(fp_guid)

    for set_row in rows:
        print(
            f"Looking at settlement [{set_row.name:>30}] at distance {set_row.dist_m:>7.1f} from [{fp_row.name}] with pop {set_row.computed_pop:>7.1f}")

        if set_row.dist_m > 500:
            return

        set_catch_rows = get_settlement_catchment(set_row.sp_guid)

        for scr in set_catch_rows:
            print(
                f"CI Type: {scr.ci_type:>12} Pop %: {scr.population_perc:>5.1f} with HF [{scr.hf_name:>40}] of type [{scr.hf_type:>10}] freq [{scr.frequency:>15}] at dist [{scr.dist_m:>7.1f}]")
            # pprint.pp(scr)
            # print(f

    return

    sql = f"""
    SELECT
        hf.global_id
    FROM partitions.hf_view_latest hf 
    WHERE hf.parent = %s
    """

    dest_cur.execute(sql, (fp_guid,))

    rows = dest_cur.fetchall()

    outreach_guids = [r.global_id for r in rows]

    for o_guid in outreach_guids:
        print("*" * 80)
        print("*" * 80)
        print("Outreach")
        print("*" * 80)

        row = get_hf_basic_info(o_guid)

        pprint.pp(row)

        hf_catch = get_hf_catchment(o_guid)

        for r in hf_catch:
            pprint.pp(r)

    # Find direct outreaches
    pass


def get_nearby_settlements(hf_guid):
    # --Find nearby settlement parts
    with dest_conn.cursor(cursor_factory=psycopg2.extras.NamedTupleCursor) as dest_cur:
        sql = f"""        
        WITH hf_with_buf AS (
            select box2d(ST_Buffer(hf.geom::geography, 2000)::geometry) as bbox,
                * from
            partitions.hf_view_latest hf
            where hf.global_id = 'f810039e-2a19-40fc-958f-07bfe90c6fb8'
        )
        select sn.name,
            sp.computed_pop,
            ST_Distance(sn.geom::geography, hf.geom::geography) as dist_m,
            sp.global_id as sp_guid,
            sn.global_id as sn_guid,
            ST_X(sn.geom) as lon, ST_Y(sn.geom) as lat
        from hf_with_buf hf
        inner join partitions.sp_view_latest sp ON
            ST_Intersects(
                box2d(sp.geom),
                hf.bbox
            )
        inner join partitions.sn_view_latest sn
            on sn.settlement_part = sp.global_id AND sn.is_primary
        order by dist_m, sn.name;
            """

        dest_cur.execute(sql, (hf_guid,))

        rows = dest_cur.fetchall()

        return rows


def get_settlement_catchment(sp_guid):
    with dest_conn.cursor(cursor_factory=psycopg2.extras.NamedTupleCursor) as dest_cur:
        # show the hfs that are covering this guy
        sql = f"""
        SELECT ci.type as ci_type, ci.population_perc, hf.name as hf_name, hf.type as hf_type, hf.frequency, sn.name as set_name,
            ST_Distance(sn.geom::geography, hf.geom::geography) as dist_m 
        FROM partitions.sp_view_latest sp 
        INNER JOIN partitions.ci_view_latest ci on ci.settlement_part = sp.global_id
        INNER JOIN partitions.hf_view_latest hf on hf.global_id = ci.health_facility_point
        INNER JOIN partitions.sn_view_latest sn on sn.settlement_part = sp.global_id AND sn.is_primary
        WHERE sp.global_id = %s          
        ORDER BY ci.population_perc  
                    """

        dest_cur.execute(sql, (sp_guid,))

        rows = dest_cur.fetchall()

        return rows


def set_next_commit_id(cur_commit_id):
    dest_db = os.environ["DEST_DB_NAME"]
    src_db = os.environ["DB_NAME"]

    # dest can never be prod
    if dest_db == "gmt_prod":
        raise Exception("DEST DB is prod!!")

    # ok since we are using the dest commits table to set this

    print(f"Setting next commit id to {cur_commit_id}+1")

    sql = f"SELECT setval('master.commits_id_seq', {cur_commit_id}, true);"

    dest_cursor = target_conn.cursor()

    dest_cursor.execute(sql)

    target_conn.commit()


def get_last_commit_id() -> int:
    query = "select max(id) from master.commits;"

    dest_cursor = dest_conn.cursor()

    dest_cursor.execute(query)

    row2 = dest_cursor.fetchone()

    return row2[0]


def clean_recent_history(boundary: Boundary, from_version_id=80):
    for partition_schema in ["partitions_settlement_name", "partitions_settlement_part",
                             "partitions_health_facility_point", "partitions_ri_catchment_item"]:
        table_name = partition_schema.replace("partitions_", "") + "_" + str(boundary.partition_id).zfill(5)

        dest_cur = target_conn.cursor()

        dest_cur.execute(f"DELETE FROM {partition_schema}.{table_name} where version_id >= {from_version_id}")

        target_conn.commit()

        dest_cur.execute(f"REFRESH MATERIALIZED VIEW {partition_schema}.{table_name}_latest")

        dest_cur.close()


def xfer_commit_history():
    dest_db = os.environ["DEST_DB_NAME"]
    src_db = os.environ["DB_NAME"]

    # dest can never be prod
    if dest_db == "gmt_prod":
        raise Exception("DEST DB is prod!!")

    if dest_db == src_db:
        raise Exception(f"DEST DB {dest_db} == src db {src_db}")

    if dest_db != "gmt":
        print(f"Are you sure you want to xfer to {dest_db} from {src_db} ? (y/n)")
        # print(f"Not xfering commit history for {os.environ['DEST_DB_NAME']}")
        choice = input()
        if choice != "y":
            return

    src_cursor = source_conn.cursor()
    src_cursor.execute("""
    SELECT id, publish_user, comment, timestamp, is_published FROM master.commits
    """)

    src_rows = src_cursor.fetchall()

    dest_cursor = dest_conn.cursor()

    upsert_query = """
        INSERT INTO master.commits (id, publish_user, comment, timestamp, is_published)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (id)
        DO UPDATE SET
        publish_user = EXCLUDED.publish_user,
        comment = EXCLUDED.comment,
        timestamp = EXCLUDED.timestamp,
        is_published = EXCLUDED.is_published;
    """

    for row in src_rows:
        dest_cursor.execute(upsert_query, row)

        # Commit changes to the destination database
    dest_conn.commit()




def need_to_xfer_partition(boundary: Boundary):
    partition_id = boundary.partition_id

    ci_table_name = "ri_catchment_item_" + str(partition_id).zfill(5)
    sn_table_name = "settlement_name_" + str(partition_id).zfill(5)
    sp_table_name = "settlement_part_" + str(partition_id).zfill(5)
    hf_table_name = "health_facility_point_" + str(partition_id).zfill(5)

    # for prod => training, we want before pilot, so it is 
    #  WHERE version_id > 19 and version_id not in (153, 154, 269)';
    dest_db_name = get_db_name(dest_conn)
    where_clause = ""
    ci_where_clause = "WHERE type != 'generated'"

    if dest_db_name == "gmt_training":
        where_clause = "WHERE version_id <= 19 OR version_id IN (153, 154, 269, 338)"
        ci_where_clause = "WHERE type != 'generated' AND (version_id <= 19 OR version_id IN (153, 154, 269, 338))"

    sql = f"""
    WITH ci AS (
        SELECT count(*) as ci_count, MAX(version_id) as ci_max_version_id 
        FROM {ci_schema_name}.{ci_table_name}
        {ci_where_clause}
    ),
    sp AS (
        SELECT count(*) as sp_count, MAX(version_id) as sp_max_version_id 
        FROM {sp_schema_name}.{sp_table_name}
        {where_clause}
    ),
    sn AS (
        SELECT count(*) as sn_count, MAX(version_id) as sn_max_version_id 
        FROM {sn_schema_name}.{sn_table_name}
        {where_clause}
    ),
    hf AS (
        SELECT count(*) as hf_count, MAX(version_id) as hf_max_version_id 
        FROM {hf_schema_name}.{hf_table_name}
        {where_clause}
    )
    SELECT * FROM ci, sp, sn, hf
    """

    # usually prod
    source_cur = source_conn.cursor(cursor_factory=psycopg2.extras.NamedTupleCursor)

    source_cur.execute(sql)

    s_info = source_cur.fetchone()

    source_cur.close()

    dest_cur = dest_conn.cursor(cursor_factory=psycopg2.extras.NamedTupleCursor)

    # check everything in dest
    sql = f"""
    WITH ci AS (
        SELECT count(*) as ci_count, MAX(version_id) as ci_max_version_id 
        FROM {ci_schema_name}.{ci_table_name}
        WHERE type != 'generated'
    ),
    sp AS (
        SELECT count(*) as sp_count, MAX(version_id) as sp_max_version_id 
        FROM {sp_schema_name}.{sp_table_name}
    ),
    sn AS (
        SELECT count(*) as sn_count, MAX(version_id) as sn_max_version_id 
        FROM {sn_schema_name}.{sn_table_name}
    ),
    hf AS (
        SELECT count(*) as hf_count, MAX(version_id) as hf_max_version_id 
        FROM {hf_schema_name}.{hf_table_name}
    )
    SELECT * FROM ci, sp, sn, hf
    """

    dest_cur.execute(sql)

    d_info = dest_cur.fetchone()

    dest_cur.close()

    if s_info.ci_count != d_info.ci_count or s_info.ci_max_version_id != d_info.ci_max_version_id:
        print(f"Ci diff, need to xfer")
        pprint.pp(s_info)
        pprint.pp(d_info)
        return True

    if s_info.sp_count != d_info.sp_count or s_info.sp_max_version_id != d_info.sp_max_version_id:
        print(f"sp diff, need to xfer")
        pprint.pp(s_info)
        pprint.pp(d_info)
        return True

    if s_info.sn_count != d_info.sn_count or s_info.sn_max_version_id != d_info.sn_max_version_id:
        print(f"sn diff, need to xfer")
        pprint.pp(s_info)
        pprint.pp(d_info)
        return True

    if s_info.hf_count != d_info.hf_count or s_info.hf_max_version_id != d_info.hf_max_version_id:
        print(f"hf diff, need to xfer")
        pprint.pp(s_info)
        pprint.pp(d_info)
        return True

    return False

def transfer_table(schema_name: str, table_name: str):
    # Assumes the table_name has a materialized view with _latest suffix
    print(f"Xfering {schema_name}.{table_name}")

    column_names = db_utils.get_column_names(target_conn, schema_name, table_name)

    # print("Column names", column_names)

    column_names.remove("properties")

    # Create a cursor for the source database
    source_cur = source_conn.cursor()

    # Execute a SELECT query to fetch desired columns from source database
    col_list = ", ".join([f"\"{c}\"" for c in column_names])

    dest_db_name = get_db_name(dest_conn)

    where_clause = ""
    if dest_db_name == "gmt_training":
        where_clause = "WHERE version_id <= 19 OR version_id IN (153, 154, 269, 338)"

    source_cur.execute(f"SELECT properties, {col_list} FROM {schema_name}.{table_name} {where_clause}")

    # Fetch all rows from the query result
    rows = source_cur.fetchall()

    # Close the cursor and connection for the source database
    source_cur.close()

    # Create a cursor for the destination database
    dest_cur = target_conn.cursor()

    dest_cur.execute(f"TRUNCATE TABLE {schema_name}.{table_name}")
    values_list = ", ".join(["%s" for _ in column_names])
    # Insert the fetched data into the destination database
    for row in rows:
        row = list(row)
        row[0] = json.dumps(row[0])
        # print(row)
        dest_cur.execute(
            f"INSERT INTO {schema_name}.{table_name} (properties, {col_list}) VALUES (%s, {values_list})", row)

    dest_cur.execute(f"REFRESH MATERIALIZED VIEW {schema_name}.{table_name}_latest")

    # Commit the transaction
    target_conn.commit()

    dest_cur.close()


def xfer_partition(boundary: Boundary):
    for partition_schema in ["partitions_settlement_name", "partitions_settlement_part",
                             "partitions_health_facility_point", "partitions_ri_catchment_item"]:
        table_name = partition_schema.replace("partitions_", "") + "_" + str(boundary.partition_id).zfill(5)

        transfer_table(partition_schema, table_name)


def create_id_table():
    sql = f"""
    DROP TABLE IF EXISTS partitions.all_ids;

    CREATE TABLE IF NOT EXISTS partitions.all_ids (
    partition_table_name text  NOT NULL,
    partition_table_schema text  NOT NULL,
    global_id uuid NOT NULL,
    version_id int NOT NULL,
    partition_id int NOT NULL,
    boundary_polygon uuid NOT NULL,
    is_deleted bool NOT NULL
    --UNIQUE (global_id, version_id, boundary_polygon)
    )
    """

    target_cur = target_conn.cursor()
    target_cur.execute(sql)

    target_conn.commit()


def get_boundary_ids() -> List[Boundary]:
    if len(XFER_BOUNDARY_GUID_LIST) == 0:
        return []

    query = text("""
WITH
    agg_extent_4326 AS (
        SELECT ST_Extent(b.geom) as geom_4326
        FROM boundary.polygon_latest b
        WHERE b.global_id = :b_id 
    ),
    agg_extent_3857 AS (
        SELECT ST_Transform( ST_SetSrid(a.geom_4326, 4326), 3857) as geom_envelope
        FROM agg_extent_4326 a
    ),
    extended_extent AS (
        SELECT ST_Transform(ST_SetSRID(
            ST_MakeBox2D(
                ST_Point(
                    ST_XMin(a.geom_envelope) - :extent_padding_meters,
                    ST_YMin(a.geom_envelope) - :extent_padding_meters
                ),
                ST_Point(
                    ST_XMax(a.geom_envelope) + :extent_padding_meters,
                    ST_YMax(a.geom_envelope) + :extent_padding_meters
                )
            ), 3857), 4326) as geom FROM agg_extent_3857 a
    )
    SELECT bid.id as partition_id, bid.global_id, b.name
    FROM boundary.polygon_latest b
        INNER JOIN partitions.boundary_id bid ON b.global_id = bid.global_id
        , extended_extent ee
    WHERE ST_Intersects(ee.geom, b.geom)
        AND b.level = :operating_level
    ORDER BY bid.id
        """)

    dbname = os.environ["DB_NAME"]
    user = os.environ["DB_USER"]
    password = os.environ["DB_PASSWORD"]
    host = os.environ["DB_HOST"]
    port = os.environ["DB_PORT"]

    engine = create_engine(f'postgresql://{user}:{password}@{host}:{port}/{dbname}', echo=False)
    # cur = source_conn.cursor()
    # cur.execute(query, b_id, 3, 3000)

    all_results = {}

    # Create a SQLModel session
    with Session(engine) as session:

        for b_guid in XFER_BOUNDARY_GUID_LIST:
            # Execute the custom query
             
            results = session.exec(query, params={  # type: ignore 
                "b_id": b_guid, 
                "extent_padding_meters": 3000,
                "operating_level": 3})

            # Convert the SQLModel results to Pydantic objects
            pydantic_objects = [Boundary.model_validate(result) for result in results]

            for p in pydantic_objects:
                all_results[p.partition_id] = p

    # Close the connection
    # conn.close()

    return all_results.values()  # type: ignore 


def get_boundary_ids_without_adj() -> List[Boundary]:
    if len(XFER_BOUNDARY_GUID_LIST) == 0:
        return []

    query = text("""

    SELECT bid.id as partition_id, bid.global_id, b.name
    FROM boundary.polygon_latest b
        INNER JOIN partitions.boundary_id bid ON b.global_id = bid.global_id

    WHERE bid.global_id = :b_id 
    ORDER BY bid.id
        """)

    dbname = os.environ["DB_NAME"]
    user = os.environ["DB_USER"]
    password = os.environ["DB_PASSWORD"]
    host = os.environ["DB_HOST"]
    port = os.environ["DB_PORT"]

    engine = create_engine(f'postgresql://{user}:{password}@{host}:{port}/{dbname}', echo=True)
    # cur = source_conn.cursor()
    # cur.execute(query, b_id, 3, 3000)

    all_results = {}

    # Create a SQLModel session
    with Session(engine) as session:

        for b_guid in XFER_BOUNDARY_GUID_LIST:
            # Execute the custom query
            results = session.exec(query, params={  # type: ignore 
                "b_id": b_guid})  # type: ignore 

            # Convert the SQLModel results to Pydantic objects
            pydantic_objects = [Boundary.model_validate(result) for result in results]

            for p in pydantic_objects:
                all_results[p.partition_id] = p

    # Close the connection
    # conn.close()

    return all_results.values() # type: ignore 


def get_all_boundary_ids() -> List[Boundary]:
    query = text("""
    SELECT bid.id as partition_id, bid.global_id, b3.name
    FROM boundary.polygon_latest b3
        INNER JOIN boundary.polygon_latest b2 ON b2.global_id = b3.boundary_polygon
        INNER JOIN boundary.polygon_latest b1 ON b1.global_id = b2.boundary_polygon
        INNER JOIN partitions.boundary_id bid ON b3.global_id = bid.global_id
    WHERE b3.level = :operating_level
    AND b1.name = 'Kano'
    ORDER BY bid.id
        """)

    dbname = os.environ["DB_NAME"]
    user = os.environ["DB_USER"]
    password = os.environ["DB_PASSWORD"]
    host = os.environ["DB_HOST"]
    port = os.environ["DB_PORT"]

    engine = create_engine(f'postgresql://{user}:{password}@{host}:{port}/{dbname}', echo=True)

    # Create a SQLModel session
    with Session(engine) as session:
        # Execute the custom query
        results = session.exec(query, params={  # type: ignore 
            "operating_level": 3})  # type: ignore 

        # Convert the SQLModel results to Pydantic objects
        pydantic_objects = [Boundary.model_validate(result) for result in results]

    # Close the connection
    # conn.close()

    return pydantic_objects



def transfer_boundaries():
    for table_name in ["polygon", "polygon_edited", "polygon_simplified"]:
        # simplified fails b/c no props column
        transfer_table("boundary", table_name)


def main():
    #
    #transfer_boundaries()

    # fetch_ids()

    # sys.exit(0)

    """
    Will check which boundaries are out of sync and xfer
    the data as well as the id info

    Xfers the commit history

    Generally the source will be PROD and the target LOCAL
    """

    xfer_commit_history()

    b_ids = get_boundary_ids()
    # b_ids = get_boundary_ids_without_adj()

    # print("B_ids ", b_ids)

    for idx, b in enumerate(b_ids):

        if not need_to_xfer_partition(b):  # and str(b.global_id) != '2777fb44-57ec-493f-b85d-d5371ca98011':
            # print(f'NO NEED to Transfer {1+idx} of {len(b_ids)}: {b} from {os.environ["DB_NAME"]} to {os.environ["DEST_DB_NAME"]}')
            continue

        

        print(
            f'Transfering {1 + idx} of {len(b_ids)}: {b} from {os.environ["DB_NAME"]} to {os.environ["DEST_DB_NAME"]}')
        # clean_recent_history(b, 24)

        xfer_partition(b)
        record_ids(source_conn, dest_conn, b.partition_id, b.global_id, False)

    # create_helper_views(True, VIEW_BOUNDARY_GUID_LIST)
    # create_helper_views(False, VIEW_BOUNDARY_GUID_LIST)

    # also set version
    latest_commit_id = get_last_commit_id()
    set_next_commit_id(latest_commit_id)

if __name__ == "__main__":
    main()