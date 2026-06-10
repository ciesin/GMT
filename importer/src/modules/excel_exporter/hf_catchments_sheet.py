from dataclasses import dataclass
from typing import List

from psycopg.sql import SQL, Identifier

from lib.async_db_utils import ConnType, get_enum_values
from modules.excel_exporter.views import get_boundary_headers
from modules.exporter_shared.gmt_db_objects import ExportDbNames


# used internally
@dataclass
class ExcelSheetParams:
    # Level 1 label, level 2 label, excluding level 0, eg. State, Lga, Ward; prefixed with HF
    hf_boundary_labels: List[str]
    # same prefixed with settlement
    stl_boundary_labels: List[str]
    # enum values for uninhabited
    uninhabited_reasons: List[str]
    # enum values for special attention
    special_attention: List[str]
    # enum values
    services: List[str]


async def create_excel_sheet_params(conn: ConnType) -> ExcelSheetParams:
    hf_boundary_labels = get_boundary_headers("HF ")[1:]
    stl_boundary_labels = get_boundary_headers("Settlement ")[1:]

    uninhabited_reasons = await get_enum_values(
        conn, "sn_uninhabited_reason", ExportDbNames.TEMP_SCHEMA
    )
    special_attention = await get_enum_values(
        conn, "sn_problematic", ExportDbNames.TEMP_SCHEMA
    )
    services = await get_enum_values(conn, "hf_services", ExportDbNames.TEMP_SCHEMA)
    params = ExcelSheetParams(
        hf_boundary_labels=hf_boundary_labels,
        stl_boundary_labels=stl_boundary_labels,
        uninhabited_reasons=uninhabited_reasons,
        special_attention=special_attention,
        services=services,
    )
    return params


def get_hf_catchment_query(params: ExcelSheetParams) -> str:
    col_list = SQL("""
            "HF Name", {hf_boundary_labels}, "Health Facility REW", 
            "Latitude", "Longitude", "Alternative Names HF", "Ownership", 
            "Type", "Primary Type", "Village/Settlement Name", "ALT Village/Settlement Name", 
            "Latitude (Settlement)", "Longitude (Settlement)", 
           {stl_boundary_labels}, "Settlement In HF Ward?", 
            "Village/Settlement (REW)", "Operational settlement name (REW)", 
            "Primary Settlement (REW)", "Settlement Type (Urban/ Rural) (REW)", "Fixed/Outreach/Mobile (REW)", 
            "Immunization Sessions (FS, OS1, OS2, etc.) (REW)", "Fixed/Outreach/Mobile  (GMT)", 
            "Outreach Site Name (GMT)", "Days of Routine Immunization (fixed post)", 
            "Days of Routine Immunization (fixed post) (REW)", "Transport", "Frequency of outreach sessions",
             "POP GIS", "ESTIMATED POP (Entered in GMT)", "POP DIFF", "Total Population (REW)",
              "Catchment Population Total (GIS POP)", "Catchment Population Total (EST POP)", 
              "Catchment Population Total (EST POP + GIS where EST POP is miss", "Catchment Population Total (REW)", 
              "Catchment Population Inside HF Ward", "Catchment Population Outside HF Ward", 
              "% of Settlement Population Assigned To HF", "Distance Settlement HF (m)", 
              "Distance HF OutreachSite (m)", 
              {uninhabited_labels}, 
              {special_attention_labels}
            """).format(
        hf_boundary_labels=SQL(", ").join(
            [Identifier(s) for s in params.hf_boundary_labels]
        ),
        stl_boundary_labels=SQL(", ").join(
            [Identifier(s) for s in params.stl_boundary_labels]
        ),
        uninhabited_labels=SQL(", ").join(
            [Identifier(f"Uninhabited - {s}") for s in params.uninhabited_reasons]
        ),
        special_attention_labels=SQL(", ").join(
            [Identifier(s) for s in params.special_attention]
        ),
    )

    sql = SQL(""" 
    SELECT 
        --value not displayed, but used to colour code
        --Index calculated via python
        hf_order as "Index", 
        --rest of columns
        {col_list}
    FROM (
        SELECT 0 AS b_order, 1 AS hf_order, 
            {col_list} 
        FROM {fs}
        UNION ALL 
        SELECT 0 AS b_order, 2 AS hf_order, 
            {col_list}  
        FROM {hs}
        UNION ALL 
        SELECT 0 AS b_order, 3 AS hf_order, {col_list}  
        FROM {cs}
        UNION ALL 
        SELECT 1 AS b_order, 4 AS hf_order, {col_list} 
        FROM {msum}
        UNION ALL 
        SELECT 1 AS b_order, 5 AS hf_order, {col_list}
        FROM {ms}
    ) sq 
    --WHERE "HF Ward" = 'Shagogo'
    ORDER BY 
        "HF Ward", 
        b_order, 
        "HF Name", 
        "Outreach Site Name (GMT)" NULLS FIRST, 
        hf_order, 
        lower("Village/Settlement Name")
         """).format(
        col_list=col_list,
        fs=ExportDbNames.FP_SUMMARY.as_identifier(),
        hs=ExportDbNames.HF_SUMMARY.as_identifier(),
        cs=ExportDbNames.COVERED_SETTLEMENTS.as_identifier(),
        msum=ExportDbNames.MOBILE_SUMMARY.as_identifier(),
        ms=ExportDbNames.MOBILE_SETTLEMENTS.as_identifier(),
    )

    return sql.as_string()
