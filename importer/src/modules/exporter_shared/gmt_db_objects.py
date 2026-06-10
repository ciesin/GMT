from typing import Self

from psycopg.sql import Identifier
from pydantic import BaseModel

from lib.async_db_utils import SchemaTable, SchemaView


class ModelPartitionSchema(BaseModel):
    schema_name: str

    def get_table_as_identifier(
        self: Self, boundary_partition_id: int, is_latest: bool
    ) -> Identifier:
        return Identifier(
            self.schema_name,
            self.schema_name.replace("partitions_", "")
            + "_"
            + str(boundary_partition_id).zfill(5)
            + ("_latest" if is_latest else ""),
        )

    def get_table(
        self: Self, boundary_partition_id: int, is_latest: bool
    ) -> SchemaTable:
        return SchemaTable(
            schema_name=self.schema_name,
            table_name=self.schema_name.replace("partitions_", "")
            + "_"
            + str(boundary_partition_id).zfill(5)
            + ("_latest" if is_latest else ""),
        )


class GeneralDbNames:
    BOUNDARY_POLYGON_LATEST = SchemaTable(
        schema_name="boundary",
        table_name="polygon_latest",
    )

    BOUNDARY_ID = SchemaTable(
        schema_name="partitions",
        table_name="boundary_id",
    )

    PARTITION_BASE_SP = SchemaTable(
        schema_name="partitions", table_name="settlement_part"
    )
    PARTITION_BASE_SN = SchemaTable(
        schema_name="partitions", table_name="settlement_name"
    )
    PARTITION_BASE_HF = SchemaTable(
        schema_name="partitions", table_name="health_facility_point"
    )
    PARTITION_BASE_CI = SchemaTable(
        schema_name="partitions", table_name="ri_catchment_item"
    )

    COMMITS = SchemaTable(
        schema_name="master",
        table_name="commits",
    )

    SCHEMA_SP = ModelPartitionSchema(schema_name="partitions_settlement_part")
    SCHEMA_SN = ModelPartitionSchema(schema_name="partitions_settlement_name")
    SCHEMA_CI = ModelPartitionSchema(schema_name="partitions_ri_catchment_item")
    SCHEMA_HF = ModelPartitionSchema(schema_name="partitions_health_facility_point")


class ExportDbNames:
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

    # Consolidated Health facilities from current GMT instance with cumulative totals
    HF = SchemaTable(schema_name=TEMP_SCHEMA, table_name="hf")

    # just fp totals, otherwise identical to hf
    FP = SchemaTable(schema_name=TEMP_SCHEMA, table_name="fp")

    # outreach with totals just ofr it
    OUTREACH = SchemaTable(schema_name=TEMP_SCHEMA, table_name="outreach")

    CATCHMENTS = SchemaTable(schema_name=TEMP_SCHEMA, table_name="catchments")

    # Consolidated catchment items from current GMT instance
    CI = SchemaTable(schema_name=TEMP_SCHEMA, table_name="ci")

    # Consolidated catchment polygons from current GMT instance
    CP = SchemaTable(schema_name=TEMP_SCHEMA, table_name="cp")

    # Consolidated settlement parts, uses source field to distinguish between datasets
    SET = SchemaTable(
        schema_name=TEMP_SCHEMA,
        table_name="set",
    )

    # used in excel export, hf catchments tab
    MOBILE_SETTLEMENTS = SchemaView(
        schema_name=TEMP_SCHEMA, view_name="hfc_mobile_settlements"
    )
    FP_SUMMARY = SchemaView(schema_name=TEMP_SCHEMA, view_name="hfc_fp_summary")
    HF_SUMMARY = SchemaView(schema_name=TEMP_SCHEMA, view_name="hfc_hf_summary")
    MOBILE_SUMMARY = SchemaView(schema_name=TEMP_SCHEMA, view_name="hfc_mobile_summary")
    COVERED_SETTLEMENTS = SchemaView(
        schema_name=TEMP_SCHEMA, view_name="hfc_covered_settlements"
    )
