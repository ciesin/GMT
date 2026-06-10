import os
import psycopg2
from sqlmodel import SQLModel, create_engine, Session, select
from typing import List, Union
from sqlalchemy.sql import text
import uuid
import lib.db_utils as db_utils
import json
import sys
from lib.thread_utils import run_process_stream_output

# Import Kaduna data
# See https://github.com/novelt/GMT/issues/2685

dest_conn = psycopg2.connect(
    dbname=os.environ.get("DEST_DB_NAME", "gmt"),
    user=os.environ.get("DEST_DB_USER", "postgres"),
    password=os.environ.get("DEST_DB_PASSWORD", "postgres"),
    host=os.environ.get("DEST_DB_HOST", "db"),
    port=os.environ.get("DEST_DB_PORT", "5432")
)

source_conn = psycopg2.connect(
    dbname=os.environ["DB_NAME"],
    user=os.environ["DB_USER"],
    password=os.environ["DB_PASSWORD"],
    host=os.environ["DB_HOST"],
    port=os.environ["DB_PORT"]
)

COMMENT_MESSAGE = "Kaduna HF Update"

def xfer_commit_history():
    assert os.environ.get("DEST_DB_NAME", "gmt") == "gmt"

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





# need to xfer the original data back to the health_facility.point table
def xfer_to_main_table():
    # should be xfering only to local
    assert os.environ.get("DEST_DB_NAME", "gmt") == "gmt"
    # and from something else
    assert os.environ["DB_NAME"] != "gmt"

    boundaries = get_kaduna_operating_boundaries()
    b_count = len(boundaries)

    partition_schema = "partitions_health_facility_point"

    column_names = None

    # do all xfer in 1 transaction
    dest_cur = dest_conn.cursor()
    source_cur = source_conn.cursor()

    for idx, (b_guid, b_id, b1_name, b2_name, b3_name) in enumerate(boundaries):
        print(f"Handling #{idx + 1} of {b_count}: {b1_name} / {b2_name} / {b3_name}")

        table_name = partition_schema.replace("partitions_", "") + "_" + str(b_id).zfill(5)

        # now xfer the data from source to dest

        if column_names is None:
            column_names = db_utils.get_column_names(source_conn, partition_schema, table_name)
            column_names.remove("properties")

        # Execute a SELECT query to fetch desired columns from source database
        col_list = ", ".join([f"\"{c}\"" for c in column_names])

        # The source is the unpartitioned health_facility.point table
        source_cur.execute(f"""
                SELECT properties, {col_list} 
                FROM {partition_schema}.{table_name}
                """)

        # Fetch all rows from the query result
        rows = source_cur.fetchall()

        if len(rows) == 0:
            print(f"No hfs to xfer in {partition_schema}.{table_name}")
            continue
        else:
            print(f"Xfering {len(rows)} rows to {partition_schema}.{table_name}")

        values_list = ", ".join(["%s" for _ in column_names])
        # Insert the fetched data into the destination database
        for row in rows:
            row = list(row)
            row[0] = json.dumps(row[0])
            # print(row)
            dest_cur.execute(
                f"""
                    INSERT INTO health_facility.point 
                    (properties, {col_list}) 
                    VALUES (%s, {values_list})
                    """, row)

    dest_cur.execute(f"REFRESH MATERIALIZED VIEW health_facility.point_latest")

    latest_commit_id = get_last_commit_id()
    set_next_commit_id(latest_commit_id)

def main():
    # xfer_commit_history()

    # xfer_to_main_table()

    # sys.exit(0)
    xfer_to_partitions()

def xfer_to_partitions():
    boundaries = get_kaduna_operating_boundaries()
    b_count = len(boundaries)

    partition_schema = "partitions_health_facility_point"

    column_names = None

    dest_version_id = get_version_id()

    # do all xfer in 1 transaction
    dest_cur = dest_conn.cursor()
    source_cur = source_conn.cursor()

    source_cur.execute("SELECT ID FROM master.commits WHERE comment = %s",
                     (COMMENT_MESSAGE,))

    src_version_id = source_cur.fetchone()[0]

    assert src_version_id == dest_version_id

    source_cur.execute("SELECT COUNT(*) FROM health_facility.point")

    row_count = source_cur.fetchone()[0]

    if src_version_id <= 10:
        raise Exception(f"Invalid source version id: {src_version_id}")

    for idx, (b_guid, b_id, b1_name, b2_name, b3_name) in enumerate(boundaries):
        print(f"Handling #{idx+1} of {b_count}: {b1_name} / {b2_name} / {b3_name}; rows left to xfer {row_count}")

        table_name = partition_schema.replace("partitions_", "") + "_" + str(b_id).zfill(5)

        source_cur.execute(f"""
                    SELECT MAX(version_id)  
                    FROM health_facility.point hf 
                    WHERE hf.boundary_polygon = %s 
                    """, (b_guid,))

        max_src_version_id = source_cur.fetchone()[0]

        # There should be no changes, so check that
        # use latest b/c there could be some errors from the kano import
        sql = f"""
        SELECT max(version_id) FROM {partition_schema}.{table_name}_latest
        """

        dest_cur.execute(sql)
        max_dest_version_id = dest_cur.fetchone()[0]

        if max_dest_version_id is None:
            print(f"No hfs in in {partition_schema}.{table_name}")
        else:
            print(f"Max version is {max_dest_version_id} in {partition_schema}.{table_name}")

            if max_dest_version_id > max_src_version_id:
                raise Exception(f"Max dest version is {max_dest_version_id} > src {max_src_version_id} in {partition_schema}.{table_name}")

        #now xfer the data from source to dest

        if column_names is None:
            column_names = db_utils.get_column_names(source_conn, partition_schema, table_name)
            # column_names.remove("version_id")
            column_names.remove("properties")


        # Execute a SELECT query to fetch desired columns from source database
        col_list = ", ".join([f"\"{c}\"" for c in column_names])

        # The source is the unpartitioned health_facility.point table
        source_cur.execute(f"""
            SELECT properties, {col_list} 
            FROM health_facility.point hf 
            WHERE hf.boundary_polygon = %s 
            """, (b_guid,))

        # Fetch all rows from the query result
        rows = source_cur.fetchall()

        # Because we xfered to local first, we truncate the dest table
        dest_cur.execute(
            f"""
                        TRUNCATE TABLE {partition_schema}.{table_name} 
            """)

        row_count = row_count - len(rows)

        if len(rows) == 0:
            print(f"No hfs to xfer in {partition_schema}.{table_name}")
            continue
        else:
            print(f"Xfering {len(rows)} rows to {partition_schema}.{table_name}")

        values_list = ", ".join(["%s" for _ in column_names])
        # Insert the fetched data into the destination database
        for row in rows:
            row = list(row)
            row[0] = json.dumps(row[0])

            # print(row)
            dest_cur.execute(
                f"""
                INSERT INTO {partition_schema}.{table_name} 
                (properties, {col_list}) 
                VALUES (%s, {values_list})
                """, row)

        dest_cur.execute(f"REFRESH MATERIALIZED VIEW {partition_schema}.{table_name}_latest")

    dest_conn.commit()


def set_next_commit_id(cur_commit_id):

    print(f"Setting next commit id to {cur_commit_id}+1")

    sql = f"SELECT setval('master.commits_id_seq', {cur_commit_id}, true);"

    dest_cursor = dest_conn.cursor()

    dest_cursor.execute(sql)

    dest_conn.commit()


def get_last_commit_id() -> int:
    query = "select max(id) from master.commits;"

    # src_cursor = source_conn.cursor()
    #
    # src_cursor.execute(query)
    #
    # row = src_cursor.fetchone()

    dest_cursor = dest_conn.cursor()

    dest_cursor.execute(query)

    row2 = dest_cursor.fetchone()

    return row2[0]

    #max_id = max(row[0], row2[0])

    #return max_id

def get_kaduna_operating_boundaries() -> List:
    # should be the same if we use source or dest, both should contain
    # same boundaries
    cur = source_conn.cursor()

    cur.execute(f"""
select b3.global_id, bid.id, b1.name, b2.name, b3.name from
boundary.polygon_latest b1
inner join boundary.polygon_latest b2 on b2.boundary_polygon = b1.global_id and b2.level = 2
inner join boundary.polygon_latest b3 on b3.boundary_polygon = b2.global_id and b3.level = 3
inner join partitions.boundary_id bid on bid.global_id = b3.global_id
where b1.name = 'Kaduna'
order by b2.name, b3.name
""")

    rows = cur.fetchall()

    rows = list(rows)

    return rows

def get_version_id() -> int:


    dest_cur = dest_conn.cursor()
    dest_cur.execute("SELECT ID FROM master.commits WHERE comment = %s",
                     (COMMENT_MESSAGE,))

    row = dest_cur.fetchone()

    if row is not None:
        version_id = row[0]
        print(f"Using version id {version_id}")
        return version_id


    commit = """
    INSERT INTO master.commits (publish_user, comment)
     VALUES ('eg@novel-t.ch', %s) RETURNING id
     """

    dest_cur.execute(commit, (COMMENT_MESSAGE,))

    version_id = dest_cur.fetchone()[0]

    print(f"Inserted version_id is {version_id}")
    dest_conn.commit()
    dest_cur.close()

    return version_id

if __name__ == "__main__":
    main()