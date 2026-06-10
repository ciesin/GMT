import os
from typing import List

from psycopg.sql import SQL, Identifier, Literal as SqlLiteral, Composed

from lib.async_db_utils import ConnType, create_index
from lib.logger_utils import get_logger
from modules.excel_exporter.constants import HeaderNames
from modules.excel_exporter.hf_catchments_sheet import ExcelSheetParams
from modules.excel_exporter.views import (
    get_frequency_sql,
    get_boundary_headers,
)
from modules.exporter_shared.gmt_db_objects import ExportDbNames, GeneralDbNames

log = get_logger(__name__)


async def create_indexes(conn: ConnType) -> None:
    await create_index(
        conn, ExportDbNames.RAW_CI.with_column_name("settlement_part"), is_geom=False
    )
    await create_index(
        conn,
        ExportDbNames.RAW_CI.with_column_name("health_facility_point"),
        is_geom=False,
    )


def sheet_hfs_data(params: ExcelSheetParams) -> str:
    # Query data

    services_sql = SQL(", ").join(
        [
            SQL("""({} = ANY(r.services)) AS {}""").format(SqlLiteral(s), Identifier(s))
            for s in params.services
        ]
    )

    sql = (
        SQL("""
    SELECT 
        h.name as "HF Name",
        array_to_string(r.synonyms, ', ') AS "HF Alternate Names",
        h.comments as "HF Comments",        
        h.lat_y as "HF Latitude",
        h.lon_x as "HF Longitude",
        r.set_with_gps as "HF Set With GPS",
        h.state_name as "HF State",
        h.lga_name as "HF LGA",
        h.ward_name as "HF Ward",
        ('Routine Immunization' = ANY(r.services)) AS "RI Strategy",
        h.num_settlements AS "Total STL Fixed",
        COALESCE(SUM(outreach.num_settlements), 0) AS "Total STL OUTREACH",
        h.gis_catchment_pop + COALESCE(SUM(outreach.gis_catchment_pop), 0) AS "Total Catchment (GIS)",
        h.estimated_catchment_pop + COALESCE(SUM(outreach.estimated_catchment_pop), 0) AS "Total Catchment (EST)",
        h.estimated_gis_catchment_pop + COALESCE(SUM(outreach.estimated_gis_catchment_pop), 0) AS "Total Catchment (EST+GIS where no EST)",

        h.gis_catchment_pop AS "Total FIXED (GIS)",
        COALESCE(SUM(outreach.gis_catchment_pop), 0) AS "Total OUTREACH (GIS)",

        h.estimated_catchment_pop AS "Total FIXED (EST)",
        COALESCE(SUM(outreach.estimated_catchment_pop), 0) AS "Total OUTREACH (EST)",

        h.estimated_gis_catchment_pop AS "Total FIXED (EST+GIS where no EST)",
        COALESCE(SUM(outreach.estimated_gis_catchment_pop), 0) AS "Total OUTREACH (EST+GIS where no EST)",

        h.mp_status as "MP Status",
        h.ownership	as "Ownership", 
        h.level_of_care as "Type",
        h.primary_type as "Primary Type",
        {services_sql}

    FROM {h} h 
    INNER JOIN {raw_hf} r ON r.global_id = h.hf_global_id
    LEFT JOIN {h} outreach ON outreach.fixed_post_parent_global_id = h.hf_global_id
    WHERE r.type = 'fixed_post'
    GROUP BY h.hf_global_id, r.global_id
    ORDER BY h.state_name, h.lga_name, h.ward_name, h.name
    """)
        .format(
            h=ExportDbNames.HF.as_identifier(),
            raw_hf=ExportDbNames.RAW_HF.as_identifier(),
            services_sql=services_sql,
        )
        .as_string()
    )

    return sql


def sheet_settlement_data(
    params: ExcelSheetParams,
) -> str:
    uninhabited_reasons_sql = SQL(", ").join(
        [
            SQL("""{} = r_sn.uninhabited_reason AS {}""").format(
                SqlLiteral(s), Identifier(s)
            )
            for s in params.uninhabited_reasons
        ]
    )

    # to dedup header names
    special_attention_sql_list = []
    for s in params.special_attention:
        sql_s = SQL("""({} = ANY(r_sn.problematic)) AS {}""")
        col_name = s
        if s in ("Other", "Unknown"):
            col_name = f"Reason {s}"
        special_attention_sql_list.append(
            sql_s.format(SqlLiteral(s), Identifier(col_name))
        )
    special_attention_sql = SQL(", ").join(special_attention_sql_list)

    sql = (
        SQL("""
        SELECT 
            s.name as "Name",
            array_to_string(r_sn.synonyms, ', ') AS "Alternate Names",
            s.comments as "Comments",        
            s.lat_y as "STL Latitude",
            s.lon_x as "STL Longitude",
            r_sn.set_with_gps as "STL Set With GPS",
            s.state_name as "STL State",
            s.lga_name as "STL LGA",
            s.ward_name as "STL Ward",
            ST_Intersects(b.geom, r_sn.geom) AS "STL in ward", 
            
            EXISTS (
                SELECT 1 FROM {raw_ci} r_ci
                INNER JOIN {raw_hf} r_hf ON r_hf.global_id = r_ci.health_facility_point
                WHERE r_ci.settlement_part = r_sn.settlement_part
                AND r_ci.type != 'exclude'
                AND r_hf.boundary_polygon = r_sn.boundary_polygon
            ) AS "Part of HF catchment of this ward",
            EXISTS (
                SELECT 1 FROM {raw_ci} r_ci                
                WHERE r_ci.settlement_part = r_sn.settlement_part
                AND r_ci.type = 'exclude'
            ) AS "Excluded from a catchment",
            s.computed_pop AS "POP GIS",
            s.estimated_pop AS "POP EST",
            COALESCE(s.computed_pop, 0) - COALESCE(s.estimated_pop, 0) AS "POP DIFF",
            (r_sn.properties->'marked_for_review')::bool as "Marked for pop. review",
            s.uninhabited_reason as "Uninhabited Reason", 
            {uninhabited_reasons_sql},
            {special_attention_sql}
            					   
        FROM {s} s 
        INNER JOIN {raw_sn} r_sn 
            ON r_sn.global_id = s.global_id
        -- INNER JOIN {raw_sp} r_sp
        --     ON r_sp.global_id = s.global_id
        INNER JOIN {boundary} b 
            ON b.global_id = r_sn.boundary_polygon        
        ORDER BY s.state_name, s.lga_name, s.ward_name, s.name
        """)
        .format(
            s=ExportDbNames.SET.as_identifier(),
            boundary=GeneralDbNames.BOUNDARY_POLYGON_LATEST.as_identifier(),
            raw_sn=ExportDbNames.RAW_SN.as_identifier(),
            raw_sp=ExportDbNames.RAW_SP.as_identifier(),
            raw_ci=ExportDbNames.RAW_CI.as_identifier(),
            raw_hf=ExportDbNames.RAW_HF.as_identifier(),
            uninhabited_reasons_sql=uninhabited_reasons_sql,
            special_attention_sql=special_attention_sql,
        )
        .as_string()
    )

    return sql


def sheet_boundary_data() -> str:
    labels = [s.strip() for s in os.environ["BOUNDARY_LEVEL_LABELS"].split("|")]
    boundary_operating_level = int(os.environ["OPERATIONAL_BOUNDARY_LEVEL"])
    labels_sql_list: List[Composed] = []
    order_by_sql_list: List[Composed] = []

    for level, label in enumerate(labels):
        # array is in reverse order, postgres arrays start at 1
        array_position = boundary_operating_level + 1 - level
        labels_sql_list.append(
            SQL("e_b.hierarchy_names[{}] AS {}").format(
                SqlLiteral(array_position), Identifier(label)
            )
        )
        order_by_sql_list.append(
            SQL("e_b.hierarchy_names[{}]").format(SqlLiteral(array_position))
        )

    sql = (
        SQL("""
    SELECT 
{labels_sql},
b.computed_pop AS {pop_gis} 
FROM {e_boundary} e_b 
INNER JOIN {boundary} b 
	ON b.global_id = e_b.global_id 
WHERE b.LEVEL = {op_level} AND NOT e_b.is_surrounding 
ORDER BY {order_by_sql}
        """)
        .format(
            op_level=SqlLiteral(boundary_operating_level),
            boundary=GeneralDbNames.BOUNDARY_POLYGON_LATEST.as_identifier(),
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
            order_by_sql=SQL(", ").join(order_by_sql_list),
            labels_sql=SQL(", ").join(labels_sql_list),
            pop_gis=Identifier(HeaderNames.POP_GIS),
        )
        .as_string()
    )

    return sql


def sheet_catchments_data() -> str:
    labels = [s.strip() for s in os.environ["BOUNDARY_LEVEL_LABELS"].split("|")]
    boundary_operating_level = int(os.environ["OPERATIONAL_BOUNDARY_LEVEL"])
    op_boundary_label = labels[boundary_operating_level]

    order_by_sql_list: List[Composed] = []

    for level, label in enumerate(labels):
        # array is in reverse order, postgres arrays start at 1
        array_position = boundary_operating_level + 1 - level

        order_by_sql_list.append(
            SQL("hierarchy_names[{}]").format(SqlLiteral(array_position))
        )

    sql = (
        SQL("""
--We are sorting by hidden columns (the state/lga/ward) so we need to select again
SELECT
    "HF Name",
    "RI Strategy",
    "Outreach Site Name",
    "Schedule",
    "Settlement Name",
    {set_ward_header},
    "Catchment Population (GIS)",
    "Catchment Population (EST)",
    "Catchment Population (EST+GIS where no EST)",
    "Catchment Population Inside HF Ward",
    "Catchment Population Outside HF Ward",
    "% of Settlement Population Assigned To HF",
    "Distance Settlement HF (m)",
    "Distance HF OutreachSite (m)"
FROM        
(
    --to sort the union all by hidden hierarchy name fields
    SELECT * FROM
    (
        (
        SELECT 
            COALESCE(r_hf_parent.name, r_hf.name) as "HF Name",
            r_hf.type::text as "RI Strategy",
            CASE WHEN r_hf.type = 'outreach' THEN r_hf.name
            ELSE null END AS "Outreach Site Name",            
            {frequency_sql} as "Schedule",
            r_sn.name as "Settlement Name",
            e_b_sp.hierarchy_names[1] AS {set_ward_header},
            r_sp.computed_pop * r_ci.population_perc / 100 as "Catchment Population (GIS)",
            r_sn.estimated_pop  * r_ci.population_perc / 100 as "Catchment Population (EST)",
            COALESCE(r_sn.estimated_pop, r_sp.computed_pop)  * r_ci.population_perc / 100 AS "Catchment Population (EST+GIS where no EST)",
            CASE WHEN r_sp.boundary_polygon = r_hf.boundary_polygon THEN 
                 r_sp.computed_pop  * r_ci.population_perc / 100
            ELSE
                NULL 
            END AS {inside_header},
            CASE WHEN r_sp.boundary_polygon != r_hf.boundary_polygon THEN 
                r_sp.computed_pop  * r_ci.population_perc / 100
            ELSE
                NULL 
            END AS {outside_header},
            r_ci.population_perc AS "% of Settlement Population Assigned To HF",
            CASE WHEN r_hf.type = 'outreach' THEN 
                ST_Distance(r_hf_parent.geom::geography, r_sp.geom::geography)
            ELSE 
                ST_Distance(r_hf.geom::geography, r_sp.geom::geography) 
            END AS "Distance Settlement HF (m)",
            CASE WHEN r_hf.type = 'outreach' THEN 
                ST_Distance(r_hf.geom::geography, r_sp.geom::geography)
            ELSE 
                NULL 
            END AS "Distance HF OutreachSite (m)",
            e_b_sp.hierarchy_names
        FROM {raw_hf} r_hf 
        INNER JOIN {raw_ci} r_ci 
            ON r_ci.health_facility_point = r_hf.global_id
        INNER JOIN {raw_sp} r_sp
            ON r_sp.global_id = r_ci.settlement_part
        INNER JOIN {raw_sn} r_sn
            ON r_sn.settlement_part = r_sp.global_id     
        INNER JOIN {e_boundary} e_b_hf
            ON r_hf.boundary_polygon = e_b_hf.global_id
        INNER JOIN {e_boundary} e_b_sp
            ON r_sp.boundary_polygon = e_b_sp.global_id
        LEFT JOIN {raw_hf} r_hf_parent
            ON r_hf.parent = r_hf_parent.global_id              
        WHERE --(NOT e_b_sp.is_surrounding OR NOT e_b_hf.is_surrounding)
            --only hf directly targetted    
            NOT e_b_hf.is_surrounding
            AND r_sn.is_primary
        )
        UNION ALL
        (
        SELECT
            'Mobile' as "HF Name",
            'mobile' as "RI Strategy",
            'N/A' as "Outreach Site Name",
            'N/A' as "Schedule",
            r_sn.name as "Settlement Name",    
            e_b_sp.hierarchy_names[1] AS {set_ward_header},
            r_sp.computed_pop * s.uncovered_catchment_perc / 100 as "Catchment Population (GIS)",
            r_sn.estimated_pop  * s.uncovered_catchment_perc / 100 as "Catchment Population (EST)",
            COALESCE(r_sn.estimated_pop, r_sp.computed_pop)  * s.uncovered_catchment_perc / 100 AS "Catchment Population (EST+GIS where no EST)",
            COALESCE(r_sn.estimated_pop, r_sp.computed_pop)  * s.uncovered_catchment_perc / 100 AS "Catchment Population Inside HF Ward",
            NULL AS "Catchment Population Outside HF Ward",
            s.uncovered_catchment_perc AS "% of Settlement Population Assigned To HF",
            NULL AS "Distance Settlement HF (m)",
            NULL AS "Distance HF OutreachSite (m)",
            e_b_sp.hierarchy_names
        FROM
            {set} s 
        INNER JOIN {raw_sn} r_sn 
            ON r_sn.global_id = s.global_id
        INNER JOIN {raw_sp} r_sp
            ON r_sn.settlement_part = r_sp.global_id
        INNER JOIN {e_boundary} e_b_sp
            ON r_sp.boundary_polygon = e_b_sp.global_id
        WHERE NOT e_b_sp.is_surrounding 
            AND s.uncovered_catchment_perc >= 0.5   
        )
    ) sq1
    ORDER BY {order_by_sql},
        --mobile last for a given ward 
        CASE WHEN "HF Name" = 'Mobile' THEN 1 ELSE 0 END, 
        "HF Name", "Settlement Name"
) sq 
        """)
        .format(
            op_level=SqlLiteral(boundary_operating_level),
            boundary=GeneralDbNames.BOUNDARY_POLYGON_LATEST.as_identifier(),
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
            raw_hf=ExportDbNames.RAW_HF.as_identifier(),
            raw_ci=ExportDbNames.RAW_CI.as_identifier(),
            raw_sn=ExportDbNames.RAW_SN.as_identifier(),
            raw_sp=ExportDbNames.RAW_SP.as_identifier(),
            set=ExportDbNames.SET.as_identifier(),
            set_ward_header=Identifier(f"Settlement {op_boundary_label}"),
            order_by_sql=SQL(", ").join(order_by_sql_list),
            frequency_sql=get_frequency_sql(),
            inside_header=Identifier(
                f"Catchment Population Inside HF {get_boundary_headers()[-1]}"
            ),
            outside_header=Identifier(
                f"Catchment Population Outside HF {get_boundary_headers()[-1]}"
            ),
        )
        .as_string()
    )
    return sql
