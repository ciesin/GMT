import os


from lib.async_db_utils import SchemaTable

BOUNDARY_OPERATING_LEVEL = int(os.environ.get("OPERATIONAL_BOUNDARY_LEVEL", 3))


class DbCheckNames:
    TEMP_SCHEMA = "db_check"

    # to store if surrounding or not too
    BOUNDARY = SchemaTable(schema_name=TEMP_SCHEMA, table_name="boundary")

    # Consolidated Health facilities from current GMT instance
    HF = SchemaTable(schema_name=TEMP_SCHEMA, table_name="hf")

    # Consolidated catchment items from current GMT instance
    CI = SchemaTable(schema_name=TEMP_SCHEMA, table_name="ci")

    SP = SchemaTable(
        schema_name=TEMP_SCHEMA,
        table_name="sp",
    )

    SN = SchemaTable(
        schema_name=TEMP_SCHEMA,
        table_name="sn",
    )
