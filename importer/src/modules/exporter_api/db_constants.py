from functools import cached_property
import uuid

from pydantic import BaseModel

from lib.async_db_utils import SchemaTable

SCHEMA_SP = "partitions_settlement_part"
SCHEMA_SN = "partitions_settlement_name"
SCHEMA_CI = "partitions_ri_catchment_item"
SCHEMA_HF = "partitions_health_facility_point"

COMMENT_LAST_SYNC_TIME_GMT = "Timestamp in the GMT time zone when the settlement was last updated/changed.  Note Excel may not interpret this correctly when opening the csv file."
COMMENT_EXPORT_TIME_GMT = (
    "Timestamp in the GMT time zone when this record was exported."
)
COMMENT_PART_FP = "fixed post"
COMMENT_FP_NAME = f"Name of the {COMMENT_PART_FP}"


class OperatingBoundary(BaseModel):
    global_id: uuid.UUID
    code: str
    name: str

    partition_id: int

    ward_guid: uuid.UUID
    lga_guid: uuid.UUID

    #
    @cached_property
    def partition_id_str(self) -> str:
        return str(self.partition_id).zfill(5)


class StateExportDbNames:
    TEMP_SCHEMA = "state_export"

    BOUNDARY = SchemaTable(schema_name=TEMP_SCHEMA, table_name="boundary")

    # Consolidated Health facilities from current GMT instance
    RAW_HF = SchemaTable(schema_name=TEMP_SCHEMA, table_name="raw_hf")

    # Consolidated catchment items from current GMT instance
    RAW_CI = SchemaTable(schema_name=TEMP_SCHEMA, table_name="raw_ci")

    # Settlement names as is
    RAW_SN = SchemaTable(
        schema_name=TEMP_SCHEMA,
        table_name="raw_sn",
    )
    # Settlement parts as is
    RAW_SP = SchemaTable(
        schema_name=TEMP_SCHEMA,
        table_name="raw_sp",
    )

    CATCHMENTS = SchemaTable(schema_name=TEMP_SCHEMA, table_name="catchments")

    # Consolidated Health facilities from current GMT instance

    # Cumulative fixed posts including the outreach totals
    HF = SchemaTable(schema_name=TEMP_SCHEMA, table_name="hf")

    # Showing stats of just that one
    OUTREACH = SchemaTable(schema_name=TEMP_SCHEMA, table_name="outreach")
    FP = SchemaTable(schema_name=TEMP_SCHEMA, table_name="fp")

    # Consolidated catchment items from current GMT instance
    CI = SchemaTable(schema_name=TEMP_SCHEMA, table_name="ci")

    # Consolidated catchment polygons from current GMT instance
    CP = SchemaTable(schema_name=TEMP_SCHEMA, table_name="cp")

    # Consolidated settlement parts, uses source field to distinguish between datasets
    SET = SchemaTable(
        schema_name=TEMP_SCHEMA,
        table_name="set",
    )
