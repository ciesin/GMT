import xlsxwriter  # type: ignore
from asyncpg import Record
from psycopg.sql import SQL, Literal as SqlLiteral

from lib.async_db_utils import PoolConn, fetch_log
from modules.excel_exporter.constants import REW_FONT_NAME
from modules.exporter_shared.operating_boundaries import OperatingBoundary


async def create_background_and_services_sheet(
    workbook: xlsxwriter.Workbook,
    fixed_post_record: Record,
    conn: PoolConn,
    boundary: OperatingBoundary,
) -> None:
    worksheet = workbook.add_worksheet("GMT Background and Services")

    # Define formats

    regular_bold = workbook.add_format(
        {
            "bold": True,
        }
    )
    regular_bold.set_font_name(REW_FONT_NAME)
    regular_bold.set_font_size(11)

    regular = workbook.add_format()
    regular.set_font_name(REW_FONT_NAME)
    regular.set_font_size(11)

    # Set column widths for layout
    worksheet.set_column(0, 0, 8.43)
    worksheet.set_column(1, 1, 4.29)
    worksheet.set_column(2, 7, 24.29)

    header_first_col = 1

    # header
    current_row = write_header_section(
        workbook,
        worksheet,
        fixed_post_record,
        regular,
        regular_bold,
        header_first_col,
        boundary,
    )

    # Table headers
    all_borders = workbook.add_format()
    all_borders.set_bold(True)
    all_borders.set_border(6)
    worksheet.write_string(current_row, header_first_col, "S/N", all_borders)

    tbr_borders = workbook.add_format()
    tbr_borders.set_bold(True)
    tbr_borders.set_right(1)
    tbr_borders.set_top(2)
    tbr_borders.set_bottom(2)

    for header_index, header_text in enumerate(
        [
            "Services",
            "Is this facility providing this service? (Yes/No)",
            "Day of service (e.g. Daily, Mon, Tue, etc.)",
            "Service Provider",
            "Qualification",
        ]
    ):
        worksheet.write_string(
            current_row,
            header_first_col + 1 + header_index,
            header_text,
            tbr_borders,
        )

    tbr_borders = workbook.add_format()
    tbr_borders.set_bold(True)
    tbr_borders.set_top(2)
    tbr_borders.set_bottom(2)
    tbr_borders.set_right(2)
    worksheet.write_string(
        current_row, header_first_col + 6, "Phone Number", tbr_borders
    )

    row_data_sql = (
        SQL("""
    
WITH services AS (
    SELECT
	e.enumlabel AS name 
FROM
	pg_type t
JOIN pg_enum e ON
	t.oid = e.enumtypid
JOIN pg_namespace n ON
	t.typnamespace = n.oid
WHERE
	t.typname = 'hf_services'
	AND n.nspname = 'public'
ORDER BY
	e.enumsortorder
), hf AS (
SELECT * FROM partitions.health_facility_point hf 
WHERE hf.boundary_polygon = {boundary_polygon}
AND hf.global_id  = {hf_global_id}
AND hf."type"  = 'fixed_post'
AND NOT is_deleted
ORDER BY version_id DESC
LIMIT 1
)
SELECT 
    row_number() OVER (), 
    s.name, 
    CASE WHEN s.name::public.hf_services = ANY(hf.services) 
        THEN 'YES' ELSE 'NO' 
    END,
    CASE WHEN s.name::public.hf_services = ANY(hf.services) 
        THEN health_facility.describe_operating_hours(hf.operating_hours_start, hf.operating_hours_stop) 
        --If not providing service, day of service should be blank 
        ELSE '' 
    END AS "day_of_service"    
FROM services s, hf 
;""")
        .format(
            boundary_polygon=SqlLiteral(fixed_post_record["boundary_polygon"]),
            hf_global_id=SqlLiteral(fixed_post_record["global_id"]),
        )
        .as_string()
    )
    table_data = await fetch_log(conn, row_data_sql)

    bl_borders = workbook.add_format()
    bl_borders.set_left(1)
    bl_borders.set_bottom(1)

    blr_borders = workbook.add_format()
    blr_borders.set_left(1)
    blr_borders.set_bottom(1)
    blr_borders.set_right(2)

    for row in table_data:
        current_row += 1
        worksheet.write_number(current_row, header_first_col, row[0], bl_borders)
        worksheet.write_string(current_row, header_first_col + 1, row[1], bl_borders)
        worksheet.write_string(current_row, header_first_col + 2, row[2], bl_borders)
        worksheet.write_string(current_row, header_first_col + 3, row[3], bl_borders)
        worksheet.write_string(current_row, header_first_col + 4, "", bl_borders)
        worksheet.write_string(current_row, header_first_col + 5, "", bl_borders)

        worksheet.write_string(current_row, header_first_col + 6, "", blr_borders)


def write_header_section(
    workbook: xlsxwriter.Workbook,
    worksheet: xlsxwriter.worksheet,
    fixed_post_record: Record,
    regular: xlsxwriter.format,
    regular_bold: xlsxwriter.format,
    header_first_col: int,
    boundary: OperatingBoundary,
) -> int:
    header_format = workbook.add_format(
        {
            "bold": True,
        }
    )
    header_format.set_font_name(REW_FONT_NAME)
    header_format.set_font_size(18)

    current_row = 0
    worksheet.write_string(current_row, 4, "GMT Export", header_format)
    worksheet.set_row(current_row, 23.25)

    current_row += 1
    worksheet.write_string(
        current_row,
        header_first_col,
        "Form 0: Background information and services",
        regular_bold,
    )

    current_row += 2
    header_second_col = 5
    worksheet.write_string(
        current_row,
        header_first_col,
        "Health Facility: ____________________",
        regular_bold,
    )

    worksheet.write_string(
        current_row,
        header_first_col + 2,
        fixed_post_record["name"],
        regular,
    )

    worksheet.write_string(
        current_row,
        header_second_col,
        "Type of Facility: ____________________",
        regular_bold,
    )
    worksheet.write_string(
        current_row,
        header_second_col + 1,
        "Private" if fixed_post_record["private"] else "Public",
        regular,
    )
    current_row += 2

    worksheet.write_string(
        current_row,
        header_first_col,
        "Ward: ____________________",
        regular_bold,
    )

    worksheet.write_string(
        current_row,
        header_first_col + 1,
        boundary.hierarchy_names[0],  # Ward
        regular,
    )
    worksheet.write_string(
        current_row,
        header_first_col + 2,
        boundary.hierarchy_names[1],  # LGA
        regular,
    )

    worksheet.write_string(
        current_row,
        header_second_col,
        "Zone: _______________________________",
        regular_bold,
    )

    current_row += 2

    worksheet.write_string(
        current_row,
        header_first_col,
        "Phone Number: ________________________",
        regular_bold,
    )
    worksheet.write_string(
        current_row,
        header_second_col,
        "Name of Facility In Charge: ______________________",
        regular_bold,
    )

    current_row += 2

    return current_row
