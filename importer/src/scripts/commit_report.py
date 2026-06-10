import asyncio
import io
import os
import pprint
import uuid
from pathlib import Path
from typing import Coroutine, List, Union
from typing import Dict, Protocol

import asyncpg
from asyncpg import Connection, Pool

from scripts.copy_data import get_boundary_ids, Boundary

ENV_KEY_SRC_DB_NAME = "SRC_DB_NAME"
ENV_KEY_DEST_DB_NAME = "DEST_DB_NAME"

REPORT_SCHEMA_NAME = "report"
REPORT_TABLE_NAME = "changes"

async def amain():
    dest_dbname = os.environ[ENV_KEY_DEST_DB_NAME]
    dest_user = os.environ["DEST_DB_USER"]
    dest_password = os.environ["DEST_DB_PASSWORD"]
    dest_host = os.environ["DEST_DB_HOST"]
    dest_port = os.environ["DEST_DB_PORT"]

    if dest_dbname not in ["gmt_test", "gmt"]:
        raise Exception(f"GDM db name {dest_dbname} not allowed")

    print(f"Connecting to [{dest_host}]")

    dest_pool = await asyncpg.create_pool(
        user=dest_user,
        password=dest_password,
        database=dest_dbname,
        host=dest_host,
        port=dest_port,
        min_size=1,
        max_size=4,
        ssl=False
        # init=set_read_only
    )

    assert dest_pool

    # get kano/kaduna boundary ids
    b_ids = await get_boundary_ids(dest_pool)
    # b_ids = get_boundary_ids_without_adj()

    print(f"{len(b_ids)} found")

    # Create a new table to store the stats

    await export_to_csv(dest_pool)
    return

    # commit id -> schema -> table -> count
    async with dest_pool.acquire() as dest_conn:
        await dest_conn.execute(f"""
        CREATE SCHEMA IF NOT EXISTS {REPORT_SCHEMA_NAME};
         
        DROP TABLE IF EXISTS {REPORT_SCHEMA_NAME}.{REPORT_TABLE_NAME};
        
        CREATE TABLE {REPORT_SCHEMA_NAME}.{REPORT_TABLE_NAME} (
    commit_id int REFERENCES master.commits,
    schema_name text NOT NULL,
    table_name text NOT NULL,
    --e.g. health faclities, names, parts, catchment
    data_description text NOT NULL,
    global_id uuid NOT NULL,
    boundary_guid uuid NOT NULL,    
    UNIQUE(commit_id, schema_name, table_name, global_id)        
        )
        """)

    tasks: List[Coroutine] = []

    for idx, b in enumerate(b_ids):
         tasks.append(write_stats(idx, len(b_ids), b, dest_pool))

    results = await asyncio.gather(*tasks)

    await export_to_csv(dest_pool)


async def export_to_csv(dst_pool: Pool,):

    query = f"""
    select
    c.id as "Commit ID",
    c.publish_user as "User",
    TO_CHAR(c.timestamp, 'YYYY-MM-DD HH24:MI:SS') as "Commit Date/Time",
    b1.name as "State",
    b2.name as "LGA",
    b3.name as "Ward",
    r.data_description,
    --r.schema_name, r.table_name,
    count(*) from report.changes r
inner join master.commits c on c.id = r.commit_id
inner join boundary.polygon_latest b3 on b3.global_id = r.boundary_guid
inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
where publish_user not in ('postgres', 'gmt_admin_prod', 'eg@novel-t.ch')
group by c.id,
    r.data_description,
    --r.schema_name, r.table_name,
    b1.name, b2.name, b3.name
order by c.timestamp
"""

    csv_path = Path("/data/export/change_report.csv")

    if csv_path.exists():
        csv_path.unlink()


    # Fetch the data in CSV format
    #async with dst_pool.acquire() as conn:
    await dst_pool.copy_from_query(query,
                                   output=csv_path, format='csv',
                                   header=True
                                   )


async def write_stats(
        idx: int,
        len_bids: int,
        boundary: Boundary,
        dst_pool: Pool,
):
    print(f"Writing #{idx} of {len_bids}")
    try:
        for partition_schema in [
            "partitions_settlement_name",
            "partitions_settlement_part",
                                 "partitions_health_facility_point",
            "partitions_ri_catchment_item"]:
            table_name = partition_schema.replace("partitions_", "") + "_" + str(boundary.partition_id).zfill(5)

            where_clause = ""

            if partition_schema == "partitions_ri_catchment_item":
                where_clause = "WHERE pt.type != 'generated'"

            data_description = ""

            if partition_schema == "partitions_health_facility_point":
                data_description = "Health Facilities"
            elif partition_schema == "partitions_settlement_name":
                data_description = "Settlement Names"
            elif partition_schema == "partitions_settlement_part":
                data_description = "Settlement Geometry"
            elif partition_schema == "partitions_ri_catchment_item":
                data_description = "Explicit includes/excludes"


            query = f"""
        INSERT INTO {REPORT_SCHEMA_NAME}.{REPORT_TABLE_NAME} (
            commit_id,
            boundary_guid,
            schema_name,
            table_name, 
            data_description,
            global_id
        )
        SELECT 
            version_id,
            '{boundary.global_id}', 
            '{partition_schema}', 
            '{table_name}', 
            '{data_description}',
            global_id
        FROM {partition_schema}.{table_name} pt
        {where_clause}
        --ignore dups
        ON CONFLICT (commit_id, schema_name, table_name, global_id)
        DO NOTHING
        ;
            """
            #print(query)
            await dst_pool.execute(query)
    except Exception as ex:
        print(f"Problem {partition_schema}.{table_name} -- {ex}")



if __name__ == '__main__':
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        # asyncio.run(amain(loop=loop))
        loop.run_until_complete(amain())
    except KeyboardInterrupt:
        pass