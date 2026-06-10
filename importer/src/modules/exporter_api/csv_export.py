import re
from typing import List, Tuple, Dict

from psycopg.sql import SQL, Literal as SqlLiteral, Identifier

from lib.async_db_utils import get_column_names, fetch_log
from lib.logger_utils import get_logger
from modules.exporter_shared.gmt_db_objects import ExportDbNames

from modules.params.flask_root_params import StateExportParams

log = get_logger(__name__)


async def export_csvs(params: StateExportParams) -> None:
    tables = [
        StateExportDbNames.HF,
        StateExportDbNames.SET,
        StateExportDbNames.CI,
        StateExportDbNames.FP,
        StateExportDbNames.OUTREACH,
    ]
    csv_files = [
        "hf_export.csv",
        "settlements_export.csv",
        "ci_export.csv",
        "fp_export.csv",
        "outreach_export.csv",
    ]

    async with params.gmt_db.get_asyncpg_connection() as conn:
        for table, file in zip(tables, csv_files):
            output_path = params.staging_base_dir / params.csv_subdir / file
            output_path.parent.mkdir(parents=True, exist_ok=True)

            column_names = await get_column_names(conn, table)

            if table in [StateExportDbNames.SET, StateExportDbNames.HF, StateExportDbNames.OUTREACH, StateExportDbNames.FP]:
                column_names.remove("geom")
                query = (
                    SQL("""
                SELECT {selCols} 
                FROM {table} src
                """)
                    .format(
                        table=table.as_identifier(),
                        selCols=SQL(", ").join(
                            [Identifier("src", c) for c in column_names]
                        ),
                    )
                    .as_string()
                )

            else:
                query = (
                    SQL("select * from {table}")
                    .format(table=table.as_identifier())
                    .as_string()
                )

            with open(output_path, "wb") as f:
                await conn.copy_from_query(
                    query=query,
                    output=f,
                    format="csv",
                    header=True,
                )

        await conn.close()


CHECK_REGEX = re.compile(
    rf"""
        {re.escape("CHECK ((")}                      # "CHECK ((" literal
            (\w+)                        # Capture the column name (e.g., settlement_type)
            \s*=\s*                       # Match '=' with optional whitespace
            ANY \s*                        # Match "ANY" with optional whitespace
            \(                            # Opening parenthesis '('
            ARRAY\[
            (.*?)                          # Capture everything inside the ARRAY[...] (the values)
            \]                            # Closing bracket
        \)\)                              # Closing parentheses for the CHECK constraint
    """,
    re.VERBOSE,
)


def parse_check_constraint(constraint_def: str) -> Tuple[str, List[str]]:
    # Regex pattern to match the column and expression in the CHECK constraint
    log.debug(f"Parsing {constraint_def}")
    match = CHECK_REGEX.search(constraint_def)
    if match:
        column = match.group(1)
        values = match.group(2).replace("'", "").replace("::text", "").split(", ")
        return column, values
    else:
        return "", []


async def table_to_markdown_doc(params: StateExportParams) -> None:
    tables = [
        StateExportDbNames.HF,
        StateExportDbNames.FP,
        StateExportDbNames.OUTREACH,
        StateExportDbNames.SET,
        StateExportDbNames.CI,
        StateExportDbNames.CP,
    ]
    md_files = [
        "hf_data_dictionary.md",
        "fp_data_dictionary.md",
        "outreach_data_dictionary.md",
        "set_data_dictionary.md",
        "ci_data_dictionary.md",
        "cp_data_dictionary.md",
    ]

    async with params.gmt_db.get_asyncpg_connection() as conn:
        for table, file in zip(tables, md_files):
            sql = (
                SQL("""
SELECT 
    pg_attribute.attname AS column_name,
    pg_type.typname AS enum_type_name,
    string_agg(pg_enum.enumlabel, ', ' ORDER BY pg_enum.enumsortorder) AS enum_values
FROM 
    pg_catalog.pg_attribute
JOIN 
    pg_catalog.pg_class ON pg_class.oid = pg_attribute.attrelid
JOIN 
    pg_catalog.pg_type ON pg_type.oid = pg_attribute.atttypid
JOIN 
    pg_catalog.pg_enum ON pg_enum.enumtypid = pg_type.oid
JOIN 
    pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace    
WHERE 
    pg_type.typcategory = 'E'
    AND pg_class.relname = {table}
    AND pg_namespace.nspname = {schema}
    AND pg_attribute.attnum > 0
    AND NOT pg_attribute.attisdropped
GROUP BY 
    pg_attribute.attname,
    pg_type.typname;
""")
                .format(
                    table=SqlLiteral(table.table_name),
                    schema=SqlLiteral(table.schema_name),
                )
                .as_string()
            )

            #
            recs = await fetch_log(conn, sql, log_return=False)
            #
            enum_map: Dict[str, str] = {}

            for record in recs:
                column, values = record[0], record[2]
                log.debug(f"Parsed {column} with {values}")
                enum_map[column] = values

            sql = (
                SQL("""
    WITH column_info AS (
        SELECT
            c.table_schema,
            c.table_name,
            c.column_name,
            c.data_type,
            col_description(format('%s.%s', c.table_schema, c.table_name)::regclass::oid, c.ordinal_position) AS column_comment
        FROM information_schema.columns c
        WHERE c.table_name = {table} AND c.table_schema = {schema}
        ORDER BY c.ordinal_position
    )
    SELECT 
        ci.column_name,
        ci.data_type,
        ci.column_comment
    FROM column_info ci;
""")
                .format(
                    table=SqlLiteral(table.table_name),
                    schema=SqlLiteral(table.schema_name),
                )
                .as_string()
            )
            data = await conn.fetch(sql)

            header = "| Column Name | Data Type | Description  |\n"
            separator = "|-------------|-----------|---------|\n"
            rows = []
            for name, data_type, comment in data:
                # values = ""
                if name in enum_map:
                    data_type = enum_map[name]
                rows.append(f"| `{name}` | {data_type} | {comment} |")

            markdown_table = header + separator + "\n".join(rows)

            (params.staging_base_dir / params.csv_subdir).mkdir(
                parents=True, exist_ok=True
            )
            with open(
                params.staging_base_dir / params.csv_subdir / file, "w", newline=""
            ) as f:
                f.write(markdown_table)
