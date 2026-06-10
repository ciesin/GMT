from asyncpg import Record

from lib.async_db_utils import PoolConn
from lib.logger_utils import get_logger
from modules.excel_exporter.constants import REW_FONT_NAME
from modules.exporter_shared.operating_boundaries import OperatingBoundary
import uuid
from typing import List

from psycopg.sql import SQL, Literal as SqlLiteral

from lib.async_db_utils import fetch_log
import xlsxwriter  # type: ignore

from modules.exporter_shared.gmt_db_objects import GeneralDbNames
from modules.exporter_shared.operating_boundaries import (
    get_operating_boundaries,
)
import numbers

log = get_logger(__name__)


async def add_gmt_catchment_area_for_services_sheet(
    workbook: xlsxwriter.Workbook,
    fixed_post_record: Record,
    conn: PoolConn,
    boundary: OperatingBoundary,
) -> None:
    worksheet = workbook.add_worksheet("GMT Catchment Area for Services")

    # column widths
    worksheet.set_column(1, 1, 4.29)  # S/N
    worksheet.set_column(2, 2, 24.29)  # Village/set
    worksheet.set_column(3, 10, 11.29)  # Rest of table cols

    # for label to fit
    worksheet.set_column(7, 7, 13)

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
    )

    table_first_col = header_first_col
    # table_last_col = header_first_col + 9  # 10 columns total

    write_table_header(workbook, worksheet, current_row, table_first_col)

    table_data = await fetch_row_data(conn, fixed_post_record)

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

    cell_style = workbook.add_format()
    cell_style.set_border(1)
    cell_style.set_text_wrap()

    dist_style = workbook.add_format()
    dist_style.set_border(1)
    dist_style.set_num_format("0")

    current_row += 2

    for row_idx, row in enumerate(table_data):
        worksheet.write_number(
            current_row + row_idx, table_first_col, row_idx + 1, sn_style
        )
        worksheet.write_string(
            current_row + row_idx, table_first_col + 1, row["name"], cell_style
        )

        if isinstance(row["fp_dist"], numbers.Number):
            worksheet.write_number(
                current_row + row_idx, table_first_col + 2, row["fp_dist"], dist_style
            )
        else:
            worksheet.write_string(
                current_row + row_idx,
                table_first_col + 2,
                "",
                cell_style,
            )
        if isinstance(row["outreach_dist"], numbers.Number):
            worksheet.write_number(
                current_row + row_idx,
                table_first_col + 3,
                row["outreach_dist"],
                dist_style,
            )
        else:
            worksheet.write_string(
                current_row + row_idx,
                table_first_col + 3,
                "",
                cell_style,
            )
        if isinstance(row["mobile_dist"], numbers.Number):
            worksheet.write_number(
                current_row + row_idx,
                table_first_col + 4,
                row["mobile_dist"],
                dist_style,
            )
        else:
            worksheet.write_string(
                current_row + row_idx,
                table_first_col + 4,
                "",
                cell_style,
            )

        worksheet.write_string(
            current_row + row_idx, table_first_col + 5, row["ri"], cell_style
        )

        worksheet.write_string(
            current_row + row_idx, table_first_col + 6, row["type"], cell_style
        )

        worksheet.write_string(
            current_row + row_idx,
            table_first_col + 7,
            bool_to_yesno(row["anc"]),
            cell_style,
        )
        worksheet.write_string(
            current_row + row_idx,
            table_first_col + 8,
            bool_to_yesno(row["ld"]),
            cell_style,
        )
        worksheet.write_string(
            current_row + row_idx,
            table_first_col + 9,
            bool_to_yesno(row["fam_plan"]),
            right_style,
        )


def bool_to_yesno(val: bool) -> str:
    if val:
        return "YES"
    return "NO"


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
        "Form 2: Catchment area for services",
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
        header_first_col + 7,
        "LGA: ____________________",
        regular_bold,
    )

    worksheet.write_string(
        current_row,
        header_first_col + 8,
        boundary.hierarchy_names[1],  # LGA
        regular,
    )

    worksheet.write_string(
        current_row,
        header_first_col + 9,
        "State: ____________________",
        regular_bold,
    )

    worksheet.write_string(
        current_row,
        header_first_col + 10,
        boundary.hierarchy_names[2],  # LGA
        regular,
    )

    current_row += 2

    return current_row


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
        current_row,
        table_first_col + 4,
        "Distance from Health Facility",
        t_style,
    )

    worksheet.write_string(
        current_row + 1, table_first_col + 2, "Fixed Post (<2km)", b_style
    )
    worksheet.write_string(
        current_row + 1, table_first_col + 3, "Outreach (2-5km)", b_style
    )
    worksheet.write_string(
        current_row + 1, table_first_col + 4, "Mobile (>5km)", b_style
    )

    worksheet.merge_range(
        current_row,
        table_first_col + 5,
        current_row,
        table_first_col + 6,
        "RI",
        t_style,
    )
    worksheet.write_string(current_row + 1, table_first_col + 5, "Yes/No", b_style)
    worksheet.write_string(
        current_row + 1,
        table_first_col + 6,
        "Type of Immunization Sessions (F5, OS1, OS2, etc.)",
        b_style,
    )

    worksheet.write_string(
        current_row,
        table_first_col + 7,
        "ANC",
        t_style,
    )
    worksheet.write_string(
        current_row,
        table_first_col + 8,
        "Labour & Delivery",
        t_style,
    )
    worksheet.write_string(
        current_row,
        table_first_col + 9,
        "Family Planning",
        t_style,
    )

    for col_offset in range(7, 10):
        worksheet.write_string(
            current_row + 1,
            table_first_col + col_offset,
            "Yes/No",
            b_style,
        )


async def fetch_row_data(
    conn: PoolConn,
    fixed_post_record: Record,
) -> List[Record]:
    """
    Return the excel data rows
    Note if a particular settlement may have the distance entry in many columns
    if it is in the fixed post, outreach, and mobile

    The RI is always yes, since only RI fps have rew sheets
    anc/labor/family depend on the FP, so will always be the same

    query returns rows as expected in the excel

    mobile rows depend on the boundary, so will be the same for all fps in the boundary
    """
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

    sql = (
        SQL("""   
WITH ci AS (
    SELECT DISTINCT ON (p_ci.global_id) *
    FROM partitions.ri_catchment_item p_ci
    WHERE p_ci.boundary_polygon IN ({b_list})
    ORDER BY p_ci.global_id, p_ci.version_id DESC
),
sp AS (
    SELECT DISTINCT ON (p_sp.global_id) *
    FROM {p_sp} p_sp
    WHERE p_sp.boundary_polygon IN ({b_list})
    ORDER BY p_sp.global_id, p_sp.version_id DESC
),
sn AS (
    SELECT DISTINCT ON (p_sn.global_id) *
    FROM {p_sn} p_sn
    WHERE p_sn.boundary_polygon IN ({b_list})
    ORDER BY p_sn.global_id, p_sn.version_id DESC
),
sn_coverage_perc AS (
	SELECT 
	    sn0.global_id AS sn_global_id, 
	    sp0.global_id AS sp_global_id, 
	    COALESCE(SUM(ci0.population_perc), 0) AS total_perc
	FROM sn sn0    	
	INNER JOIN sp sp0
    	ON sn0.settlement_part = sp0.global_id
    LEFT JOIN ci AS ci0
        ON ci0.settlement_part = sp0.global_id
            AND NOT ci0.is_deleted
            AND ci0.TYPE = 'generated'  
    WHERE sn0.boundary_polygon = {hf_boundary}            
      AND NOT sp0.is_deleted
      AND NOT sn0.is_deleted
      AND sn0.is_primary      
  GROUP BY sn0.global_id, sp0.global_id
)
SELECT 
    --collapse rows so max 1 row per settlement
    sq.name,
    --nulls removed 
    MIN(sq.fp_dist) AS fp_dist, 
    MIN(sq.outreach_dist) AS outreach_dist, 
    MIN(sq.mobile_dist) AS mobile_dist, 
    MIN(sq.ri) AS ri, 
    MIN(sq.type) AS type, 
    --min not ok with bool, bool_or removes nulls
    BOOL_OR(sq.anc) AS anc, 
    BOOL_OR(sq.ld) AS ld, 
    BOOL_OR(sq.fam_plan) AS fam_plan, 
    --Not in xls, but want 1 row per settlement, even if same name
    sq.sn_global_id
 FROM (
    --fixed post
    SELECT 
        sn1.name,
        
        ST_Distance(fp1.geom::geography, sn1.geom::geography) / 1000 AS fp_dist,
        NULL::DOUBLE PRECISION as outreach_dist,
        NULL::DOUBLE PRECISION as mobile_dist,
        
        'Yes' AS ri, 
        '' as "type",
        
        'Antenatal Care' = ANY(fp1.services) AS anc,
        'Delivery' = ANY(fp1.services) AS ld,
        'Family Planning' = ANY(fp1.services) AS fam_plan,
        
        sn1.global_id AS sn_global_id
    FROM {hf} fp1
    INNER JOIN ci AS ci1
        ON ci1.health_facility_point = fp1.global_id
    INNER JOIN sp sp1 ON ci1.settlement_part = sp1.global_id
    INNER JOIN sn sn1 ON sn1.settlement_part = sp1.global_id
    WHERE fp1.global_id = {hf_guid}
      AND NOT ci1.is_deleted
      AND NOT fp1.is_deleted      
      AND NOT sp1.is_deleted
      AND NOT sn1.is_deleted
      AND fp1.TYPE = 'fixed_post'
      AND NOT COALESCE(sn1.uninhabited, False)
      AND sn1.is_primary
      
    UNION ALL
    
    --outreach
    SELECT 
        sn2.name,
        
        NULL::DOUBLE PRECISION as fp_dist,
        -- client side used polygon distance with fp but better to use sn <=> fp distance
        MIN(ST_Distance(fp2.geom::geography, sn2.geom::geography) / 1000) AS outreach_dist,
        NULL::DOUBLE PRECISION as mobile_dist,
        
        'Yes' AS ri, 
        '' as "type",
        
        'Antenatal Care' = ANY(fp2.services) AS anc,
        'Delivery' = ANY(fp2.services) AS ld,
        'Family Planning' = ANY(fp2.services) AS fam_plan,
        
        sn2.global_id AS sn_global_id
    FROM {hf} fp2
    INNER JOIN {hf} or2
        ON or2.parent = fp2.global_id
    INNER JOIN ci AS ci2
        ON ci2.health_facility_point = or2.global_id
    INNER JOIN sp sp2 ON ci2.settlement_part = sp2.global_id
    INNER JOIN sn sn2 ON sn2.settlement_part = sp2.global_id
    WHERE fp2.global_id = {hf_guid}
      AND NOT ci2.is_deleted
      AND NOT fp2.is_deleted
      AND NOT or2.is_deleted
      AND NOT sp2.is_deleted
      AND NOT sn2.is_deleted
      AND or2.TYPE = 'outreach'
      AND fp2.TYPE = 'fixed_post'
      AND NOT COALESCE(sn2.uninhabited, False)
      AND sn2.is_primary
    GROUP BY sn2.global_id, sn2.name, fp2.services
      
  UNION ALL 
  
  --for mobile we need to have all settlements whose total coverage 
  
    SELECT 
        sn3.name,
        
        NULL::DOUBLE PRECISION as fp_dist,
        NULL::DOUBLE PRECISION as outreach_dist,
        ST_Distance(fp3.geom::geography, sn3.geom::geography) / 1000 AS mobile_dist,
        
        'Yes' AS ri, 
        '' as "type",
        
        'Antenatal Care' = ANY(fp3.services) AS anc,
        'Delivery' = ANY(fp3.services) AS ld,
        'Family Planning' = ANY(fp3.services) AS fam_plan,
        
        sn3.global_id AS sn_global_id
    FROM {hf} fp3,
    sn_coverage_perc scp3 
    INNER JOIN sp sp3 ON sp3.global_id = scp3.sp_global_id
    INNER JOIN sn sn3 ON sn3.global_id = scp3.sn_global_id
    --All settlements to consider but only in same boundary, not the surrounding area
    WHERE fp3.global_id = {hf_guid}
        AND fp3.TYPE = 'fixed_post'    
        AND NOT COALESCE(sn3.uninhabited, FALSE)
        --more than 0.5 population either estimated or computed is enough
        --to be considered uncovered
        AND ( 
            (100 - scp3.total_perc)/100 * COALESCE(sn3.estimated_pop, 0) >= 0.5 
            OR 
            (100 - scp3.total_perc)/100 * sp3.computed_pop >= 0.5
        )
        AND NOT COALESCE(sn3.uninhabited, False)
        AND sn3.is_primary
) sq
GROUP BY sq.name, sq.sn_global_id
ORDER BY sq.name
;
""")
        .format(
            p_ci=GeneralDbNames.PARTITION_BASE_CI.as_identifier(),
            p_sp=GeneralDbNames.PARTITION_BASE_SP.as_identifier(),
            p_sn=GeneralDbNames.PARTITION_BASE_SN.as_identifier(),
            hf=GeneralDbNames.SCHEMA_HF.get_table_as_identifier(partition_id, True),
            hf_boundary=SqlLiteral(hf_boundary),
            b_list=b_list,
            hf_guid=SqlLiteral(hf_guid),
        )
        .as_string()
    )

    # if hf_guid == uuid.UUID("bf1b4e54-bdb1-4cdb-b00d-e1e04d4b5992"):
    #     log.debug(sql)
    rows = await fetch_log(conn, sql)

    return rows
