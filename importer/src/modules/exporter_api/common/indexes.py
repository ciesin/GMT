from lib.async_db_utils import create_index, PoolConn
from modules.exporter_shared.gmt_db_objects import ExportDbNames


async def create_raw_indexes(conn: PoolConn) -> None:
    await create_index(
        conn,
        ExportDbNames.RAW_CI.with_column_name("boundary_polygon"),
        is_geom=False,
    )
    await create_index(
        conn,
        ExportDbNames.RAW_CI.with_column_name("settlement_part"),
        is_geom=False,
    )
    await create_index(
        conn,
        ExportDbNames.RAW_CI.with_column_name("health_facility_point"),
        is_geom=False,
    )

    await create_index(
        conn,
        ExportDbNames.RAW_SN.with_column_name("settlement_part"),
        is_geom=False,
    )
    await create_index(
        conn,
        ExportDbNames.RAW_SN.with_column_name("is_primary"),
        is_geom=False,
    )
