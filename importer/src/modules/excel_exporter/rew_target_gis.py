import uuid
from typing import List

from asyncpg import Record
from psycopg.sql import SQL, Literal as SqlLiteral

from lib.async_db_utils import PoolConn, fetch_log
from lib.logger_utils import get_logger
import xlsxwriter  # type: ignore

from modules.excel_exporter.constants import REW_FONT_NAME, MypyExcelFormat
from modules.exporter_shared.gmt_db_objects import GeneralDbNames
from modules.exporter_shared.operating_boundaries import (
    OperatingBoundary,
    get_operating_boundaries,
)
from dataclasses import dataclass


log = get_logger(__name__)


async def add_gmt_target_population_sheet(
    workbook: xlsxwriter.Workbook,
    is_gis: bool,
    fixed_post_record: Record,
    conn: PoolConn,
    boundary: OperatingBoundary,
) -> None:
    if is_gis:
        worksheet = workbook.add_worksheet("GMT Target Population - GIS")
    else:
        worksheet = workbook.add_worksheet("GMT Target Population - Estimat")

    # Formats
    regular = workbook.add_format()
    regular.set_font_name(REW_FONT_NAME)
    regular_bold = workbook.add_format({"bold": True})
    regular_bold.set_font_name(REW_FONT_NAME)

    header_first_col = 1

    current_row = write_header_section(
        workbook,
        worksheet,
        fixed_post_record,
        regular,
        regular_bold,
        header_first_col,
        boundary,
        is_gis,
    )

    table_first_col = header_first_col
    table_last_col = header_first_col + 10  # 11 columns total

    write_map_boxes(workbook, worksheet, current_row, table_last_col)
    write_table_header(workbook, worksheet, current_row, table_first_col, is_gis)

    # Optionally adjust column widths to make the box visually similar
    # worksheet.set_column("N:X", 10)  # Adjust as needed

    # Set column widths
    worksheet.set_column(table_first_col, table_first_col, 4.45)  # S/N
    worksheet.set_column(
        table_first_col + 1, table_first_col + 1, 24.18
    )  # Village/Settlement
    worksheet.set_column(table_first_col + 2, table_last_col, 11.36)
    worksheet.set_row(current_row, 38.25)
    worksheet.set_row(current_row + 1, 57)

    # small divider between map and rest
    worksheet.set_column_pixels(table_last_col + 1, table_last_col + 1, 11)

    # fetch explicit surrounding boundary ids

    table_data = await fetch_row_data(conn, fixed_post_record)

    # fc887bd8-5847-4c09-be89-fb4c5e9498a4/health-facilities/833c08cb-11db-4e49-8284-53782d988a8a/edit

    styles = create_styles(workbook)

    current_row += 2

    for row_idx, row in enumerate(table_data):
        worksheet.write_number(
            current_row + row_idx, table_first_col, row_idx + 1, styles.sn_style
        )
        worksheet.write_string(
            current_row + row_idx, table_first_col + 1, row["name"], styles.cell_style
        )
        pop = row["gis_pop"] if is_gis else row["est_pop"]
        worksheet.write_number(
            current_row + row_idx, table_first_col + 2, pop, styles.pop_style
        )
        for col_offset, perc in enumerate([0.04, 0.038, 0.20, 0.05, 0.16, 0.22]):
            worksheet.write_number(
                current_row + row_idx,
                table_first_col + 3 + col_offset,
                pop * perc,
                styles.pop_style,
            )

        worksheet.write_string(
            current_row + row_idx,
            table_first_col + 9,
            row["urban_rural"],
            styles.cell_style,
        )

        worksheet.write_string(
            current_row + row_idx,
            table_first_col + 10,
            row["problems"],
            styles.right_style,
        )

    table_start = current_row
    table_stop = current_row + len(table_data) - 1
    current_row = table_stop + 1

    worksheet.merge_range(
        current_row,
        table_first_col,
        current_row,
        table_first_col + 1,
        "TOTAL",
        styles.total_tl,
    )
    worksheet.merge_range(
        current_row + 1,
        table_first_col,
        current_row + 1,
        table_first_col + 1,
        "Main languages",
        styles.total_l,
    )
    worksheet.merge_range(
        current_row + 2,
        table_first_col,
        current_row + 2,
        table_first_col + 1,
        "Main occupations (2-3)",
        styles.total_l,
    )

    for col_offset, col_label in [
        (2, "D"),
        (3, "E"),
        (4, "F"),
        (5, "G"),
        (6, "H"),
        (7, "I"),
        (8, "J"),
    ]:
        worksheet.write_formula(
            current_row,
            table_first_col + col_offset,
            f"=SUM({col_label}{table_start + 1}:{col_label}{table_stop})",
            styles.total_t,
        )

    worksheet.merge_range(
        current_row,
        table_first_col + 9,
        current_row,
        table_first_col + 10,
        "",
        styles.total_r,
    )
    worksheet.merge_range(
        current_row + 1,
        table_first_col + 2,
        current_row + 1,
        table_first_col + 10,
        "",
        styles.total_r,
    )
    worksheet.merge_range(
        current_row + 2,
        table_first_col + 2,
        current_row + 2,
        table_first_col + 10,
        "",
        styles.total_r,
    )


def write_header_section(
    workbook: xlsxwriter.Workbook,
    worksheet: xlsxwriter.worksheet,
    fixed_post_record: Record,
    regular: xlsxwriter.format,
    regular_bold: xlsxwriter.format,
    header_first_col: int,
    boundary: OperatingBoundary,
    is_gis: bool,
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
        "Form 1: Target Population - " + ("GIS" if is_gis else "Estimated"),
        regular_bold,
    )

    current_row += 2

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
        header_first_col + 5,
        "Ward: ____________________",
        regular_bold,
    )
    worksheet.write_string(
        current_row,
        header_first_col + 6,
        boundary.hierarchy_names[0],  # Ward
        regular,
    )

    worksheet.write_string(
        current_row,
        header_first_col + 10,
        "LGA: ____________________",
        regular_bold,
    )

    worksheet.write_string(
        current_row,
        header_first_col + 12,
        boundary.hierarchy_names[1],  # LGA
        regular,
    )

    worksheet.write_string(
        current_row,
        header_first_col + 15,
        "State: ____________________",
        regular_bold,
    )

    worksheet.write_string(
        current_row,
        header_first_col + 16,
        boundary.hierarchy_names[2],  # LGA
        regular,
    )

    current_row += 2

    return current_row


def write_map_boxes(
    workbook: xlsxwriter.Workbook,
    worksheet: xlsxwriter.worksheet,
    current_row: int,
    table_last_col: int,
) -> None:
    # Merge the area from N4:X35 to form the box
    # Define the format for the merged map box area
    map_box_format = workbook.add_format(
        {
            "border": 2,
            "align": "center",
            "valign": "top",
        }
    )

    map_box_format_italics = workbook.add_format(
        {
            "border": 2,
            "align": "center",
            "valign": "top",
        }
    )
    map_box_format_italics.set_italic(True)

    worksheet.merge_range(
        current_row,
        table_last_col + 2,
        current_row,
        table_last_col + 11,
        # "N4:X6",
        "Map of Health Facility Catchment Area",
        map_box_format,
    )
    # log.info(f"Merge map return [{ret}]")

    worksheet.merge_range(
        current_row + 1,
        table_last_col + 2,
        current_row + 24,
        table_last_col + 11,
        # "N4:X6",
        "\n(Showing distances and population)",
        map_box_format_italics,
    )
    # log.info(f"Merge map return [{ret}]")


def create_default_table_header_format(
    workbook: xlsxwriter.Workbook,
) -> xlsxwriter.format:
    style = workbook.add_format()
    style.set_bold()
    style.set_align("center")
    style.set_align("vcenter")
    style.set_text_wrap()
    return style


def write_table_header(
    workbook: xlsxwriter.Workbook,
    worksheet: xlsxwriter.worksheet,
    current_row: int,
    table_first_col: int,
    is_gis: bool,
) -> None:
    # Merge the area from N4:X35 to form the box
    # Define the format for the merged map box area
    sn_style = create_default_table_header_format(workbook)
    sn_style.set_border(2)

    tb_style = create_default_table_header_format(workbook)
    tb_style.set_top(2)
    tb_style.set_bottom(2)
    tb_style.set_left(1)
    tb_style.set_right(1)

    b_style = create_default_table_header_format(workbook)
    b_style.set_bottom(2)
    b_style.set_left(1)
    b_style.set_right(1)

    t_style = create_default_table_header_format(workbook)
    t_style.set_top(2)
    t_style.set_right(1)
    t_style.set_left(1)
    t_style.set_bottom(1)

    r_style = create_default_table_header_format(workbook)
    r_style.set_top(2)
    r_style.set_bottom(2)
    r_style.set_right(2)

    # Table Header Rows
    worksheet.merge_range(
        current_row, table_first_col, current_row + 1, table_first_col, "S/N", sn_style
    )
    # log.info(f"Merge table return [{ok}] {current_row} {table_first_col}")
    worksheet.merge_range(
        current_row,
        table_first_col + 1,
        current_row + 1,
        table_first_col + 1,
        "Village/Settlement in GMT",
        tb_style,
    )

    worksheet.merge_range(
        current_row,
        table_first_col + 2,
        current_row + 1,
        table_first_col + 2,
        "Covered Population\n(modelled operational estimates)"
        if is_gis
        else "Covered Population (as entered by a user in GMT)",
        tb_style,
    )

    worksheet.merge_range(
        current_row,
        table_first_col + 3,
        current_row,
        table_first_col + 8,
        "Target Population (derived from modelled operational estimates)"
        if is_gis
        else "Target Population (proportion applied to the total population by GMT)",
        t_style,
    )

    target_pop_headers = [
        "0 - 11 months\n(4.0% of Total Pop)",
        "12 to 23 months (3.8% of Total Pop)",
        "<5yr (20.0% of Total Pop)",
        "Pregnant Women (5.0% of Total Pop)",
        "Adolescents (16.0% of Total Pop)",
        "Women 15-49 yrs (22.0% of Total Pop)",
    ]
    for i, header in enumerate(target_pop_headers):
        worksheet.write_string(
            current_row + 1, table_first_col + 3 + i, header, b_style
        )

    worksheet.merge_range(
        current_row,
        table_first_col + 9,
        current_row + 1,
        table_first_col + 9,
        "Settlement Type\n(Urban/Rural)",
        tb_style,
    )
    worksheet.merge_range(
        current_row,
        table_first_col + 10,
        current_row + 1,
        table_first_col + 10,
        "Hard to Reach/\nNomadic/\nRiverine",
        r_style,
    )


async def fetch_row_data(
    conn: PoolConn,
    fixed_post_record: Record,
) -> List[Record]:
    hf_boundary = uuid.UUID(str(fixed_post_record["boundary_polygon"]))
    hf_guid = uuid.UUID(str(fixed_post_record["global_id"]))
    ops = await get_operating_boundaries(conn, [hf_boundary])

    # to use the partition indexes, we need explicit ids
    b_list = SQL(", ").join([SqlLiteral(o.global_id) for o in ops])

    partition_id = 0
    for b in ops:
        if b.global_id == hf_boundary:
            partition_id = b.partition_id
            break

    # Using the partition base tables with an explicit IN will use the
    # postgres optimization to only look in the correct partitioned tables
    # instead of scanning the whole table
    sql = (
        SQL("""    
WITH ci AS (
	SELECT DISTINCT ON (p_ci.global_id) * FROM {p_ci} p_ci
	WHERE p_ci.boundary_polygon  IN ({b_list})
	ORDER BY p_ci.global_id, p_ci.version_id DESC 
), sp  AS (
	SELECT DISTINCT ON (p_sp.global_id) * FROM partitions.settlement_part p_sp
	WHERE p_sp.boundary_polygon  IN ({b_list})
	ORDER BY p_sp.global_id, p_sp.version_id DESC
), sn AS (
	SELECT DISTINCT ON (p_sn.global_id) * FROM partitions.settlement_name p_sn
	WHERE p_sn.boundary_polygon  IN ({b_list})
	ORDER BY p_sn.global_id, p_sn.version_id DESC
), 
--We need the total covered % for this fixed post + the outreaches
ci_sp AS (
	SELECT 
	    ci0.settlement_part, 
	    SUM(ci0.population_perc) AS population_perc
	FROM {hf} hf0
	INNER JOIN ci AS ci0 
		ON ci0.health_facility_point = hf0.global_id 
	WHERE (
	    (
	        hf0.global_id = {hf_guid}
			AND hf0.TYPE = 'fixed_post'
        ) OR (
			hf0.parent = {hf_guid}
            AND hf0.TYPE = 'outreach'
        )
    ) --We need to include the outreaches too
    AND NOT ci0.is_deleted 			
	AND NOT hf0.is_deleted 
	--type=include will generate generated items
	AND ci0.type = 'generated' 
	GROUP BY ci0.settlement_part
)
SELECT 
    sn.name, 
    ci_sp.population_perc/100 * sp.computed_pop AS gis_pop, 
    ci_sp.population_perc/100 * COALESCE(sn.estimated_pop, 0) AS est_pop,
    CASE WHEN sp.TYPE = 'bua' THEN 'URBAN' ELSE 'RURAL' END as urban_rural,
    --Join / Filter of any of the 3 particular problems 
    COALESCE((
        SELECT string_agg(v::text, ', ') 
        FROM (
            SELECT UNNEST(sn.problematic) AS v 
        ) t  
        WHERE v = ANY ( ARRAY['Hard To Reach', 'Riverine', 'Nomadic/Fulani']::sn_problematic[])
    ), '') as problems
FROM 
--we already filtered by hf
ci_sp 
INNER JOIN sp ON ci_sp.settlement_part = sp.global_id
INNER JOIN sn ON sn.settlement_part = sp.global_id 
WHERE 
NOT sp.is_deleted 
AND NOT sn.is_deleted
--AND hf_fp.TYPE = 'fixed_post'
AND sn.is_primary 
AND NOT COALESCE(sn.uninhabited, FALSE) 
ORDER BY lower(sn.name)
;
""")
        .format(
            p_ci=GeneralDbNames.PARTITION_BASE_CI.as_identifier(),
            p_sp=GeneralDbNames.PARTITION_BASE_SP.as_identifier(),
            p_sn=GeneralDbNames.PARTITION_BASE_SN.as_identifier(),
            hf=GeneralDbNames.SCHEMA_HF.get_table_as_identifier(partition_id, True),
            b_list=b_list,
            hf_guid=SqlLiteral(hf_guid),
        )
        .as_string()
    )

    rows = await fetch_log(conn, sql)

    return rows


@dataclass
class WorkbookStyles:
    sn_style: MypyExcelFormat
    right_style: MypyExcelFormat
    cell_style: MypyExcelFormat
    pop_style: MypyExcelFormat
    total_tl: MypyExcelFormat
    total_t: MypyExcelFormat
    total_tr: MypyExcelFormat
    total_b: MypyExcelFormat
    total_l: MypyExcelFormat
    total_r: MypyExcelFormat
    total: MypyExcelFormat


def create_styles(workbook: xlsxwriter.Workbook) -> WorkbookStyles:
    sn_style = workbook.add_format()
    sn_style.set_left(2)
    sn_style.set_right(2)
    sn_style.set_top(1)
    sn_style.set_bottom(1)

    right_style = workbook.add_format()
    right_style.set_left(1)
    right_style.set_right(2)
    right_style.set_top(1)
    right_style.set_bottom(1)
    right_style.set_text_wrap()

    cell_style = workbook.add_format()
    cell_style.set_border(1)
    cell_style.set_text_wrap()

    pop_style = workbook.add_format()
    pop_style.set_border(1)
    pop_style.set_num_format("0")

    total_tl = workbook.add_format()
    total_tl.set_top(2)
    total_tl.set_left(2)
    total_tl.set_right(1)
    total_tl.set_bottom(1)
    total_tl.set_bold()

    total_t = workbook.add_format()
    total_t.set_top(2)
    total_t.set_left(1)
    total_t.set_right(1)
    total_t.set_bottom(1)
    total_t.set_num_format("0")
    total_t.set_bold()

    total_tr = workbook.add_format()
    total_tr.set_top(2)
    total_tr.set_left(1)
    total_tr.set_right(2)
    total_tr.set_bottom(1)
    total_tr.set_bold()

    total_b = workbook.add_format()
    total_b.set_top(2)
    total_b.set_left(2)
    total_b.set_right(1)
    total_b.set_bottom(1)

    total_l = workbook.add_format()
    total_l.set_top(1)
    total_l.set_left(2)
    total_l.set_right(1)
    total_l.set_bottom(1)
    total_l.set_bold()

    total_r = workbook.add_format()
    total_r.set_top(1)
    total_r.set_left(1)
    total_r.set_right(2)
    total_r.set_bottom(1)
    total_r.set_bold()

    total = workbook.add_format()
    total.set_top(1)
    total.set_left(1)
    total.set_right(1)
    total.set_bottom(1)
    total.set_bold()

    return WorkbookStyles(
        sn_style=sn_style,
        right_style=right_style,
        cell_style=cell_style,
        pop_style=pop_style,
        total_tl=total_tl,
        total_t=total_t,
        total_tr=total_tr,
        total_b=total_b,
        total_l=total_l,
        total_r=total_r,
        total=total,
    )
