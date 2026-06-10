import asyncio
import io
import os
import pprint
import uuid
from typing import Coroutine, List, Union
from typing import Dict, Protocol

import asyncpg
from asyncpg import Connection, Pool

# Used to transfer data from usually prod to localhost (the developer laptop environment)
# Setup to xfer Kano and Kaduna
# Also xfers the commit table

XFER_BOUNDARY_GUID_LIST = [
    # Kano
    '4f4bd140-a2c6-4b0d-a94b-44d2332cf512',
    # Kaduna
    'aa13d807-45e2-4ba8-96ce-371126023935',
    # NGA
    '3eba1f03-98d4-4335-804e-6c3f9e7d5da1',
]


sp_schema_name = "partitions_settlement_part"
sn_schema_name = "partitions_settlement_name"
ci_schema_name = "partitions_ri_catchment_item"
hf_schema_name = "partitions_health_facility_point"


ENV_KEY_SRC_DB_NAME = "SRC_DB_NAME"
ENV_KEY_DEST_DB_NAME = "DEST_DB_NAME"


schema_to_column_names: Dict[str, List[str]] = {}

class Boundary(Protocol):
    partition_id: int
    name: str
    global_id: uuid.UUID


class AttributeRecord(asyncpg.Record):
    def __getattr__(self, name):
        return self[name]
    



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



async def xfer_commit_history(src_pool: Pool, dst_pool: Pool):
    
    src_rows = await src_pool.fetch("""
    SELECT id, publish_user, comment, timestamp, is_published FROM master.commits
    where id > 474
    """)

    upsert_query = """
        INSERT INTO master.commits (id, publish_user, comment, timestamp, is_published)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id)
        DO UPDATE SET
        publish_user = EXCLUDED.publish_user,
        comment = EXCLUDED.comment,
        timestamp = EXCLUDED.timestamp,
        is_published = EXCLUDED.is_published;
    """

    async with dst_pool.acquire() as dest_conn:
        for row in src_rows:
            # print(row)
            r = await dest_conn.execute(upsert_query, *(row.values()))
            # print(r)
            
        #await dest_conn.commit()

        # Commit changes to the destination database
    #dest_conn.commit()


async def get_column_names(conn: Union[Connection, Pool], schema_name: str, table_name:str) -> List[str]:
    
    recs = await conn.fetch("""
SELECT col1.column_name 
	FROM information_schema.columns col1

	WHERE col1.table_name     = $1
		AND col1.table_schema = $2
    ORDER BY ordinal_position
""", table_name, schema_name
    )

    columns = [r[0] for r in recs]

    return columns

async def xfer_if_needed_partition(
    idx: int,
    len_bids: int,
    boundary: Boundary,
    src_pool: Pool,
    dst_pool: Pool,
    ):
    
    need = await need_to_xfer_partition(
        src_pool, dst_pool,
        boundary)
    if not need:  # and str(b.global_id) != '2777fb44-57ec-493f-b85d-d5371ca98011':
        print(f'NO NEED to Transfer {1+idx} of {len_bids}: {boundary} from {os.environ[ENV_KEY_SRC_DB_NAME]} to {os.environ[ENV_KEY_DEST_DB_NAME]}')
        return 

    

    print(
        f'Transfering {1 + idx} of {len_bids}: {boundary} from {os.environ[ENV_KEY_SRC_DB_NAME]} to {os.environ[ENV_KEY_DEST_DB_NAME]}')
    # clean_recent_history(b, 24)

    await xfer_partition(src_pool, dst_pool, boundary) 




async def need_to_xfer_partition(
    src_pool: Pool,
    dst_pool: Pool,
    boundary: Boundary):
    partition_id = boundary.partition_id

    ci_table_name = "ri_catchment_item_" + str(partition_id).zfill(5)
    sn_table_name = "settlement_name_" + str(partition_id).zfill(5)
    sp_table_name = "settlement_part_" + str(partition_id).zfill(5)
    hf_table_name = "health_facility_point_" + str(partition_id).zfill(5)

    # for prod => training, we want before pilot, so it is 
    #  WHERE version_id > 19 and version_id not in (153, 154, 269)';
    dest_db_name = os.environ["DEST_DB_NAME"]
    
    where_clause = ""
    ci_where_clause = "WHERE type != 'generated'"

    # keep in sync with xfer-table !
    if dest_db_name == "gmt_training" or dest_db_name == "gmt_test":
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
    s_info = await src_pool.fetchrow(sql, record_class=AttributeRecord,)

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

    d_info = await dst_pool.fetchrow(sql, record_class=AttributeRecord,)

    if s_info.ci_count != d_info.ci_count or s_info.ci_max_version_id != d_info.ci_max_version_id:  # type: ignore
        print(f"Ci diff, need to xfer")
        pprint.pp(s_info)
        pprint.pp(d_info)
        return True

    if s_info.sp_count != d_info.sp_count or s_info.sp_max_version_id != d_info.sp_max_version_id: # type: ignore
        print(f"sp diff, need to xfer")
        pprint.pp(s_info)
        pprint.pp(d_info)
        return True

    if s_info.sn_count != d_info.sn_count or s_info.sn_max_version_id != d_info.sn_max_version_id: # type: ignore
        print(f"sn diff, need to xfer")
        pprint.pp(s_info)
        pprint.pp(d_info)
        return True

    if s_info.hf_count != d_info.hf_count or s_info.hf_max_version_id != d_info.hf_max_version_id: # type: ignore
        print(f"hf diff, need to xfer")
        pprint.pp(s_info)
        pprint.pp(d_info)
        return True

    return False

async def transfer_table(
    src_pool: Pool,
    dst_pool: Pool,
    schema_name: str, table_name: str):
    """
    This is a versioned gmt table
    """
    # Assumes the table_name has a materialized view with _latest suffix
    print(f"Xfering {schema_name}.{table_name}")

    dest_db_name = os.environ["DEST_DB_NAME"]

    where_clause = ""
    if dest_db_name == "gmt_training" or dest_db_name == "gmt_test":
        where_clause = "WHERE version_id <= 19 OR version_id IN (153, 154, 269, 338)"

    memory_file = io.BytesIO()
    
    format="text"
    
    # columns = None 
    # if schema_name == "partitions_settlement_part":
    #     format = "binary"
    if schema_name not in schema_to_column_names:
        schema_to_column_names[schema_name] = await get_column_names(src_pool, schema_name, table_name)
        
    #columns = ["global_id", "version_id", "boundary_polygon", "geom", "type", "bbox", "properties", "is_outreach"]
    columns = schema_to_column_names[schema_name]
    
    await src_pool.copy_from_query(
        query="SELECT " + ", ".join(columns) + f" FROM {schema_name}.{table_name} {where_clause}",
        # table_name=table_name,
        # schema_name=schema_name,
        format=format,
        output=memory_file,
        # columns=columns
    )

    await dst_pool.execute(f"TRUNCATE TABLE {schema_name}.{table_name}")

    memory_file.seek(0)
    
    await dst_pool.copy_to_table(
        table_name=table_name,
        schema_name=schema_name,
        format=format,
        source=memory_file,
        columns=columns
    )
   

    await dst_pool.execute(f"REFRESH MATERIALIZED VIEW {schema_name}.{table_name}_latest")


async def transfer_regular_table(
        src_pool: Pool,
        dst_pool: Pool,
        schema_name: str, table_name: str):
    # Assumes the table_name has a materialized view with _latest suffix
    print(f"Xfering {schema_name}.{table_name}")

    schema_table = f"{schema_name}.{table_name}"

    memory_file = io.BytesIO()

    format = "text"

    # columns = None
    # if schema_name == "partitions_settlement_part":
    #     format = "binary"
    if schema_table not in schema_to_column_names:
        schema_to_column_names[schema_table] = await get_column_names(src_pool, schema_name, table_name)

    # columns = ["global_id", "version_id", "boundary_polygon", "geom", "type", "bbox", "properties", "is_outreach"]
    columns = schema_to_column_names[schema_table]

    await src_pool.copy_from_query(
        query="SELECT " + ", ".join(columns) + f" FROM {schema_name}.{table_name} ",
        # table_name=table_name,
        # schema_name=schema_name,
        format=format,
        output=memory_file,
        # columns=columns
    )

    await dst_pool.execute(f"TRUNCATE TABLE {schema_name}.{table_name} CASCADE")

    memory_file.seek(0)

    await dst_pool.copy_to_table(
        table_name=table_name,
        schema_name=schema_name,
        format=format,
        source=memory_file,
        columns=columns
    )



async def xfer_partition(
    src_pool: Pool,
    dst_pool: Pool,
    boundary: Boundary):
    for partition_schema in ["partitions_settlement_name", "partitions_settlement_part",
                             "partitions_health_facility_point", "partitions_ri_catchment_item"]:
        table_name = partition_schema.replace("partitions_", "") + "_" + str(boundary.partition_id).zfill(5)

        await transfer_table(src_pool, dst_pool, partition_schema, table_name)




async def get_boundary_ids(pool: Pool) -> List[Boundary]:
    if len(XFER_BOUNDARY_GUID_LIST) == 0:
        return []

    query = """
WITH
    agg_extent_4326 AS (
        SELECT ST_Extent(b.geom) as geom_4326
        FROM boundary.polygon_latest b
        WHERE b.global_id = $1
    ),
    agg_extent_3857 AS (
        SELECT ST_Transform( ST_SetSrid(a.geom_4326, 4326), 3857) as geom_envelope
        FROM agg_extent_4326 a
    ),
    extended_extent AS (
        SELECT ST_Transform(ST_SetSRID(
            ST_MakeBox2D(
                ST_Point(
                    ST_XMin(a.geom_envelope) - $2,
                    ST_YMin(a.geom_envelope) - $2
                ),
                ST_Point(
                    ST_XMax(a.geom_envelope) + $2,
                    ST_YMax(a.geom_envelope) + $2
                )
            ), 3857), 4326) as geom FROM agg_extent_3857 a
    )
    SELECT bid.id as partition_id, bid.global_id, b.name
    FROM boundary.polygon_latest b
        INNER JOIN partitions.boundary_id bid ON b.global_id = bid.global_id
        , extended_extent ee
    WHERE ST_Intersects(ee.geom, b.geom)
        AND b.level = $3
    ORDER BY bid.id
        """

    print(query)

    all_results: Dict[int, Boundary] = {}

    # Create a SQLModel session
    async with pool.acquire() as conn:

        for b_guid in XFER_BOUNDARY_GUID_LIST:
            # Execute the custom query
             
            results = await conn.fetch(query, 
                b_guid, 3000,  3, record_class=AttributeRecord,)

            
            for p in results:
                all_results[p.partition_id] = p

    # Close the connection
    # conn.close()

    return list(all_results.values())


async def set_read_only(conn: asyncpg.Connection) -> None:
    await conn.execute('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')


async def xfer_keycloak():
    src_dbname = os.environ["SRC_DB_KEYCLOAK_DATABASE_NAME"]
    src_user = os.environ["SRC_DB_USER"]
    src_password = os.environ["SRC_DB_PASSWORD"]
    src_host = os.environ["SRC_DB_HOST"]
    src_port = os.environ["SRC_DB_PORT"]

    src_pool = await asyncpg.create_pool(
        user=src_user,
        password=src_password,
        database=src_dbname,
        host=src_host,
        port=src_port,
        min_size=1,
        max_size=4,
        init=set_read_only
    )

    assert src_pool

    dest_dbname = os.environ["DEST_DB_KEYCLOAK_DATABASE_NAME"]
    dest_user = os.environ["DEST_DB_USER"]
    dest_password = os.environ["DEST_DB_PASSWORD"]
    dest_host = os.environ["DEST_DB_HOST"]
    dest_port = os.environ["DEST_DB_PORT"]

    if dest_dbname not in ["gmt_keycloak_test", "gmt_keycloak_dev", "keycloak"]:
        raise Exception(f"GDM db name {dest_dbname} not allowed")

    print(f"xfering from {src_host}.{src_dbname} to [{dest_host}] {dest_dbname}")

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

# https://stackoverflow.com/questions/51279588/sort-tables-in-order-of-dependency-postgres

    results = await get_table_list_for_xfer(src_pool, ['public' ])

    for r in results:
        print(r)

        await transfer_regular_table(src_pool, dest_pool, r['schema_name'], r['table_name'])


async def xfer_gmt_normal():
    """
    Everything but settlement parts/names hf settlement points

    The above are xfered if needed via xfer_if_needed_partition
    :return:
    """
    src_dbname = os.environ["SRC_DB_NAME"]
    src_user = os.environ["SRC_DB_USER"]
    src_password = os.environ["SRC_DB_PASSWORD"]
    src_host = os.environ["SRC_DB_HOST"]
    src_port = os.environ["SRC_DB_PORT"]

    src_pool = await asyncpg.create_pool(
        user=src_user,
        password=src_password,
        database=src_dbname,
        host=src_host,
        port=src_port,
        min_size=1,
        max_size=4,
        init=set_read_only
    )

    assert src_pool

    dest_dbname = os.environ["DEST_DB_NAME"]
    dest_user = os.environ["DEST_DB_USER"]
    dest_password = os.environ["DEST_DB_PASSWORD"]
    dest_host = os.environ["DEST_DB_HOST"]
    dest_port = os.environ["DEST_DB_PORT"]

    if dest_dbname not in ["gmt_test", "gmt_dev", "gmt"]:
        raise Exception(f"GDM db name {dest_dbname} not allowed")

    print(f"xfering from {src_host}.{src_dbname} to [{dest_host}] {dest_dbname}")

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

    # https://stackoverflow.com/questions/51279588/sort-tables-in-order-of-dependency-postgres

    results = await get_table_list_for_xfer(src_pool,['auth', 'boundary',
                                                      'indicators', 'master', 'partitions', 'public'])


    for r in results:
        print(r)

        # if r['schema_name'] == "auth"  and r['table_name'] == 'geo_permission':
        #     continue
        # if r['schema_name'] == "partitions"  and r['table_name'] != 'boundary_id':
        #     continue
        # if r['schema_name'] == "boundary":
        #     continue
        if r["schema_name"] == "partitions" and r['table_name'] != 'boundary_id':
            continue

        if r['schema_name'] == "master" and r['table_name'] != 'commits':
            continue
        if r['schema_name'] == "public" and r['table_name'] != 'migrations':
            continue

        await transfer_regular_table(src_pool, dest_pool, r['schema_name'], r['table_name'])

    # Remove PI from master.commits table
    async with dest_pool.acquire() as conn:
        await conn.execute("Update master.commits set publish_user = '<removed>'")

        await conn.execute("SELECT setval('master.commits_id_seq', (select max(id) from master.commits), true);")
        await conn.execute(
            "SELECT setval('public.migrations_id_seq', (select max(id) from public.migrations), true);"
        )
        # await conn.execute("SELECT setval('master.logs_id_seq', (select max(id) from master.logs), true);")

        await conn.execute("REFRESH MATERIALIZED VIEW boundary.polygon_latest")
        await conn.execute("REFRESH MATERIALIZED VIEW boundary.polygon_simplified_latest")
        await conn.execute("REFRESH MATERIALIZED VIEW boundary.polygon_edited_latest")

# Returns in dependency order
async def get_table_list_for_xfer(pool, schema_list: List[str]):
    async with pool.acquire() as conn:
        # get tables in dep order
        results = await conn.fetch("""with recursive fk_tree as (
      -- All tables not referencing anything else
      select t.oid as reloid, 
             t.relname as table_name, 
             s.nspname as schema_name,
             null::text COLLATE "default" as referenced_table_name,
             null::text COLLATE "default" as referenced_schema_name,
             1 as level
      from pg_class t
        join pg_namespace s on s.oid = t.relnamespace
      where relkind = 'r'
        and not exists (select *
                        from pg_constraint
                        where contype = 'f'
                          and conrelid = t.oid)
          --https://github.com/MagicStack/asyncpg/issues/94
        --and s.nspname = any($1::text[])  

      union all 

      select ref.oid, 
             ref.relname, 
             rs.nspname,
             p.table_name,
             p.schema_name,
             p.level + 1
      from pg_class ref
        join pg_namespace rs on rs.oid = ref.relnamespace
        join pg_constraint c on c.contype = 'f' and c.conrelid = ref.oid
        join fk_tree p on p.reloid = c.confrelid
      where ref.oid != p.reloid  -- do not enter to tables referencing theirselves.
    ), all_tables as (
      -- this picks the highest level for each table
      select schema_name, table_name,
             level, 
             row_number() over (partition by schema_name, table_name order by level desc) as last_table_row
      from fk_tree
    )
    select schema_name, table_name, level
    from all_tables at
    where last_table_row = 1
    and schema_name = any($1::text[])
    order by level;
                                          """, schema_list)

        return results


async def amain():

    # await xfer_keycloak()
    await xfer_gmt_normal()
    return

    src_dbname = os.environ[ENV_KEY_SRC_DB_NAME]
    src_user = os.environ["SRC_DB_USER"]
    src_password = os.environ["SRC_DB_PASSWORD"]
    src_host = os.environ["SRC_DB_HOST"]
    src_port = os.environ["SRC_DB_PORT"]

    src_pool = await asyncpg.create_pool(
        user=src_user,
        password=src_password,
        database=src_dbname,
        host=src_host,
        port=src_port,
        min_size=1,
        max_size=4,
        init=set_read_only
    )

    assert src_pool

    dest_dbname = os.environ[ENV_KEY_DEST_DB_NAME]
    dest_user = os.environ["DEST_DB_USER"]
    dest_password = os.environ["DEST_DB_PASSWORD"]
    dest_host = os.environ["DEST_DB_HOST"]
    dest_port = os.environ["DEST_DB_PORT"]
    
    if dest_dbname not in ["gmt_test", "gmt_dev", "gmt"]:
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

    """
    Will check which boundaries are out of sync and xfer
    the data as well as the id info

    Xfers the commit history

    Generally the source will be PROD and the target LOCAL
    """

    # uncomment to xfer commit history, should only do this on local docker db !
    await xfer_commit_history(src_pool, dest_pool)
    
    # return

    b_ids = await get_boundary_ids(dest_pool)
    # b_ids = get_boundary_ids_without_adj()

    print("B_ids ", b_ids)
    
    tasks: List[Coroutine] = []

    for idx, b in enumerate(b_ids):

        tasks.append(xfer_if_needed_partition(idx, len(b_ids), b, src_pool, dest_pool))
        
    results = await asyncio.gather(*tasks)

    
    return 

    # also set version
    latest_commit_id = get_last_commit_id()
    set_next_commit_id(latest_commit_id)


if __name__ == '__main__':
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        # asyncio.run(amain(loop=loop))
        loop.run_until_complete(amain())
    except KeyboardInterrupt:
        pass