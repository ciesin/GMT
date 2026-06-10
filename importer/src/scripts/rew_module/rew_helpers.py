from typing import Dict, List, Optional, Tuple, Union
import psycopg2.extensions
from tabulate import tabulate

def get_text_value(value) -> Union[str, None]:
    
    if value is None:
        return None
    
    if not isinstance(value, str):
        value = str(value)
    
    value = value.strip()
    
    if len(value) == 0:
        return None
    
    return value


def get_text_value_with_default(value, default: str="") -> str:
    
    if value is None:
        return default
    
    if not isinstance(value, str):
        value = str(value)
    
    value = value.strip()
    
    if len(value) == 0:
        return default
    
    return value


def get_expected_text_value(value) -> str:
    
    if value is None:
        raise Exception(f"{value} is None")        
    
    if not isinstance(value, str):
        raise Exception(f"{value} is not a str")
    
    value = value.strip()
    
    if len(value) == 0:
        raise Exception(f"{value} is blank")
    
    return value

def trim_to_null(excel_value: str, null_values: List[str] = []) -> Union[str, None]:
    """

    :param excel_value: should already be stripped of whitespace
    :param null_values: lower case strings that should be considered as null, eg. na
    :return: original value or none
    """

    # doesn't hurt
    value = excel_value.strip()

    if len(value) == 0:
        return None

    if value.lower() in null_values:
        return None

    return value

# def set_cell_value(sheet)


def str_to_int(value: str):
    if value == "":
        return None
    
    value = value.replace(",", "")
    
    return int(float(value))
    

def get_value(db_value: Union[str, int, None], no_value_str: str) -> Union[str, int]:
    if isinstance(db_value, int):
        return db_value
    
    if db_value is None or len(db_value.strip()) == 0:
        return no_value_str
    
    return db_value


# when we have many matches, we want to show blank values in the list, but if all are blank, then we display only no_value_str
def get_value_list(db_value: List[Union[str, int, None]], no_value_str: str) -> List[str]:
    
    if len(db_value) == 0:
        return [no_value_str]
    
    v_list = [str(get_value(v, "")) for v in db_value]
    
    # is all blank?
    all_blank = all(value == "" for value in v_list)
    
    if all_blank:
        return [no_value_str]
    
    return v_list

def print_db_rows(
    conn: psycopg2.extensions.connection,
    sql:str, desc: str, 
    execute_args: Optional[Union[Tuple, Dict]] = None) -> int:
    with conn.cursor() as cur:
        
        if execute_args is not None:
            cur.execute(sql, execute_args)
        else:
            cur.execute(sql)
        
        rows = cur.fetchall()
                
        # Fetch the column names
        if len(rows) > 0:
            assert cur.description is not None
            col_names = [desc[0] for desc in cur.description]

            ts = tabulate(rows, headers=col_names, tablefmt='orgtbl')
            
            print(desc)
            print(ts)
            
            return len(rows)
    return 0
    
 # ['Index', 'HF Name', 'HF State', 'HF LGA', 'HF Ward', 
    # ***********************************************************
    # 'Health Facility (REW)', DONE IN SINGLE EDIT
    # ***********************************************************
    # 'Latitude', 'Longitude',
    # 'Alternative Names HF', 'Ownership', 'Type',
    # 'Primary Type', 
    # 'Village/Settlement Name', 
    # 'ALT Village/Settlement Name', 'Latitude (Settlement)', 
    # 'Longitude (Settlement)', 'Settlement State', 'Settlement LGA', 
    # 'Settlement Ward', 'Settlement In HF Ward?', 
    # 
    
    
    # ***********************************************************
    # 'Village/Settlement (REW)', DONE IN SINGLE EDIT
    # 'Operational settlement name (REW)',  BLANK in case of set. splits
    # 'Primary Settlement (REW)',
    # 'Settlement Type (Urban/ Rural) (REW)', DONE IN SINGLE EDIT
    # 'Fixed/Outreach/Mobile (REW)',  DONE IN SINGLE EDIT
    # 'Type of Immunization Sessions (FS, OS1, OS2, etc.) (REW)',  DONE IN SINGLE EDIT
    # ***********************************************************
    
    # 'Fixed/Outreach/Mobile  (GMT)',
    # 'Outreach Site Name (GMT)',
    # 'Days of Routine Immunization (fixed post)', 
    
    # ***********************************************************
    # 'Days of Routine Immunization (fixed post) (REW)', 
    # ***********************************************************
    # 
    # 'Transport', 
    # 'Frequency of outreach sessions', 'POP GIS', 
    # 'ESTIMATED POP (Entered in GMT)', 'POP DIFF', 
    
    # ***********************************************************
    # 'Total Population (REW)', 
    # ***********************************************************
    # 
    # 'Catchment Population Total (GIS POP)', 
    # 'Catchment Population Total (EST POP)', 
    # 'Catchment Population Total (EST POP + GIS where EST POP is missing)', 
    
    # ***********************************************************
    # 'Catchment Population Total (REW)',
    # ***********************************************************
    
    # 'Catchment Population Inside HF Ward', 
    # 'Catchment Population Outside HF Ward', 
    # '% of Settlement Population Assigned To HF', 
    # 'Distance Settlement HF (m)', 'Distance HF OutreachSite (m)',
    # 'Uninhabited - Unknown', 'Uninhabited - Abandoned', 
    # 'Uninhabited - Destroyed', 'Uninhabited - No settlement', 
    # 'Uninhabited - Other', 'cVDPV Outbreak', 'Densely Populated',
    # 'Hard To Reach', 'Internally Displaced', 'Measles Outbreak', 
    # 'Nomadic/Fulani', 'Non-compliant', 'Other', 'Polio High-Risk',
    # 'Riverine', 'Scattered', 'Security Compromised', 'Slum', 
    # 'Unknown', 'Uptake Issue', 'Zero-dose', 
    # ***********************************************************
    # 'Hard to Reach/ Nomadic/ Riverine (REW)',
    # 'ANC (REW)', 
    # 'Family Planning (REW)', 
    # 'Labour & Delivery (REW)', 
    # ***********************************************************
    # 'Routine Immunization', 'Antenatal Care', 'CMAM', 
    # 'Community Engagement', 'Curative Care and OPD', 'Delivery', 
    # 'Eye Care', 'Family Planning', 'Growth Monitoring', 
    # 'HIV/AIDS Prevention', 'Health Education', 'IMCI', 'IYCF', 
    # 'Malaria control', 'Mental Care', 'Newborn Care', 'Oral Care', 
    # 'Postnatal Care', 'Referral', 'Sanitation', 'TB/Leprosy services']
    
    """
     WITH rew_hf_sn_ids_catch AS (
        --Distinct is because same settlement can be in outreach + fixed post
        --And because include + generated
        SELECT DISTINCT 
            sn.global_id as sn_guid
        FROM
        {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} r_hf 
        INNER JOIN partitions.hf_view_latest hf 
            ON hf.global_id = r_hf.global_id 
        inner join boundary.polygon_latest b3 
            on b3.global_id = hf.boundary_polygon
        LEFT JOIN partitions.hf_view_latest hf_out
            ON hf_out.parent = hf.global_id
        --outreach or fixed post catchments
        INNER JOIN partitions.ci_view_latest ci 
            ON (
                ci.health_facility_point = hf.global_id 
                or 
                ci.health_facility_point = hf_out.global_id
            ) and ci.type != 'exclude'
        INNER JOIN partitions.sp_view_latest sp 
            ON sp.global_id = ci.settlement_part
        INNER JOIN partitions.sn_view_latest sn 
            ON sn.settlement_part = sp.global_id
        WHERE sn.is_primary
            AND hf.name = %(hf_name)s and b3.name = %(hf_ward)s
    )
    
    """