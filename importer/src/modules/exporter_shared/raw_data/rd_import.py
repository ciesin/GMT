from typing import List


from lib.async_db_utils import ConnType, table_exists
from lib.logger_utils import get_logger
from modules.exporter_shared.gmt_db_objects import ExportDbNames
from modules.exporter_shared.operating_boundaries import OperatingBoundary
from modules.exporter_shared.raw_data.populate import (
    populate_raw_sn_table,
    populate_raw_hf_table,
    populate_raw_ci_table,
    populate_raw_sp_table,
)

from modules.exporter_shared.raw_data.tables import (
    create_raw_hf_table,
    create_raw_ci_table,
    create_raw_sp_table,
    create_raw_sn_table,
)

log = get_logger(__name__)


async def import_raw_data(conn: ConnType, b_list: List[OperatingBoundary]) -> None:
    """
    Imports data as is for state + surrounding boundaries to raw tables
    """

    await create_raw_hf_table(
        conn,
    )
    await create_raw_ci_table(
        conn,
    )
    await create_raw_sn_table(conn)
    if not await table_exists(conn, ExportDbNames.RAW_SN):
        raise Exception(f"{ExportDbNames.RAW_SN} should exist")
    await create_raw_sp_table(conn)
    if not await table_exists(conn, ExportDbNames.RAW_SN):
        raise Exception(f"{ExportDbNames.RAW_SN} should exist")
    log.info("Passed both sn exists checks")
    await populate_raw_sn_table(conn, b_list)
    await populate_raw_hf_table(conn, b_list)
    await populate_raw_ci_table(conn, b_list)
    await populate_raw_sp_table(conn, b_list)
