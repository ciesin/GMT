from typing import List

from psycopg.sql import Identifier, SQL

from lib.async_db_utils import ConnType, get_column_names, execute_log
from lib.logger_utils import get_logger
from modules.exporter_shared.gmt_db_objects import ExportDbNames, GeneralDbNames
from modules.exporter_shared.operating_boundaries import OperatingBoundary

log = get_logger(__name__)


async def populate_raw_sn_table(
    conn: ConnType,
    b_list: List[OperatingBoundary],
) -> None:
    log.info(f"Importing sns from {len(b_list)} partitions to {ExportDbNames.RAW_SN}")

    column_names = await get_column_names(conn, ExportDbNames.RAW_SN)

    column_names.remove("is_machine_generated")
    column_names.remove("problematic")
    column_names.remove("uninhabited_reason")
    column_names.remove("uninhabited_other_detail")

    for b_idx, boundary in enumerate(b_list):
        if b_idx % 1000 == 0:
            log.info(
                f"Importing settlement names from partition {boundary.partition_id} - {boundary.name}.  Idx {b_idx + 1}/{len(b_list)}"
            )

        import_query_str = (
            SQL(
                r"""
INSERT INTO {target}
(
    {cols},
    is_machine_generated,
    problematic,
    uninhabited_reason,
    uninhabited_other_detail
)
SELECT 
    {selCols},
    name NOT LIKE 'BUA\_%' 
        AND name NOT LIKE 'SSA\_%' 
        AND name NOT LIKE 'HA\_%',
    src.problematic::text[]::{schema}.sn_problematic[],
    src.uninhabited_reason::text::{schema}.sn_uninhabited_reason,
    COALESCE(src.properties->>'uninhabited_other_detail', 'Unknown')

FROM {src} src
--If there are data inconsistencies, we could have the same sn PK in 2 partitions
ON CONFLICT DO NOTHING 
                  """
            )
            .format(
                cols=SQL(", ").join([Identifier(c) for c in column_names]),
                selCols=SQL(", ").join([Identifier("src", c) for c in column_names]),
                src=GeneralDbNames.SCHEMA_SN.get_table_as_identifier(
                    boundary.partition_id, is_latest=True
                ),
                target=ExportDbNames.RAW_SN.as_identifier(),
                schema=Identifier(ExportDbNames.RAW_SN.schema_name),
            )
            .as_string()
        )

        await execute_log(conn, import_query_str, log_return=False)


async def populate_raw_hf_table(
    conn: ConnType,
    b_list: List[OperatingBoundary],
) -> None:
    log.info(f"Importing hfs from {len(b_list)} partitions to {ExportDbNames.RAW_HF}")

    column_names = await get_column_names(conn, ExportDbNames.RAW_HF)
    column_names.remove("services")
    column_names.remove("mp_status")

    column_names.remove("level_of_care")
    column_names.remove("maturity_level")
    column_names.remove("primary_type")
    column_names.remove("staff_positions")
    column_names.remove("staff_types")
    column_names.remove("transport")
    column_names.remove("type")

    for b_idx, boundary in enumerate(b_list):
        if b_idx % 1000 == 0:
            log.info(
                f"Importing health facilities from partition {boundary.partition_id} - {boundary.name}.  Idx {b_idx + 1}/{len(b_list)}"
            )

        import_query_str = (
            SQL(
                """
INSERT INTO {target}
(
    {cols}, 
    "services",
    "mp_status",
    "level_of_care",
    "maturity_level",
    "primary_type",
    "staff_positions",
    "staff_types",
    "transport",
    "type"
)
SELECT 
    {selCols}, 
    src.services::text[]::{schema}.hf_services[], 
    src.mp_status::text::{schema}.hf_microplan_status,
    src.level_of_care::text::{schema}.hf_level_of_care,
    src.maturity_level::text::{schema}.hf_maturity_level,
    src.primary_type::text::{schema}.hf_primary_type,
    src.staff_positions::text[]::{schema}.hf_staff_position[],
    src.staff_types::text[]::{schema}.hf_staff_type[],
    src.transport::text[]::{schema}.hf_means_of_transport[],
    src.type::text::{schema}.hf_type
FROM {src} src
                  """
            )
            .format(
                cols=SQL(", ").join([Identifier(c) for c in column_names]),
                selCols=SQL(", ").join([Identifier("src", c) for c in column_names]),
                src=GeneralDbNames.SCHEMA_HF.get_table_as_identifier(
                    boundary.partition_id, is_latest=True
                ),
                target=ExportDbNames.RAW_HF.as_identifier(),
                schema=Identifier(ExportDbNames.RAW_HF.schema_name),
            )
            .as_string()
        )

        await execute_log(conn, import_query_str, log_return=False)


async def populate_raw_ci_table(
    conn: ConnType,
    bList: List[OperatingBoundary],
) -> None:
    column_names = await get_column_names(conn, ExportDbNames.RAW_CI)
    column_names.remove("type")

    for b_idx, boundary in enumerate(bList):
        if b_idx % 1000 == 0:
            log.info(
                f"Importing catchment items from partition {boundary.partition_id} {boundary.name}.  Idx {b_idx + 1}/{len(bList)}"
            )

        import_query_str = (
            SQL(
                """
INSERT INTO {target}  
(
    {cols},
    "type"
)
SELECT 
    {selCols},
    src.type::text::{schema}."ci_type"
FROM {src} src
                  """
            )
            .format(
                cols=SQL(", ").join([Identifier(c) for c in column_names]),
                selCols=SQL(", ").join([Identifier("src", c) for c in column_names]),
                src=GeneralDbNames.SCHEMA_CI.get_table_as_identifier(
                    boundary.partition_id, is_latest=True
                ),
                target=ExportDbNames.RAW_CI.as_identifier(),
                schema=Identifier(ExportDbNames.RAW_CI.schema_name),
            )
            .as_string()
        )

        await execute_log(conn, import_query_str, log_return=False)


async def populate_raw_sp_table(
    conn: ConnType,
    b_list: List[OperatingBoundary],
) -> None:
    log.info(f"Importing sps from {len(b_list)} partitions to {ExportDbNames.RAW_SP}")

    column_names = await get_column_names(conn, ExportDbNames.RAW_SP)

    column_names.remove("area_m2")
    column_names.remove("split_type")
    column_names.remove("split_parent")
    column_names.remove("type")

    for b_idx, boundary in enumerate(b_list):
        if b_idx % 1000 == 0:
            log.info(
                f"Importing settlement parts from partition {boundary.partition_id} - {boundary.name}.  Idx {b_idx + 1}/{len(b_list)}"
            )

        import_query_str = (
            SQL(
                """
INSERT INTO {target}
(
    {cols},
    area_m2,
    split_type,
    split_parent,
    type
)
SELECT 
    {selCols},
    ST_Area(src.geom::geography, true),
    src.split_type::text::{schema}.sp_split_type as split_type,
    src.split_parent as split_parent,
    src.type::text::{schema}.settlement_part_type

FROM {src} src
                  """
            )
            .format(
                cols=SQL(", ").join([Identifier(c) for c in column_names]),
                selCols=SQL(", ").join([Identifier("src", c) for c in column_names]),
                src=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                    boundary.partition_id, is_latest=True
                ),
                target=ExportDbNames.RAW_SP.as_identifier(),
                schema=Identifier(ExportDbNames.RAW_SP.schema_name),
            )
            .as_string()
        )

        await execute_log(conn, import_query_str, log_return=False)
