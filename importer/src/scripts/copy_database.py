import asyncio
import io
import os
from pathlib import Path
import sys
from typing import Coroutine, List, Union

import asyncpg
from asyncpg import Connection, Pool


async def get_table_names(conn: Union[Connection, Pool], schema: str) -> List[str]:
    # Execute query to get table names
    query = """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_type = 'BASE TABLE'; -- To exclude views and materialized views
    """
    tables = await conn.fetch(query, schema)

    # Extract table names from the result
    table_names = [table['table_name'] for table in tables]

    return table_names


async def run(is_binary: bool = False):
    
    src_dbname=os.environ["SRC_DB_NAME"]
    src_user=os.environ["SRC_DB_USER"]
    src_password=os.environ["SRC_DB_PASSWORD"]
    src_host=os.environ["SRC_DB_HOST"]
    src_port=os.environ["SRC_DB_PORT"]
    
    src_pool = await asyncpg.create_pool(
        user=src_user,
        password=src_password,
        database=src_dbname,
        host=src_host,
        port=src_port,
        min_size=1,
        max_size=4
    )
    
    assert src_pool

    # dest_dbname = os.environ["DEST_DB_NAME"]
    # dest_user = os.environ["DEST_DB_USER"]
    # dest_password = os.environ["DEST_DB_PASSWORD"]
    # dest_host = os.environ["DEST_DB_HOST"]
    # dest_port = os.environ["DEST_DB_PORT"]
    #
    # memory_file = io.BytesIO()


    backup_base_path = Path("/data/db_backup_csv") / src_dbname

    if is_binary:
        backup_base_path = Path("/data/db_backup_binary") / src_dbname

    for schema_name in [
        'auth',
        'boundary',
        'partitions_health_facility_point',
        'partitions_ri_catchment_item',
        'partitions_settlement_name',
        'partitions_settlement_part',
    ]:

        # get table names
        table_names = await get_table_names(src_pool, schema_name)
        
        # await src_conn.close()
        #
        # src_conn = await asyncpg.connect(
        #     user=src_user,
        #     password=src_password,
        #     database=src_dbname,
        #     host=src_host,
        #     port=src_port
        # )

        schema_backup_base_path = backup_base_path / schema_name

        schema_backup_base_path.mkdir(exist_ok=True, parents=True)

        tasks: List[Coroutine] = []
        
        for table_name in table_names:
            # print(f"Copy table {schema_name}.{t}")
            tasks.append(table_to_file(
                src_pool, schema_backup_base_path, True, schema_name, table_name))
            
        results = await asyncio.gather(*tasks)

        # break
    #await src_conn.close()

tables_copied = 0
    
async def table_to_file(pool: Pool, 
                        schema_backup_base_path: Path,
                        is_binary: bool, schema_name: str, table_name: str):
    global tables_copied
    async with pool.acquire() as conn:
        if is_binary:
            await conn.copy_from_table(
                table_name = table_name,
                schema_name = schema_name,
                output = schema_backup_base_path / f"{table_name}.bin",
                format = "binary",
                timeout = 60, # seconds
            )
        else:
            await conn.copy_from_table(
                table_name=table_name,
                schema_name=schema_name,
                output=schema_backup_base_path / f"{table_name}.csv",
                format="csv",
                header=True,
                timeout=60,  # seconds
            )
        
    tables_copied += 1
    if tables_copied % 100 == 0:
        print(f"Tables copied {tables_copied}")

# loop = asyncio.get_event_loop()
# loop.run_until_complete(run())

# https://stackoverflow.com/questions/73361664/asyncio-get-event-loop-deprecationwarning-there-is-no-current-event-loop
if __name__ == '__main__':
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        # asyncio.run(amain(loop=loop))
        loop.run_until_complete(run(True))
    except KeyboardInterrupt:
        pass