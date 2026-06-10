import asyncio
import datetime
import os
import shlex
import shutil
import time
import uuid
import zipfile
from functools import cached_property
from pathlib import Path
from typing import List, cast

from lib import file_utils
from lib.async_db_utils import ConnType, PoolType, drop_schema
from lib.async_utils import run_command
from lib.logger_utils import get_logger

from modules.exporter_api.common.indexes import create_raw_indexes
from modules.exporter_api.csv_export import export_csvs, table_to_markdown_doc

from modules.exporter_api.fgb_export import export_gdb

from modules.exporter_shared.consolidated_data.populate import (
    add_catchment_polygons,
    add_ci,
    add_hf_related_data,
    add_settlements,
)
from modules.exporter_shared.consolidated_data.tables import (
    create_catchment_polygon_table,
    create_ci_table,
    create_hf_tables,
    create_settlement_table,
)
from modules.exporter_shared.gmt_db_objects import ExportDbNames
from modules.exporter_shared.operating_boundaries import (
    get_operating_boundaries,
    create_boundary_table,
)
from modules.params.flask_root_params import StateExportParams, BoundaryToExport
from pydantic import BaseModel, Field
from modules.exporter_shared.raw_data.rd_import import import_raw_data

log = get_logger(__name__)

"""
Updates all the state exports if there was a change
"""


def run_state_export(params: StateExportParams) -> None:
    return asyncio.run(state_export(params))


async def state_export(params: StateExportParams) -> None:
    async with params.gmt_db.get_asyncpg_connection(readonly=True) as conn:
        current_commit_id = await conn.fetchval("select max(id) from master.commits")

        if not isinstance(current_commit_id, int):
            raise Exception("commit id is not an int")

        log.info(f"Preparing state exports.  Current id={current_commit_id}")

        # state_code_recs = await get_states(conn)

    if params.status_json_path.exists():
        with params.status_json_path.open("r") as f:
            json_str = f.read()

        status = StateExportStatus.model_validate_json(json_str)

        if status.last_commit_id == current_commit_id:
            log.info(
                f"Export is already up to date {params.status_json_path}::{status.last_commit_id} == {current_commit_id}"
            )
            return

    log.info(f"Updating {params.state.code}")

    await create_state_export(params)

    file_utils.remove_dir(params.state_base_dir, params.export_base_path, True)

    params.state_base_dir.mkdir(parents=True, exist_ok=True)

    log.info(
        f"Moving {params.staging_base_dir / params.csv_filename} to {params.state_base_dir / params.csv_filename}"
    )
    shutil.move(
        params.staging_base_dir / params.csv_filename,
        params.state_base_dir / params.csv_filename,
    )
    log.info(
        f"Moving {params.staging_base_dir / params.geom_filename} to {params.state_base_dir / params.geom_filename}"
    )
    shutil.move(
        params.staging_base_dir / params.geom_filename,
        params.state_base_dir / params.geom_filename,
    )

    await write_completed_status(params, current_commit_id)

    # clean up staging dir
    file_utils.remove_dir(
        params.staging_base_dir,
        params.staging_export_base_path,
        raise_exception_on_error=True,
    )


class StateExportStatus(BaseModel):
    last_run: int = Field(description="Number of seconds since 1970 of last run")

    last_commit_id: int = Field(
        description="max master.commits.id when state export was generated"
    )

    state: BoundaryToExport = Field(description="Which state")

    @cached_property
    def last_run_pretty(self) -> str:
        dt = datetime.datetime.fromtimestamp(self.last_run, tz=datetime.timezone.utc)
        return dt.strftime("%Y-%m-%d %H:%M:%S %Z")


BoundaryGuidList = List[uuid.UUID]


async def get_states(conn: ConnType) -> List[BoundaryToExport]:
    state_code_recs = await conn.fetch(
        """
            SELECT b.global_id, upper(b.code) as code, name
            from boundary.polygon_latest b 
            where b.level=1 
            order by code
            """
    )
    return [BoundaryToExport(**dict(r)) for r in state_code_recs]


def zip_directory(folder_path: Path, output_zip_path: Path) -> None:
    with zipfile.ZipFile(output_zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(folder_path):
            for file in files:
                full_path = os.path.join(root, file)
                relative_path = os.path.relpath(full_path, folder_path)
                zipf.write(full_path, arcname=relative_path)


async def create_state_export(params: StateExportParams) -> None:
    # await recalc_boundary_catchments(params, state)
    state = params.state

    file_utils.remove_dir(
        params.staging_base_dir,
        params.staging_export_base_path,
        raise_exception_on_error=True,
    )

    async with params.gmt_db.get_asyncpg_pool() as pool:
        await drop_schema(pool, ExportDbNames.TEMP_SCHEMA)

        async with pool.acquire() as raw_conn:
            conn = cast(ConnType, raw_conn)
            b_list = await get_operating_boundaries(conn, [state.global_id])

        async with pool.acquire() as p_conn:
            conn = cast(ConnType, p_conn)
            await import_raw_data(conn, b_list)

            await create_boundary_table(conn, b_list)

        await import_consolidated_data(pool, state)

    await export_csvs(params)
    await table_to_markdown_doc(params)

    zip_directory(
        params.staging_base_dir / params.csv_subdir,
        params.staging_base_dir / params.csv_filename,
    )

    await export_gdb(params)

    zip_directory(
        params.staging_base_dir / params.geom_subdir,
        params.staging_base_dir / params.geom_filename,
    )


async def import_consolidated_data(pool: PoolType, state: BoundaryToExport) -> None:
    await create_settlement_table(pool)
    await create_hf_tables(pool)
    await create_ci_table(pool)
    await create_catchment_polygon_table(pool)

    await create_raw_indexes(pool)

    async with pool.acquire() as p_conn:
        conn = cast(ConnType, p_conn)
        await add_catchment_polygons(conn)
        await add_settlements(conn)
        await add_ci(conn)

        await add_hf_related_data(conn)


async def write_completed_status(
    params: StateExportParams,
    current_commit_id: int,
) -> None:
    state = params.state

    # update status
    status = StateExportStatus(
        last_commit_id=current_commit_id, last_run=int(time.time()), state=state
    )

    params.status_json_path.parent.mkdir(parents=True, exist_ok=True)
    with params.status_json_path.open("w") as f:
        f.write(status.model_dump_json())


async def recalc_boundary_catchments(
    params: StateExportParams, state: BoundaryToExport
) -> None:
    """ """
    async with params.gmt_db.get_asyncpg_connection() as conn:
        b3_id_recs = await conn.fetch(
            """
SELECT 
    b3.global_id
FROM boundary.polygon_latest b3
INNER JOIN boundary.polygon_latest b2 
    ON b3.boundary_polygon = b2.global_id
WHERE 
    b2.boundary_polygon = $1
ORDER BY b2.global_id, b3.global_id
                """,
            state.global_id,
        )

    await run_command(
        "cargo", ["build", "--release", "--bin calc_boundary_data"], cwd=Path("/rust")
    )

    chunk_size = 20
    for i in range(0, len(b3_id_recs), chunk_size):
        chunk = b3_id_recs[i : i + chunk_size]

        args = [
            "--log-level debug",
            "calc-boundary-data",
            "--gmt-database-pg-conn",
            shlex.quote(params.gmt_db.get_sql_alchemy_connection_string()),
            "--pop-raster",
            shlex.quote("/data/rasters/input/pop_4326.tif"),
        ]

        for c in chunk:
            args.append("--boundary-guid")
            args.append(shlex.quote(str(c[0])))

        rc = await run_command(
            "/rust/target/release/calc_boundary_data", args, cwd=Path("/rust")
        )

        if rc != 0:
            raise Exception("Command failed")

    # cmd_line_parts = [
    #     "cargo run --release --bin calc_boundary_data",
    #     '--  calc-boundary-data',
    #
    #     "postgresql://${BASELINE_DB_USER}:${BASELINE_DB_PASSWORD}@${BASELINE_DB_HOST}:${BASELINE_DB_PORT}/${BASELINE_DB_NAME}",
    #     '--pop-raster "/data/rasters/input/pop_4326.tif"',
    #     f'--boundary-guid "{b_guid}"',
    # ]

    # run_process_stream_output(" ".join(cmd_line_parts), cwd="/rust")
