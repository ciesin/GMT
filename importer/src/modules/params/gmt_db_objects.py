from typing import Self

from psycopg.sql import Identifier
from pydantic import BaseModel

from lib.async_db_utils import SchemaTable


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
