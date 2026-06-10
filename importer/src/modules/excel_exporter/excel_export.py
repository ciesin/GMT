import asyncio
from dataclasses import dataclass
from typing import List, Dict, Union, Optional

import xlsxwriter  # type: ignore
from pathlib import Path
from lib import file_utils
from lib.async_db_utils import drop_schema, ConnType
from lib.logger_utils import get_logger
from modules.excel_exporter.constants import (
    SheetNames,
    HeaderNames,
    MypyExcelFormat,
    MypyWorksheet,
)
from modules.excel_exporter.hf_catchments_sheet import (
    create_excel_sheet_params,
    ExcelSheetParams,
    get_hf_catchment_query,
)
from modules.excel_exporter.views import (
    create_catchments_view,
    create_mobile_settlements_view,
    create_mobile_summary_view,
    create_hf_summary_view,
    create_fp_summary_view,
)
from modules.excel_exporter.sheet_data import (
    sheet_hfs_data,
    sheet_settlement_data,
    sheet_boundary_data,
    sheet_catchments_data,
    create_indexes,
)
from modules.exporter_shared.consolidated_data.populate import add_settlements, add_hf
from modules.exporter_shared.consolidated_data.tables import (
    create_settlement_table,
    create_hf_tables,
)

from modules.exporter_shared.gmt_db_objects import ExportDbNames
from modules.exporter_shared.operating_boundaries import (
    get_operating_boundaries,
    create_boundary_table,
    OperatingBoundary,
)
from modules.exporter_shared.raw_data.rd_import import import_raw_data
from modules.params.flask_root_params import (
    ExportExcelParams,
)

log = get_logger(__name__)

"""
Updates all the state exports if there was a change
"""


def run_excel_export(params: ExportExcelParams) -> None:
    return asyncio.run(excel_export(params))


def run_excel_export_per_boundary(params: ExportExcelParams) -> None:
    return asyncio.run(excel_export_per_boundary(params))


async def excel_export_per_boundary(params: ExportExcelParams) -> None:
    # as the excel could have a state, we need all specifically targetted boundaries
    # at the operating level (e.g. ward)
    async with params.gmt_db.get_asyncpg_connection() as conn:
        op_boundaries = await get_operating_boundaries(conn, params.boundary_guid_list)

    for boundary in op_boundaries:
        if boundary.is_surrounding:
            continue

        await excel_export(
            ExportExcelParams(
                export_name=params.export_name,
                gmt_db=params.gmt_db,
                user_id=params.user_id,
                boundary_guid_list=[boundary.global_id],
                output_sub_path=Path(boundary.hierarchy_names[1])
                / boundary.hierarchy_names[0],
            )
        )


async def excel_export(params: ExportExcelParams) -> None:
    log.info(f"Starting export of {params.boundary_guid_list} boundaries")

    async with params.gmt_db.get_asyncpg_connection() as conn:
        op_boundaries = await get_operating_boundaries(conn, params.boundary_guid_list)

        directly_targeted_boundaries: List[OperatingBoundary] = [
            b for b in op_boundaries if not b.is_surrounding
        ]

        # for op_b in op_boundaries:
        #     print(op_b)

        if True:
            await drop_schema(conn, ExportDbNames.TEMP_SCHEMA, cascade=True)

            await import_raw_data(conn, op_boundaries)

            await create_boundary_table(conn, op_boundaries)

            await create_hf_tables(conn)

            await add_hf(conn)

            await create_settlement_table(conn)

            await add_settlements(conn)

        # all views for the hf_catchments sheet
        await create_catchments_view(conn)
        await create_mobile_settlements_view(conn)
        await create_mobile_summary_view(conn)
        await create_hf_summary_view(conn)
        await create_fp_summary_view(conn)

        sheet_path = params.excel_path

        sheet_path.parent.mkdir(parents=True, exist_ok=True)

        file_utils.remove_file(sheet_path)

        workbook = xlsxwriter.Workbook(sheet_path, {"constant_memory": True})

        await create_indexes(conn)

        excel_sheet_params = await create_excel_sheet_params(conn)
        excel_formats = create_formats(workbook)

        # boundary sheet
        sql = sheet_boundary_data()
        await write_excel_table_sheet(
            workbook, sql, conn, SheetNames.OVERVIEW, excel_sheet_params, excel_formats
        )

        # GMT - HFs sheet
        sql = sheet_hfs_data(excel_sheet_params)
        await write_excel_table_sheet(
            workbook, sql, conn, SheetNames.HF, excel_sheet_params, excel_formats
        )

        # GMT - STLs sheet
        sql = sheet_settlement_data(excel_sheet_params)
        await write_excel_table_sheet(
            workbook, sql, conn, SheetNames.STL, excel_sheet_params, excel_formats
        )

        # GMT - Catchments sheet
        sql = sheet_catchments_data()
        await write_excel_table_sheet(
            workbook, sql, conn, SheetNames.CI, excel_sheet_params, excel_formats
        )

        # HF_catchments sheet
        sql = get_hf_catchment_query(excel_sheet_params)

        # Title, if we have say less than 5, we'll list them
        hf_catchment_sheet_title = "Microplan for Multiple Wards"
        if len(directly_targeted_boundaries) > 0 and len(directly_targeted_boundaries) <= 5:
            ward_labels = []
            for tb in directly_targeted_boundaries:
                ward_labels.append( f"{tb.hierarchy_names[2]}/{tb.hierarchy_names[1]}/{tb.hierarchy_names[0]}")
            hf_catchment_sheet_title = "Microplan for Ward " + ", ".join(ward_labels)
        await write_excel_table_sheet(
            workbook,
            sql,
            conn,
            SheetNames.HF_CATCHMENTS,
            excel_sheet_params,
            excel_formats,
            hf_catchment_sheet_title
        )

        workbook.close()

        log.info(f"Finished writing excel to {sheet_path}")


# Unclear Any mypy errors
@dataclass
class WorkbookFormats:
    int_format: MypyExcelFormat
    one_decimal_format: MypyExcelFormat
    three_decimal_format: MypyExcelFormat
    default_format: Union[MypyExcelFormat, None]
    header_fmt: MypyExcelFormat
    rew_header_fmt: MypyExcelFormat

    # hf catchment styles
    all_format: MypyExcelFormat
    fp_format: MypyExcelFormat
    outreach_format: MypyExcelFormat
    mobile_format: MypyExcelFormat

    # 3 decimal forms, since we cannot dynamically combine formats
    # and we need decimal + background
    all_format_3d: MypyExcelFormat
    fp_format_3d: MypyExcelFormat
    outreach_format_3d: MypyExcelFormat

    hf_catchment_title: MypyExcelFormat


def create_formats(
    workbook: xlsxwriter.Workbook,
) -> WorkbookFormats:
    int_format = workbook.add_format({"num_format": "0"})  # Nearest integer
    three_decimal_format = workbook.add_format(
        {"num_format": "0.000"}
    )  # 3 decimal places
    one_decimal_format = workbook.add_format({"num_format": "0.0"})  # 3 decimal places

    default_format = None  # workbook.add_format({ "bottom": 1})

    all_bg_color = "#B4C6E7"
    fp_bg_color = "#548235"
    outreach_bg_color = "#A9D08E"

    # hf_catchment formats; note some have numbers which are usually rounded to nearest int
    all_format = workbook.add_format(
        {"bg_color": all_bg_color, "pattern": 1, "num_format": "0"}
    )
    fp_format = workbook.add_format(
        {"bg_color": fp_bg_color, "pattern": 1, "num_format": "0"}
    )
    mobile_format = workbook.add_format(
        {"bg_color": "#E2EFDA", "pattern": 1, "num_format": "0"}
    )
    outreach_format = workbook.add_format(
        {"bg_color": outreach_bg_color, "pattern": 1, "num_format": "0"}
    )

    all_format_3d = workbook.add_format(
        {"bg_color": all_bg_color, "pattern": 1, "num_format": "0.000"}
    )
    fp_format_3d = workbook.add_format(
        {"bg_color": fp_bg_color, "pattern": 1, "num_format": "0.000"}
    )
    outreach_format_3d = workbook.add_format(
        {"bg_color": outreach_bg_color, "pattern": 1, "num_format": "0.000"}
    )

    header_fmt = workbook.add_format(
        {
            "bold": True,
            "bg_color": "#4F81BD",  # Dark blue
            "font_color": "#FFFFFF",  # White text
            "border": 1,
        }
    )
    rew_header_fmt = workbook.add_format(
        {
            "bold": True,
            "bg_color": "#B7B7B7",
            "font_color": "#FFFFFF",  # White text
            "border": 1,
        }
    )

    hf_catchment_title = workbook.add_format()
    hf_catchment_title.set_bold()
    hf_catchment_title.set_font_size(18)

    return WorkbookFormats(
        int_format=int_format,
        three_decimal_format=three_decimal_format,
        one_decimal_format=one_decimal_format,
        default_format=default_format,
        all_format=all_format,
        fp_format=fp_format,
        outreach_format=outreach_format,
        mobile_format=mobile_format,
        header_fmt=header_fmt,
        rew_header_fmt=rew_header_fmt,
        fp_format_3d=fp_format_3d,
        outreach_format_3d=outreach_format_3d,
        all_format_3d=all_format_3d,
        hf_catchment_title=hf_catchment_title,
    )


async def write_excel_table_sheet(
    workbook: xlsxwriter.Workbook,
    sql: str,
    conn: ConnType,
    sheet_name: SheetNames,
    excel_sheet_params: ExcelSheetParams,
    excel_formats: WorkbookFormats,
    hf_catchment_sheet_title: Optional[str] = None,
) -> None:
    # Create a workbook and add a worksheet

    worksheet: MypyWorksheet = workbook.add_worksheet(sheet_name)

    # characters
    MAX_COL_WIDTH = 30

    starting_row = 0
    if sheet_name == SheetNames.STL:
        starting_row = 1
    elif sheet_name == SheetNames.HF_CATCHMENTS:
        starting_row = 5

        worksheet.write_string(
            1,
            1,
            hf_catchment_sheet_title,
            excel_formats.hf_catchment_title,
        )

    stmt = await conn.prepare(sql)
    col_names: List[str] = []

    # Track max width per column
    max_widths = [0] * len(col_names)

    col_int_to_format: Dict[int, MypyExcelFormat] = {}

    async with conn.transaction():
        record_index = 0
        async for record in stmt.cursor(prefetch=50):
            # 1st record
            if len(col_names) == 0:

                col_names = [col for col in record.keys()]

                write_header_row(
                    sheet_name,
                    excel_sheet_params,
                    excel_formats,
                    worksheet,
                    col_names,
                    starting_row,
                    col_int_to_format,
                )

                max_widths = [10] * len(col_names)


            for col_index in range(0, len(record)):
                value = record[col_index]
                cell_format = col_int_to_format.get(
                    col_index, excel_formats.default_format
                )

                if col_index == 0 and sheet_name == SheetNames.HF_CATCHMENTS:
                    value = record_index

                # HF_catchment agg. row colours
                if sheet_name == SheetNames.HF_CATCHMENTS:
                    hf_order = record[0]
                    if hf_order == 1:
                        if cell_format == excel_formats.three_decimal_format:
                            cell_format = excel_formats.all_format_3d
                        else:
                            cell_format = excel_formats.all_format
                    elif hf_order == 2:
                        # outreach or fixed post
                        if record["Fixed/Outreach/Mobile  (GMT)"] == "Fixed Post":
                            if cell_format == excel_formats.three_decimal_format:
                                cell_format = excel_formats.fp_format_3d
                            else:
                                cell_format = excel_formats.fp_format
                        else:
                            cell_format = excel_formats.outreach_format
                    elif hf_order == 4:
                        cell_format = excel_formats.mobile_format

                worksheet.write(
                    starting_row + 1 + record_index,
                    col_index,
                    value,
                    cell_format,
                )
                max_widths[col_index] = max(max_widths[col_index], len(str(value)))

            record_index += 1

    worksheet.autofilter(
        starting_row,
        0,
        # record_index now is number of records
        starting_row + record_index,
        len(col_names) - 1,
    )



    # column_defs: List[Dict[str, Optional[str | int | bool]]] = []

    for col_idx, name in enumerate(col_names):
        max_widths[col_idx] = max(max_widths[col_idx], len(str(name)))
        max_widths[col_idx] = min(max_widths[col_idx], MAX_COL_WIDTH)
        # column_defs.append({"header": name, "format": int_format})

        # max_widths[col_idx] = 10

        # if sheet_name == SheetNames.OVERVIEW:
        #     if HeaderNames.POP_GIS == name:
        #         column_defs[-1]["total_function"] = "sum"
        #     if col_idx == 0:
        #         column_defs[-1]["total_string"] = "Total"

    for col_idx, width in enumerate(max_widths):
        worksheet.set_column(col_idx, col_idx, width + 2)  # +2 for padding


def write_header_row(
    sheet_name: SheetNames,
    excel_sheet_params: ExcelSheetParams,
    excel_formats: WorkbookFormats,
    worksheet: MypyWorksheet,
    col_names: List[str],
    starting_row: int,
    col_int_to_format: Dict[int, MypyExcelFormat],
) -> None:
    if sheet_name == SheetNames.STL:
        # note this fails if we try to do this after adding the data
        stl_sheet_headers(worksheet, col_names, excel_sheet_params, excel_formats)

    for col_index, col_label in enumerate(col_names):
        worksheet.write(
            starting_row,
            col_index,
            col_label,
            excel_formats.header_fmt
            if "REW" not in col_label
            else excel_formats.rew_header_fmt,
        )

        if "%" in col_label:
            col_int_to_format[col_index] = excel_formats.one_decimal_format
        elif (
            "total" in col_label.lower()
            or col_label == HeaderNames.POP_GIS
            or "population" in col_label.lower()
            or "POP" in col_label
            or "distance" in col_label.lower()
        ):
            col_int_to_format[col_index] = excel_formats.int_format
        elif "latitude" in col_label.lower() or "longitude" in col_label.lower():
            col_int_to_format[col_index] = excel_formats.three_decimal_format


def stl_sheet_headers(
    worksheet: MypyWorksheet,
    set_cols: List[str],
    params: ExcelSheetParams,
    excel_formats: WorkbookFormats,
) -> None:
    # initialize to one before special attention
    span_start_col = len(set_cols) - len(params.special_attention)
    # write spans

    ret = worksheet.merge_range(
        0,
        span_start_col,
        0,
        span_start_col + len(params.special_attention) - 1,
        "SPECIAL ATTENTION",
    )
    if ret != 0:
        log.warning(
            f"Merging range failed {span_start_col} to {span_start_col + len(params.special_attention)} ret: [{ret}]"
        )

    span_start_col -= (
        len(params.uninhabited_reasons) + 1
    )  # we have an extra uninhabited reason

    ret = worksheet.merge_range(
        0,
        span_start_col,
        0,
        span_start_col
        + len(params.uninhabited_reasons),  # added 1 for uninhabited reason,
        "UNINHABITED",
    )
    if ret != 0:
        log.warning(
            f"Merge range failed ran {span_start_col} to {span_start_col + len(params.uninhabited_reasons)} ret: [{ret}]"
        )

    worksheet.merge_range(
        0,
        set_cols.index("POP GIS"),
        0,
        set_cols.index("POP GIS") + 2,
        "POPULATION TOTAL",
    )
