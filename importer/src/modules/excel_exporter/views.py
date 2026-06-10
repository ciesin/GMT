# Views related to the HF_catchments table
# this sheet is hierarchical, and contains summary rows for outreach/fp/fp+outreach/mobile
# the views help make it clear
import os
from typing import List

from psycopg.sql import SQL, Composed, Literal as SqlLiteral, Identifier

from lib.async_db_utils import execute_log, ConnType, get_enum_values
from modules.exporter_shared.gmt_db_objects import ExportDbNames


def get_boundary_headers(header_prefix: str = "") -> List[str]:
    return [
        f"{header_prefix}{s.strip()}"
        for s in os.environ["BOUNDARY_LEVEL_LABELS"].split("|")
    ]


def get_boundary_in_hf_header() -> Identifier:
    labels = get_boundary_headers("")
    boundary_operating_level = int(os.environ["OPERATIONAL_BOUNDARY_LEVEL"])
    return Identifier(f"Settlement In HF {labels[boundary_operating_level]}?")


def get_boundary_sql(e_b_table_name: str, header_prefix: str = "") -> Composed:
    labels = get_boundary_headers(header_prefix)
    boundary_operating_level = int(os.environ["OPERATIONAL_BOUNDARY_LEVEL"])
    labels_sql_list: List[Composed] = []

    for level, label in enumerate(labels):
        # omit level 0 country
        if level <= 0:
            continue
        # array is in reverse order, postgres arrays start at 1
        array_position = boundary_operating_level + 1 - level
        labels_sql_list.append(
            SQL("{}.hierarchy_names[{}] AS {}").format(
                Identifier(e_b_table_name),
                SqlLiteral(array_position),
                Identifier(label),
            )
        )

    return SQL(", ").join(labels_sql_list)


def get_set_rew_headers() -> List[str]:
    return [
        "Village/Settlement (REW)",
        "Operational settlement name (REW)",
        "Primary Settlement (REW)",
        "Settlement Type (Urban/ Rural) (REW)",
        "Fixed/Outreach/Mobile (REW)",
        "Immunization Sessions (FS, OS1, OS2, etc.) (REW)",
    ]


def get_set_rew_sql(value_is_null: bool = True) -> Composed:
    return SQL(", ").join(
        [
            SQL("{} as {}").format(
                SqlLiteral(None if value_is_null else "N/A"), Identifier(s)
            )
            for s in get_set_rew_headers()
        ]
    )


def get_frequency_sql() -> SQL:
    return SQL("""
    CASE
        WHEN r_hf.type != 'outreach' THEN
            'N/A'
        WHEN r_hf.frequency = 'unknown' THEN
            'Unknown'
        WHEN r_hf.frequency = 'weekly' THEN    
            'Weekly'
        WHEN r_hf.frequency = 'oncePerMonth' THEN
            'Once per month'
        WHEN r_hf.frequency = 'twicePerMonth' THEN
            'Twice per month'
        WHEN r_hf.frequency = 'threePerMonth' THEN
            'Three times per month'
        WHEN r_hf.frequency IN (
            'oncePerWeek', 'twicePerWeek', 'threePerWeek',
            'fourPerWeek', 'fivePerWeek', 'sixPerWeek'
        ) THEN
            health_facility.describe_operating_hours(r_hf.operating_hours_start, r_hf.operating_hours_stop)         
        ELSE
            r_hf.frequency
    END 
            """)


async def create_catchments_view(conn: ConnType) -> None:
    sql = (
        SQL("""
    DROP VIEW IF EXISTS {fs};    
    DROP VIEW IF EXISTS {hs};
    DROP VIEW IF EXISTS {cs};
    
    CREATE VIEW {cs} AS 
    SELECT 
    	e_b_fp.hierarchy_guids[1] AS op_b_guid,
    	e_b_fp.hierarchy_names[1] AS op_b_name,
    	r_fp.GLOBAL_id AS fp_guid,
    	r_hf.global_id AS hf_guid,
    	r_fp.name AS "HF Name", 
        {hf_boundary_sql}, 
        NULL AS "Health Facility REW",
        ST_Y(r_fp.geom) AS "Latitude",
        ST_X(r_fp.geom) AS "Longitude",
        array_to_string(r_fp.synonyms, ', ') AS "Alternative Names HF",
        CASE WHEN r_fp.private THEN 'Private' WHEN NOT r_fp.private THEN 'Public' ELSE 'Unknown' END AS "Ownership",
        r_fp.level_of_care::text AS "Type",
        r_fp.primary_type::text AS "Primary Type",
        r_sn.name AS "Village/Settlement Name",
        array_to_string(r_sn.synonyms, ', ') AS "ALT Village/Settlement Name",
        ST_Y(r_sn.geom) AS "Latitude (Settlement)",
        ST_X(r_sn.geom) AS "Longitude (Settlement)",        
        {sn_boundary_sql},
        case when r_sn.boundary_polygon = r_fp.boundary_polygon then 'Yes' Else 'No' END as {stl_in_hf_ward_header},
        {set_rew_sql},
        CASE WHEN r_hf.TYPE = 'outreach' THEN 'Outreach' ELSE 'Fixed Post' END "Fixed/Outreach/Mobile  (GMT)",
        CASE WHEN r_hf.TYPE = 'outreach' THEN r_hf.name ELSE NULL END AS "Outreach Site Name (GMT)",
        health_facility.describe_operating_hours(r_fp.operating_hours_start, r_fp.operating_hours_stop) as "Days of Routine Immunization (fixed post)",
        'N/A' as "Days of Routine Immunization (fixed post) (REW)",
        CASE WHEN r_hf.TYPE = 'outreach' THEN array_to_string(r_hf.transport, ', ') else 'N/A' END as "Transport",
        {frequency_sql} AS "Frequency of outreach sessions",
        r_sp.computed_pop as "POP GIS",
        r_sn.estimated_pop as "ESTIMATED POP (Entered in GMT)",
        r_sp.computed_pop - COALESCE(r_sn.estimated_pop, 0) as "POP DIFF",
        null as "Total Population (REW)",
        (r_ci.population_perc/100.0 * r_sp.computed_pop) AS "Catchment Population Total (GIS POP)",
        (r_ci.population_perc/100.0 * r_sn.estimated_pop) AS "Catchment Population Total (EST POP)",
        (r_ci.population_perc/100.0 * COALESCE(r_sn.estimated_pop, r_sp.computed_pop)) AS "Catchment Population Total (EST POP + GIS where EST POP is missing)",
        null as "Catchment Population Total (REW)", 
        case when r_sn.boundary_polygon = r_fp.boundary_polygon then 
        (r_ci.population_perc/100.0 * r_sp.computed_pop) else null end as {inside_header},
        case when r_sn.boundary_polygon != r_fp.boundary_polygon then 
        (r_ci.population_perc/100.0 * r_sp.computed_pop) else null end as {outside_header},
        r_ci.population_perc as "% of Settlement Population Assigned To HF",
        ST_Distance(r_fp.geom::geography, r_fp.geom::geography) AS "Distance Settlement HF (m)",
        CASE WHEN r_hf.type = 'outreach' THEN 
            ST_Distance(r_hf.geom::geography, r_sp.geom::geography)
        ELSE 
            NULL 
        END AS "Distance HF OutreachSite (m)",
        {uninhabited_reasons_sql},
        {special_attention_sql}        						
    FROM {raw_hf} AS r_hf
    INNER JOIN {raw_ci} r_ci
            ON r_ci.health_facility_point = r_hf.global_id
    INNER JOIN {raw_sp} r_sp
        ON r_sp.global_id = r_ci.settlement_part
    INNER JOIN {raw_sn} r_sn
        ON r_sn.settlement_part = r_sp.global_id
    INNER JOIN {e_boundary} e_b_sn
        ON r_sn.boundary_polygon = e_b_sn.global_id
    inner JOIN {raw_hf} r_fp
        ON COALESCE(r_hf.parent, r_hf.global_id) = r_fp.global_id
    INNER JOIN {e_boundary} e_b_fp
        ON r_fp.boundary_polygon = e_b_fp.global_id
    WHERE 
        r_sn.is_primary 
        AND NOT COALESCE(r_sn.uninhabited, FALSE)
        --This view used in HF_catchments sheet only shows HFs in the explicitly selected boundaries (aka not a surrounding one)
        AND NOT e_b_fp.is_surrounding    
        ;
""")
        .format(
            cs=ExportDbNames.COVERED_SETTLEMENTS.as_identifier(),
            hs=ExportDbNames.HF_SUMMARY.as_identifier(),
            fs=ExportDbNames.FP_SUMMARY.as_identifier(),
            hf_boundary_sql=get_boundary_sql("e_b_fp", "HF "),
            sn_boundary_sql=get_boundary_sql("e_b_sn", "Settlement "),
            set_rew_sql=get_set_rew_sql(True),
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
            raw_sn=ExportDbNames.RAW_SN.as_identifier(),
            raw_sp=ExportDbNames.RAW_SP.as_identifier(),
            raw_ci=ExportDbNames.RAW_CI.as_identifier(),
            raw_hf=ExportDbNames.RAW_HF.as_identifier(),
            inside_header=Identifier(
                f"Catchment Population Inside HF {get_boundary_headers()[-1]}"
            ),
            outside_header=Identifier(
                f"Catchment Population Outside HF {get_boundary_headers()[-1]}"
            ),
            special_attention_sql=await get_special_attention_sql(conn),
            uninhabited_reasons_sql=await get_uninhabited_reasons_sql(conn),
            frequency_sql=get_frequency_sql(),
            stl_in_hf_ward_header=get_boundary_in_hf_header(),
        )
        .as_string()
    )

    await execute_log(conn, sql)


async def get_uninhabited_reasons_sql(conn: ConnType) -> Composed:
    uninhabited_reasons = await get_enum_values(
        conn, "sn_uninhabited_reason", ExportDbNames.TEMP_SCHEMA
    )

    uninhabited_reasons_sql = SQL(", ").join(
        [
            SQL(
                """case when {} = r_sn.uninhabited_reason then 'Yes' else 'No' End AS {}"""
            ).format(SqlLiteral(s), Identifier(f"Uninhabited - {s}"))
            for s in uninhabited_reasons
        ]
    )
    return uninhabited_reasons_sql


async def get_special_attention_sql(conn: ConnType) -> Composed:
    special_attention = await get_enum_values(
        conn, "sn_problematic", ExportDbNames.TEMP_SCHEMA
    )
    special_attention_sql_list = []
    for s in special_attention:
        sql_s = SQL(
            """case when ({} = ANY(r_sn.problematic)) then 'Yes' else 'No' End AS {}"""
        )
        col_name = s
        special_attention_sql_list.append(
            sql_s.format(SqlLiteral(s), Identifier(col_name))
        )
    special_attention_sql = SQL(", ").join(special_attention_sql_list)

    return special_attention_sql


async def get_uninhabited_reasons_sql_null(conn: ConnType) -> Composed:
    uninhabited_reasons = await get_enum_values(
        conn, "sn_uninhabited_reason", ExportDbNames.TEMP_SCHEMA
    )

    uninhabited_reasons_sql = SQL(", ").join(
        [
            SQL("""'N/A' AS {}""").format(Identifier(f"Uninhabited - {s}"))
            for s in uninhabited_reasons
        ]
    )
    return uninhabited_reasons_sql


async def get_special_attention_sql_null(conn: ConnType) -> Composed:
    special_attention = await get_enum_values(
        conn, "sn_problematic", ExportDbNames.TEMP_SCHEMA
    )
    special_attention_sql_list = []
    for s in special_attention:
        sql_s = SQL("""'N/A' AS {}""")
        col_name = s
        special_attention_sql_list.append(sql_s.format(Identifier(col_name)))
    special_attention_sql = SQL(", ").join(special_attention_sql_list)

    return special_attention_sql


async def create_mobile_settlements_view(conn: ConnType) -> None:
    sql = (
        SQL("""
        DROP VIEW IF EXISTS {msum};
    DROP VIEW IF EXISTS {ms};
    CREATE VIEW {ms} AS    
    SELECT 	
        e_b_sn.hierarchy_guids[1] AS op_b_guid,
        e_b_sn.hierarchy_names[1] AS op_b_name,	
        'Mobile' AS 	"HF Name",	
        {hf_boundary_sql},  
        NULL AS "Health Facility REW",
        NULL::double precision AS "Latitude",
        null::double precision AS "Longitude",
        'N/A'  AS "Alternative Names HF",
        'N/A' AS "Ownership",
        'N/A' AS "Type",
        'N/A' AS "Primary Type",
        r_sn.name AS "Village/Settlement Name",
        array_to_string(r_sn.synonyms, ', ') AS "ALT Village/Settlement Name",
        ST_Y(r_sn.geom) AS "Latitude (Settlement)",
        ST_X(r_sn.geom) AS "Longitude (Settlement)",
        {sn_boundary_sql},
        'Yes' as{stl_in_hf_ward_header},
        {set_rew_sql},
        'Mobile' AS "Fixed/Outreach/Mobile  (GMT)",
        'N/A' AS "Outreach Site Name (GMT)",
        'N/A' AS "Days of Routine Immunization (fixed post)",
        'N/A' AS "Days of Routine Immunization (fixed post) (REW)",
        'N/A' AS "Transport",	
        'N/A' AS "Frequency of outreach sessions",
        s.computed_pop as "POP GIS",
        s.estimated_pop as "ESTIMATED POP (Entered in GMT)",
        s.computed_pop - COALESCE(r_sn.estimated_pop, 0) as "POP DIFF",
        null as "Total Population (REW)",        
        (s.uncovered_catchment_perc/100.0 * s.computed_pop) AS "Catchment Population Total (GIS POP)",        
        (s.uncovered_catchment_perc/100.0 * r_sn.estimated_pop) AS "Catchment Population Total (EST POP)",
        (s.uncovered_catchment_perc/100.0 * COALESCE(s.estimated_pop, s.computed_pop)) AS "Catchment Population Total (EST POP + GIS where EST POP is missing)",
        null as "Catchment Population Total (REW)", 
        (s.uncovered_catchment_perc/100.0 * s.computed_pop) as {inside_header},
        null::double precision as {outside_header},
        s.uncovered_catchment_perc AS "% of Settlement Population Assigned To HF",
        NULL::double precision AS "Distance Settlement HF (m)",
        NULL::double precision AS "Distance HF OutreachSite (m)",
        {uninhabited_reasons_sql},
        {special_attention_sql}
    FROM {set} s 
    INNER JOIN {e_boundary} e_b_sn
        ON s.ward_global_id  = e_b_sn.global_id 
    INNER JOIN {raw_sn} r_sn 
        ON r_sn.global_id  = s.global_id
     WHERE s.uncovered_catchment_perc  >= 0.5 AND r_sn.is_primary AND NOT COALESCE(r_sn.uninhabited, FALSE)
    """)
        .format(
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
            raw_sn=ExportDbNames.RAW_SN.as_identifier(),
            set=ExportDbNames.SET.as_identifier(),
            # by design that we don't have a FP here, so use the boundary of the sn
            hf_boundary_sql=get_boundary_sql("e_b_sn", "HF "),
            sn_boundary_sql=get_boundary_sql("e_b_sn", "Settlement "),
            set_rew_sql=get_set_rew_sql(True),
            special_attention_sql=await get_special_attention_sql(conn),
            uninhabited_reasons_sql=await get_uninhabited_reasons_sql(conn),
            ms=ExportDbNames.MOBILE_SETTLEMENTS.as_identifier(),
            msum=ExportDbNames.MOBILE_SUMMARY.as_identifier(),
            inside_header=Identifier(
                f"Catchment Population Inside HF {get_boundary_headers()[-1]}"
            ),
            outside_header=Identifier(
                f"Catchment Population Outside HF {get_boundary_headers()[-1]}"
            ),
            stl_in_hf_ward_header=get_boundary_in_hf_header(),
        )
        .as_string()
    )

    await execute_log(conn, sql)


async def create_mobile_summary_view(conn: ConnType) -> None:
    sql = (
        SQL("""
    DROP VIEW IF EXISTS {msum};
    CREATE VIEW {msum} AS    
    SELECT 	
        e_b.hierarchy_guids[1] AS op_b_guid,
        e_b.hierarchy_names[1] AS op_b_name,	
        'Mobile' AS 	"HF Name",	
        {hf_boundary_sql}, 
        NULL AS "Health Facility REW",
        NULL::double precision AS "Latitude",
        null::double precision AS "Longitude",
        'N/A'  AS "Alternative Names HF",
        'N/A' AS "Ownership",
        'N/A' AS "Type",
        'N/A' AS "Primary Type",
        'N/A' AS "Village/Settlement Name",
        'N/A' AS "ALT Village/Settlement Name",
        NULL::double precision AS "Latitude (Settlement)",
        NULL::double precision AS "Longitude (Settlement)",
        {sn_boundary_sql},
        'N/A' as{stl_in_hf_ward_header},
        {set_rew_sql},    
        'Mobile' AS "Fixed/Outreach/Mobile  (GMT)",
        'N/A' AS "Outreach Site Name (GMT)",
        'N/A' AS "Days of Routine Immunization (fixed post)",
        'N/A' AS "Days of Routine Immunization (fixed post) (REW)",
        'N/A' AS "Transport",	
        'N/A' AS "Frequency of outreach sessions",
        null::double precision as "POP GIS",
        null::double precision as "ESTIMATED POP (Entered in GMT)",
        null::double precision as "POP DIFF",
        null as "Total Population (REW)",        
        coalesce(sum(hms."Catchment Population Total (GIS POP)"), 0) AS "Catchment Population Total (GIS POP)",
        coalesce(sum(hms."Catchment Population Total (EST POP)"), 0) AS "Catchment Population Total (EST POP)",
        coalesce(sum(hms."Catchment Population Total (EST POP + GIS where EST POP is missing)"), 0) AS "Catchment Population Total (EST POP + GIS where EST POP is missing)",
        null as "Catchment Population Total (REW)", 
        coalesce(sum(hms."Catchment Population Total (GIS POP)"), 0) AS {inside_header},
        null::double precision as {outside_header},
        null::double precision AS "% of Settlement Population Assigned To HF",
        NULL::double precision AS "Distance Settlement HF (m)",
        NULL::double precision AS "Distance HF OutreachSite (m)",
        {uninhabited_reasons_sql},
        {special_attention_sql}
    FROM {e_boundary} e_b
    LEFT JOIN {ms} hms 
       ON hms.op_b_guid = e_b.global_id 
    WHERE NOT e_b.is_surrounding    
    GROUP BY e_b.global_id
    ;
""")
        .format(
            set_rew_sql=get_set_rew_sql(False),
            ms=ExportDbNames.MOBILE_SETTLEMENTS.as_identifier(),
            msum=ExportDbNames.MOBILE_SUMMARY.as_identifier(),
            # by design that we don't have a FP here, so use the boundary of the sn
            hf_boundary_sql=get_boundary_sql("e_b", "HF "),
            sn_boundary_sql=get_boundary_sql("e_b", "Settlement "),
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
            uninhabited_reasons_sql=await get_uninhabited_reasons_sql_null(conn),
            special_attention_sql=await get_special_attention_sql_null(conn),
            inside_header=Identifier(
                f"Catchment Population Inside HF {get_boundary_headers()[-1]}"
            ),
            outside_header=Identifier(
                f"Catchment Population Outside HF {get_boundary_headers()[-1]}"
            ),
            stl_in_hf_ward_header=get_boundary_in_hf_header(),
        )
        .as_string()
    )

    await execute_log(conn, sql)


async def create_hf_summary_view(conn: ConnType) -> None:
    sql = (
        SQL("""
--fp / outreach summary
DROP VIEW IF EXISTS {hs};
CREATE VIEW {hs} AS 
SELECT 
	e_b_fp.hierarchy_guids[1] AS op_b_guid,
	e_b_fp.hierarchy_names[1] AS op_b_name,
	r_fp.GLOBAL_id AS fp_guid,
	r_fp.name AS "HF Name", 
    {hf_boundary_sql}, 
    'N/A' AS "Health Facility REW",
    ST_Y(r_fp.geom) AS "Latitude",
    ST_X(r_fp.geom) AS "Longitude",
    array_to_string(r_fp.synonyms, ', ') AS "Alternative Names HF",
    CASE WHEN r_fp.private THEN 'Private' WHEN NOT r_fp.private THEN 'Public' ELSE 'Unknown' END AS "Ownership",
    r_fp.level_of_care::text AS "Type",
    r_fp.primary_type::text AS "Primary Type",
    'N/A' AS "Village/Settlement Name",
    'N/A' AS "ALT Village/Settlement Name",
    NULL::double precision AS "Latitude (Settlement)",
    NULL::double precision AS "Longitude (Settlement)",
    {sn_boundary_sql},
    
    'N/A' as{stl_in_hf_ward_header},
    {set_rew_sql},    
    CASE WHEN r_hf.TYPE = 'outreach' THEN 'Outreach' else 'Fixed Post' end AS "Fixed/Outreach/Mobile  (GMT)",
    CASE WHEN r_hf.TYPE = 'outreach' THEN r_hf.name ELSE NULL END AS "Outreach Site Name (GMT)",
    health_facility.describe_operating_hours(r_fp.operating_hours_start, r_fp.operating_hours_stop) as "Days of Routine Immunization (fixed post)",
        
    'N/A' AS "Days of Routine Immunization (fixed post) (REW)",
    'N/A' AS "Transport",	
    {frequency_sql} AS "Frequency of outreach sessions",
    
    null::double precision as "POP GIS",
    null::double precision as "ESTIMATED POP (Entered in GMT)",
    null::double precision as "POP DIFF",
    null as "Total Population (REW)",        
    
    coalesce(sum(cs."Catchment Population Total (GIS POP)"), 0) AS "Catchment Population Total (GIS POP)",
    coalesce(sum(cs."Catchment Population Total (EST POP)"), 0) AS "Catchment Population Total (EST POP)",
    coalesce(sum(cs."Catchment Population Total (EST POP + GIS where EST POP is missing)"), 0) AS "Catchment Population Total (EST POP + GIS where EST POP is missing)",
    null as "Catchment Population Total (REW)", 
    coalesce(sum(cs.{inside_header}), 0) AS {inside_header},
    coalesce(sum(cs.{outside_header}), 0) AS {outside_header},
    
    null::double precision AS "% of Settlement Population Assigned To HF",
    NULL::double precision AS "Distance Settlement HF (m)",
    NULL::double precision AS "Distance HF OutreachSite (m)",
    {uninhabited_reasons_sql},
    {special_attention_sql}
    FROM {raw_hf} AS r_hf
    inner JOIN {raw_hf} r_fp
        ON COALESCE(r_hf.parent, r_hf.global_id) = r_fp.global_id
    INNER JOIN {e_boundary} e_b_fp
        ON r_fp.boundary_polygon = e_b_fp.global_id
    --outreach or fixed post isolated total (so fp not include outreach catchment totals)
    LEFT JOIN {cs} cs 
        ON cs.hf_guid = r_hf.global_id
    --This view used in HF_catchments sheet only shows HFs in the explicitly selected boundaries (aka not a surrounding one)
    WHERE NOT e_b_fp.is_surrounding
    GROUP BY r_fp.global_id, e_b_fp.global_id, r_hf.global_id
    ;    
    """)
        .format(
            hs=ExportDbNames.HF_SUMMARY.as_identifier(),
            cs=ExportDbNames.COVERED_SETTLEMENTS.as_identifier(),
            raw_hf=ExportDbNames.RAW_HF.as_identifier(),
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
            hf_boundary_sql=get_boundary_sql("e_b_fp", "HF "),
            sn_boundary_sql=SQL(", ").join(
                [
                    SQL("'N/A' as {}").format(Identifier(s))
                    for s in reversed(get_boundary_headers("Settlement ")[1:])
                ]
            ),
            frequency_sql=get_frequency_sql(),
            uninhabited_reasons_sql=await get_uninhabited_reasons_sql_null(conn),
            special_attention_sql=await get_special_attention_sql_null(conn),
            set_rew_sql=get_set_rew_sql(False),
            inside_header=Identifier(
                f"Catchment Population Inside HF {get_boundary_headers()[-1]}"
            ),
            outside_header=Identifier(
                f"Catchment Population Outside HF {get_boundary_headers()[-1]}"
            ),
            stl_in_hf_ward_header=get_boundary_in_hf_header(),
        )
        .as_string()
    )

    await execute_log(conn, sql)


async def create_fp_summary_view(conn: ConnType) -> None:
    sql = (
        SQL("""
DROP VIEW IF EXISTS {fs};
CREATE OR REPLACE VIEW {fs} AS 
SELECT 
	e_b_fp.hierarchy_guids[1] AS op_b_guid,
	e_b_fp.hierarchy_names[1] AS op_b_name,
	r_fp.GLOBAL_id AS fp_guid,
	r_fp.name AS "HF Name", 
    {hf_boundary_sql}, 
    'N/A' AS "Health Facility REW",
    ST_Y(r_fp.geom) AS "Latitude",
    ST_X(r_fp.geom) AS "Longitude",
    array_to_string(r_fp.synonyms, ', ') AS "Alternative Names HF",
    CASE WHEN r_fp.private THEN 'Private' WHEN NOT r_fp.private THEN 'Public' ELSE 'Unknown' END AS "Ownership",
    r_fp.level_of_care::text AS "Type",
    r_fp.primary_type::text AS "Primary Type",
    'N/A' AS "Village/Settlement Name",
    'N/A' AS "ALT Village/Settlement Name",
    NULL::double precision AS "Latitude (Settlement)",
    NULL::double precision AS "Longitude (Settlement)",
    {sn_boundary_sql},
    
    'N/A' as {stl_in_hf_ward_header},
    {set_rew_sql},
    'Fixed Post' AS "Fixed/Outreach/Mobile  (GMT)",
    --Will be changed to N/A but null needed for proper sort
    null AS "Outreach Site Name (GMT)",
    health_facility.describe_operating_hours(r_fp.operating_hours_start, r_fp.operating_hours_stop) as "Days of Routine Immunization (fixed post)",
    
    'N/A' AS "Days of Routine Immunization (fixed post) (REW)",
    'N/A' AS "Transport",
    'N/A' AS "Frequency of outreach sessions",
    
    null::double precision as "POP GIS",
    null::double precision as "ESTIMATED POP (Entered in GMT)",
    null::double precision as "POP DIFF",
    null as "Total Population (REW)",        
    
    coalesce(sum(cs."Catchment Population Total (GIS POP)"), 0) AS "Catchment Population Total (GIS POP)",
    coalesce(sum(cs."Catchment Population Total (EST POP)"), 0) AS "Catchment Population Total (EST POP)",
    coalesce(sum(cs."Catchment Population Total (EST POP + GIS where EST POP is missing)"), 0) AS "Catchment Population Total (EST POP + GIS where EST POP is missing)",
    null as "Catchment Population Total (REW)", 
    coalesce(sum(cs.{inside_header}), 0) AS {inside_header},
    coalesce(sum(cs.{outside_header}), 0) AS {outside_header},
    
    null::double precision AS "% of Settlement Population Assigned To HF",
    NULL::double precision AS "Distance Settlement HF (m)",
    NULL::double precision AS "Distance HF OutreachSite (m)",
    {uninhabited_reasons_sql},
    {special_attention_sql}
FROM {raw_hf} AS r_hf
inner JOIN {raw_hf} r_fp
    ON COALESCE(r_hf.parent, r_hf.global_id) = r_fp.global_id
INNER JOIN {e_boundary} e_b_fp
    ON r_fp.boundary_polygon = e_b_fp.global_id
    --outreach or fixed post isolated total (so fp not include outreach catchment totals)
LEFT JOIN {cs} cs ON cs.hf_guid = r_hf.global_id
--This view used in HF_catchments sheet only shows HFs in the explicitly selected boundaries (aka not a surrounding one)
WHERE NOT e_b_fp.is_surrounding
GROUP BY r_fp.global_id, e_b_fp.global_id
    
""")
        .format(
            fs=ExportDbNames.FP_SUMMARY.as_identifier(),
            cs=ExportDbNames.COVERED_SETTLEMENTS.as_identifier(),
            uninhabited_reasons_sql=await get_uninhabited_reasons_sql_null(conn),
            special_attention_sql=await get_special_attention_sql_null(conn),
            e_boundary=ExportDbNames.BOUNDARY.as_identifier(),
            set_rew_sql=get_set_rew_sql(False),
            hf_boundary_sql=get_boundary_sql("e_b_fp", "HF "),
            inside_header=Identifier(
                f"Catchment Population Inside HF {get_boundary_headers()[-1]}"
            ),
            outside_header=Identifier(
                f"Catchment Population Outside HF {get_boundary_headers()[-1]}"
            ),
            sn_boundary_sql=SQL(", ").join(
                [
                    SQL("'N/A' as {}").format(Identifier(s))
                    for s in reversed(get_boundary_headers("Settlement ")[1:])
                ]
            ),
            raw_hf=ExportDbNames.RAW_HF.as_identifier(),
            stl_in_hf_ward_header=get_boundary_in_hf_header(),
        )
        .as_string()
    )

    await execute_log(conn, sql)
