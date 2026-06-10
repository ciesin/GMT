import asyncio
from typing import List

import xlsxwriter  # type: ignore
from asyncpg import Record
from psycopg.sql import SQL

from lib import file_utils
from lib.async_db_utils import PoolConn, fetch_log
from lib.logger_utils import get_logger
from modules.excel_exporter.rew_background_and_services import (
    create_background_and_services_sheet,
)
from modules.excel_exporter.rew_catchment_services import (
    add_gmt_catchment_area_for_services_sheet,
)
from modules.excel_exporter.rew_target_gis import add_gmt_target_population_sheet

from modules.exporter_shared.gmt_db_objects import GeneralDbNames
from modules.exporter_shared.operating_boundaries import (
    get_operating_boundaries,
    OperatingBoundary,
)
from modules.params.flask_root_params import RewExportExcelParams

log = get_logger(__name__)

"""
Updates all the state exports if there was a change
"""


def run_excel_export_rew(params: RewExportExcelParams) -> None:
    return asyncio.run(excel_export_rew(params))


async def excel_export_rew(params: RewExportExcelParams) -> None:
    log.info(f"Starting export of {params.boundary_guid_list} boundaries")

    async with params.gmt_db.get_asyncpg_connection() as conn:
        op_boundaries = await get_operating_boundaries(conn, params.boundary_guid_list)

        for b in op_boundaries:
            log.debug(f"Looking at {b.name}.  {', '.join(b.hierarchy_names)}")

            if b.is_surrounding:
                continue

            # get all hf fixed posts
            fps = await get_ri_fixed_post(b, conn)

            for fixed_post_record in fps:
                await create_rew_for_hf(params, b, fixed_post_record, conn)


async def get_ri_fixed_post(
    boundary: OperatingBoundary, conn: PoolConn
) -> List[Record]:
    sql = (
        SQL("""
SELECT 
    hf.global_id, hf.name, hf.private, hf.boundary_polygon,
    set_with_gps, "name", synonyms, equipment, 
    services, mp_status, level_of_care, maturity_level, 
    primary_type, private, operating_hours_start, operating_hours_stop, 
    transport, frequency, "type", staff_names, staff_positions, staff_types, 
    properties
FROM {hf} hf
WHERE hf.type = 'fixed_post'
    AND ('Routine Immunization' = ANY(hf.services)) 

    """)
        .format(
            hf=GeneralDbNames.SCHEMA_HF.get_table_as_identifier(
                boundary.partition_id, True
            )
        )
        .as_string()
    )

    rows = await fetch_log(conn, sql)

    return rows


async def create_rew_for_hf(
    params: RewExportExcelParams,
    boundary: OperatingBoundary,
    fixed_post_record: Record,
    conn: PoolConn,
) -> None:
    sheet_filename = (
        f"REW_{boundary.hierarchy_names[0]}_{fixed_post_record['name']}.xlsx"
    )
    sheet_path = (
        params.excel_base_path
        / boundary.hierarchy_names[1]
        / boundary.hierarchy_names[0]
        / sheet_filename
    )

    sheet_path.parent.mkdir(parents=True, exist_ok=True)

    file_utils.remove_file(sheet_path)
    # merging does not work well with constant memory True, and these spreadsheets are per hf, so not so big
    workbook = xlsxwriter.Workbook(sheet_path, {"constant_memory": False})

    await create_background_and_services_sheet(
        workbook, fixed_post_record, conn, boundary
    )
    await add_gmt_target_population_sheet(
        workbook, True, fixed_post_record, conn, boundary
    )
    await add_gmt_target_population_sheet(
        workbook, False, fixed_post_record, conn, boundary
    )
    await add_gmt_catchment_area_for_services_sheet(
        workbook, fixed_post_record, conn, boundary
    )

    workbook.close()
