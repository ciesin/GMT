import asyncio
import sys
import uuid
from enum import StrEnum
from typing import List, Union, IO, Optional

from psycopg.sql import Composed, Literal as SqlLiteral, SQL
from pydantic import BaseModel

from lib.async_db_utils import (
    ConnType,
    drop_schema,
    execute_log,
    create_schema,
    create_index,
    PoolConn,
)
from lib.logger_utils import get_logger
from modules.db_checks.check_items import (
    check_version_id,
    check_dangling_ci,
    check_ci_boundary,
    check_missing_split_parent,
    check_excluded_included,
    check_parts_without_a_name,
    check_parts_many_pns,
    check_names_missing_sp_in_boundary,
    check_dups,
    check_split_parent_no_name,
    check_split_parent_no_children,
    check_part_name_boundary_mismatch,
    check_names_without_a_part,
)
from modules.db_checks.db_constants import (
    DbCheckNames,
    BOUNDARY_OPERATING_LEVEL,
)
from modules.db_checks.fixes import (
    fixes_write_version,
    v_split_sp,
    soft_delete_sp,
    clear_split_type_sp,
    set_settlement_name_part,
    soft_delete_sn,
    soft_delete_ci,
)
from modules.exporter_shared.gmt_db_objects import GeneralDbNames
from modules.exporter_shared.operating_boundaries import (
    OperatingBoundary,
    get_operating_boundaries,
)
from modules.params.flask_root_params import DataCheckParams


log = get_logger(__name__)


class DbCheckIds(StrEnum):
    """Enum of all validation checks with descriptions."""

    VERSION_ID = "version_id"
    DANGLING_CI = "dangling_ci"
    CI_BOUNDARY = "ci_boundary"
    EXCLUDED_INCLUDED = "excluded_included"
    MISSING_SPLIT_PARENT = "missing_split_parent"
    SPLIT_PARENT_NO_CHILDREN = "split_parent_no_children"
    SPLIT_PARENT_NO_NAME = "split_parent_no_name"
    DUPLICATES = "dups"
    NAMES_MISSING_SP_IN_BOUNDARY = "names_missing_sp_in_boundary"
    PARTS_MANY_PNS = "parts_many_pns"
    PARTS_WITHOUT_NAME = "parts_without_name"
    PART_NAME_BOUNDARY_MISMATCH = "part_name_boundary_mismatch"
    NAME_WITHOUT_PART = "name_without_part"


class DataCheckItemStatus(BaseModel):
    check_name: DbCheckIds
    passed: bool


class DataCheckStatus(BaseModel):
    status_list: List[DataCheckItemStatus]


def run_data_check(params: DataCheckParams) -> DataCheckStatus:
    return asyncio.run(data_check(params))


async def data_check(params: DataCheckParams) -> DataCheckStatus:
    """
    Instead of the view, we consolidate the data, much like we do in the state export
    or aopt gmt merge script.

    This allows the same code to work on 1 boundary or state/national levels

    It's quite fast to copy the data so likely faster than using the _latest views

    """
    log.info(f"Starting db checks for boundary guid [{params.boundary_guid_list}]")

    main_sql_file: Optional[IO[str]] = None
    # These should run 1st and then checks reran as dups can show up in other places as problems
    dups_sql_file: Optional[IO[str]] = None
    v_polys_sql_file: Optional[IO[str]] = None
    names_without_part_file: Optional[IO[str]] = None
    if params.sql_fixes_dir:
        params.sql_fixes_dir.mkdir(parents=True, exist_ok=True)
        main_sql_file = open(params.sql_fixes_dir / "main.sql", "w")
        dups_sql_file = open(params.sql_fixes_dir / "1_dups.sql", "w")
        v_polys_sql_file = open(params.sql_fixes_dir / "2_vpoly.sql", "w")
        names_without_part_file = open(params.sql_fixes_dir / "3_names_without_part.sql", "w")

    fixes_write_version(main_sql_file, "Data inconsistency fixes")

    async with params.gmt_db.get_asyncpg_connection() as conn:

        # These are manually checked with qgis, can be found by name w/o part check
        # await v_split_sp(v_polys_sql_file, conn, uuid.UUID("e7f72e13-eb6f-482e-a369-f28f64736e99"))

        # await soft_delete_sp(v_polys_sql_file, conn, uuid.UUID("b8f991bf-ae12-4e75-96e3-8923bef889b5"))
        # await clear_split_type_sp(v_polys_sql_file, conn, uuid.UUID("d824d74a-6862-4b7c-9003-bba6455d2edf"))
        # await set_settlement_name_part(v_polys_sql_file, conn, uuid.UUID("6cfcec31-9955-4cb9-b424-ba60ef5c81cd"))

        # await v_split_sp(v_polys_sql_file, conn, uuid.UUID("2da19b1d-5f10-44f9-8947-9ad7689f4db2"))

        # await set_settlement_name_part(v_polys_sql_file, conn, uuid.UUID("b601847c-9674-4e9d-871d-86a55a79f874"))

        # await set_settlement_name_part(v_polys_sql_file, conn, uuid.UUID("b519406c-6f47-4c12-b3d5-47dcf8dc414d"), False)

        # await set_settlement_name_part(
        #     v_polys_sql_file,
        #     conn,
        #     uuid.UUID("f4929a43-150c-4f5d-9b86-eb2493acdb71"),
        #     True,
        # )

        # await soft_delete_sn(
        #     v_polys_sql_file, conn, uuid.UUID("de49fb50-5c59-4986-bfa0-daaa07106388"), 5679)

            # sn global id version id parition id
            # de49fb50-5c59-4986-bfa0-daaa07106388	862	5679
            # 7c351473-be6a-4625-b34e-2cdbd928463c

        # await set_settlement_name_part(
        #     v_polys_sql_file,
        #     conn,
        #     uuid.UUID("de49fb50-5c59-4986-bfa0-daaa07106388"),
        #     True,
        # )
        #
        # await set_settlement_name_part(
        #     v_polys_sql_file,
        #     conn,
        #     uuid.UUID("5a2def47-c45c-4056-b453-f2c25dfebf08"),
        #     True,
        # )
        #
        # sys.exit(0)


        # await soft_delete_sp(v_polys_sql_file, conn, [uuid.UUID("e2672e8c-0883-4d32-af2a-26c528615ecb")])
        # sys.exit(0)

        #  Needed to hand run this, a missing split child that needed to change boundaries
        """
        

WITH polys AS (
SELECT (ST_Dump(sp.geom)).geom AS geom FROM "partitions_settlement_part"."settlement_part_09927_latest" sp
WHERE sp.global_id = 'a94c2a5e-e4a4-4418-ac75-d2ea3cb79523'
), ver as (SELECT max(c.id) AS id FROM master.commits c WHERE c.publish_user = 'eg@novel-t.ch')   
INSERT INTO "partitions_settlement_part"."settlement_part_08742"  
(
    "version_id", "is_deleted",
    "global_id", "boundary_polygon", "comments",
    "geom", "type", 
	"split_type", "split_parent", "original_guids", "properties"
)  
SELECT 
	    ver.id, False,
	    uuid_generate_v4(), 
		'27b745dd-73e2-4829-919f-6528947195cb',
		'boundary switched',
		polys.geom, 'ssa', 'none', NULL, 
		ARRAY['a94c2a5e-e4a4-4418-ac75-d2ea3cb79523']::uuid[],
		jsonb_build_object(
        'user_name',  'eg@novel-t.ch'  ,
        'data_comment', 'split child recreated by hand in adjacent target ward to resolve data problem by eg@novel-t.ch',
        'modified_date', now()::text,
        'settlement_name', sn.name
    ) AS properties
FROM "partitions_settlement_name"."settlement_name_08742_latest" sn
LEFT JOIN polys
ON ST_Intersects(polys.geom, sn.geom),
ver
WHERE sn.global_id = 'f9605c83-8c73-4f3d-b532-b03f0a7f850a';
"""

        # await v_split_sp(
        #     v_polys_sql_file,
        #     conn,
        #     uuid.UUID("d824d74a-6862-4b7c-9003-bba6455d2edf"),
        # )

        # await soft_delete_sp(v_polys_sql_file, conn, [ uuid.UUID("56f31c49-44cf-4895-ac06-d2090f3f5677")])



        # await soft_delete_sp(v_polys_sql_file, conn, [ uuid.UUID("37ffddc6-8c79-4f12-a214-d11e11e3e6d6")])

        # await soft_delete_sp(v_polys_sql_file, conn, [ uuid.UUID("0258db9d-89fe-4738-8408-6e034a66a4b9")])


        # await set_settlement_name_part(v_polys_sql_file, conn, uuid.UUID("f9605c83-8c73-4f3d-b532-b03f0a7f850a"), True)
        # sys.exit(0)

        # await soft_delete_sp(v_polys_sql_file, conn, [ uuid.UUID('bd79f80a-d307-4b98-805c-4ea4bbd79cc6')])
        # await soft_delete_sp(
        #     v_polys_sql_file, conn, [uuid.UUID('5ae732c6-2fd9-45c8-bbe3-93c360417aa5')]
        # )
        #
        # sys.exit(0)

        """
        
REFRESH MATERIALIZED VIEW "partitions_settlement_part"."settlement_part_04179_latest";

SELECT * FROM "partitions_settlement_part"."settlement_part_04179"
WHERE global_id = 'd67a0491-8c87-469a-ac5e-fca4e4024a74' AND version_id = 559
;

UPDATE "partitions_settlement_part"."settlement_part_04179"
SET properties = jsonb_set(properties, '{comment}', '"split parent was b8f991bf-ae12-4e75-96e3-8923bef889b5"'::jsonb),
split_parent = null
WHERE global_id = 'd67a0491-8c87-469a-ac5e-fca4e4024a74' AND version_id = 559;




        """

        for ci_guid in [
        "5fa73ee7-64dd-488f-9dd4-1ff5c0145090",
        "30fad290-81e7-496f-80ac-aeea7be87303",
        "143b1ba6-e0be-470a-b29b-cdb84f97e296",
        "b4affd17-b535-4942-b1a2-4a02ea55b00f",
        "64318522-cdd5-4d45-b029-3cab00826505",
        "01ba4231-2505-402c-a6e0-632a576df000"
        ]:
            await soft_delete_ci(
                v_polys_sql_file,
                conn,
                uuid.UUID(ci_guid),
            )

        # sys.exit(0)

        # Set to false for development to not copy all the data first
        create_data = True

        if create_data:
            await drop_schema(conn, DbCheckNames.TEMP_SCHEMA, cascade=True)

            await create_schema(conn, DbCheckNames.TEMP_SCHEMA)

            boundaries = await get_b3_list_and_create_b_table(conn, params)

            await create_tables(
                conn,
            )

            for boundary in boundaries:
                log.info(f"Copying data from {boundary} latest views")

                await copy_partition_data(conn, boundary)

        await create_check_indexes(conn)

        status_list: List[DataCheckItemStatus] = []

        # Now the problems / checks
        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.VERSION_ID,
                passed=await check_version_id(conn),
            )
        )

        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.DANGLING_CI,
                passed=await check_dangling_ci(
                    conn,
                ),
            )
        )

        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.CI_BOUNDARY,
                passed=await check_ci_boundary(conn),
            )
        )

        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.EXCLUDED_INCLUDED,
                passed=await check_excluded_included(conn),
            )
        )

        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.MISSING_SPLIT_PARENT,
                passed=await check_missing_split_parent(conn),
            )
        )

        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.SPLIT_PARENT_NO_CHILDREN,
                passed=await check_split_parent_no_children(conn),
            )
        )

        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.SPLIT_PARENT_NO_NAME,
                passed=await check_split_parent_no_name(conn),
            )
        )

        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.DUPLICATES,
                passed=await check_dups(conn, dups_sql_file)
            )
        )

        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.NAMES_MISSING_SP_IN_BOUNDARY,
                passed=await check_names_missing_sp_in_boundary(conn),
            )
        )

        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.PARTS_MANY_PNS,
                passed=await check_parts_many_pns(conn),
            )
        )

        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.NAME_WITHOUT_PART,
                passed=await check_names_without_a_part(conn, names_without_part_file),
            )
        )

        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.PARTS_WITHOUT_NAME,
                passed=await check_parts_without_a_name(conn, main_sql_file),
            )
        )

        status_list.append(
            DataCheckItemStatus(
                check_name=DbCheckIds.PART_NAME_BOUNDARY_MISMATCH,
                passed=await check_part_name_boundary_mismatch(conn, main_sql_file),
            )
        )

        #

        # # view_empty_catchment(conn, lga_guid)
        #
        # check_deleted_includes(conn)
        #
        #
        # check_names_without_part(conn)
        #
        #
        # # Commented because slow
        #
        # view_intersecting_sp(conn)

    return DataCheckStatus(status_list=status_list)


async def copy_partition_data(conn: ConnType, b3_boundary: OperatingBoundary) -> None:
    sql = (
        SQL("""
INSERT INTO {sn_dest} 
SELECT * FROM {sn_src};

INSERT INTO {sp_dest} 
SELECT * FROM {sp_src};

INSERT INTO {hf_dest} 
SELECT * FROM {hf_src};

INSERT INTO {ci_dest} 
SELECT * FROM {ci_src};

            """)
        .format(
            sn_dest=DbCheckNames.SN.as_identifier(),
            sn_src=GeneralDbNames.SCHEMA_SN.get_table_as_identifier(
                b3_boundary.partition_id, True
            ),
            sp_dest=DbCheckNames.SP.as_identifier(),
            sp_src=GeneralDbNames.SCHEMA_SP.get_table_as_identifier(
                b3_boundary.partition_id, True
            ),
            ci_dest=DbCheckNames.CI.as_identifier(),
            ci_src=GeneralDbNames.SCHEMA_CI.get_table_as_identifier(
                b3_boundary.partition_id, True
            ),
            hf_dest=DbCheckNames.HF.as_identifier(),
            hf_src=GeneralDbNames.SCHEMA_HF.get_table_as_identifier(
                b3_boundary.partition_id, True
            ),
        )
        .as_string()
    )

    await execute_log(conn, sql)


async def create_tables(conn: ConnType) -> None:
    sql = (
        SQL("""
        CREATE TABLE {sn_dest} (
            LIKE {sn_src}
        );
        CREATE TABLE {sp_dest} (
            LIKE {sp_src}
        );
        CREATE TABLE {hf_dest} (
            LIKE {hf_src}
        );
        CREATE TABLE {ci_dest} (
            LIKE {ci_src}
        );

        """)
        .format(
            sn_dest=DbCheckNames.SN.as_identifier(),
            sn_src=GeneralDbNames.PARTITION_BASE_SN.as_identifier(),
            sp_dest=DbCheckNames.SP.as_identifier(),
            sp_src=GeneralDbNames.PARTITION_BASE_SP.as_identifier(),
            ci_dest=DbCheckNames.CI.as_identifier(),
            ci_src=GeneralDbNames.PARTITION_BASE_CI.as_identifier(),
            hf_dest=DbCheckNames.HF.as_identifier(),
            hf_src=GeneralDbNames.PARTITION_BASE_HF.as_identifier(),
        )
        .as_string()
    )

    await execute_log(conn, sql)


async def get_b3_list_and_create_b_table(
    conn: ConnType, params: DataCheckParams
) -> List[OperatingBoundary]:
    """
    In the checks we need to know if the boundary is only in the included area
    or if it is part of the primary boundary id to check
    """

    create_sql = (
        SQL(
            """   
-- boundary.polygon definition
CREATE TABLE IF NOT EXISTS {boundary} (
    global_id uuid PRIMARY KEY,    
    b1_name text NOT NULL,
    b2_name text NOT NULL,
    b3_name text NOT NULL,
    partition_id int NOT NULL,
    participating bool NOT NULL,
    is_surrounding bool NOT NULL
);
            """
        )
        .format(boundary=DbCheckNames.BOUNDARY.as_identifier())
        .as_string()
    )

    await conn.execute(create_sql)

    op_b_list = await get_operating_boundaries(conn, params.boundary_guid_list)
    # to limit area

    await conn.copy_records_to_table(
        table_name=DbCheckNames.BOUNDARY.table_name,
        schema_name=DbCheckNames.BOUNDARY.schema_name,
        columns=[
            "global_id",
            "b3_name",
            "b2_name",
            "b1_name",
            "partition_id",
            "participating",
            "is_surrounding",
        ],
        records=[
            (
                op_b.global_id,
                op_b.hierarchy_names[0],
                op_b.hierarchy_names[1],
                op_b.hierarchy_names[2],
                op_b.partition_id,
                op_b.participating,
                op_b.is_surrounding,
            )
            for op_b in op_b_list
        ],
    )
    return op_b_list


def get_extended_extent_sql(params: DataCheckParams) -> Composed:
    level_check: Union[SQL, Composed] = SQL("")

    if params.limit_boundary_to_level:
        level_check = SQL("AND b.level = {level}").format(
            level=SqlLiteral(BOUNDARY_OPERATING_LEVEL)
        )

    # Returns the extents for each boundary but extended by buffer (3km)
    return SQL("""
    WITH extended_extent AS
        (
            SELECT ST_Transform(ST_SetSRID(
                ST_MakeBox2D(
                    ST_Point(
                        ST_XMin(sb.geom_envelope) - {buffer_m},
                        ST_YMin(sb.geom_envelope) - {buffer_m}
                    ),
                    ST_Point(
                        ST_XMax(sb.geom_envelope) + {buffer_m},
                        ST_YMax(sb.geom_envelope) + {buffer_m}
                    )
                ), 3857), 4326) as geom
            FROM {boundary} b
            CROSS JOIN LATERAL (
                SELECT ST_Transform(ST_Envelope(b.geom), 3857) 
                as geom_envelope
            ) sb
            WHERE b.global_id IN ( {b_guid_list} )
            {level_check}    
        )""").format(
        b_guid_list=SQL(", ").join(
            [SqlLiteral(b_guid) for b_guid in params.boundary_guid_list]
        ),
        boundary=GeneralDbNames.BOUNDARY_POLYGON_LATEST.as_identifier(),
        buffer_m=SqlLiteral(3000),
        level_check=level_check,
    )


async def create_check_indexes(conn: PoolConn) -> None:
    for table_name in [
        DbCheckNames.SN,
        DbCheckNames.CI,
        DbCheckNames.SP,
        DbCheckNames.HF,
    ]:
        await create_index(
            conn, table_name.with_column_name("global_id"), is_geom=False
        )
        await create_index(
            conn, table_name.with_column_name("version_id"), is_geom=False
        )
        await create_index(
            conn, table_name.with_column_name("boundary_polygon"), is_geom=False
        )
        await create_index(conn, table_name.with_column_name("geom"), is_geom=True)

    await create_index(
        conn, DbCheckNames.CI.with_column_name("health_facility_point"), is_geom=False
    )
    await create_index(
        conn, DbCheckNames.CI.with_column_name("settlement_part"), is_geom=False
    )

    await create_index(
        conn, DbCheckNames.SN.with_column_name("settlement_part"), is_geom=False
    )

    await create_index(conn, DbCheckNames.HF.with_column_name("parent"), is_geom=False)
