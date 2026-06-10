import pprint
import re
from itertools import zip_longest
from pathlib import Path
from typing import List, Optional, Tuple, Union, Dict

from sqlalchemy.sql import text
from tabulate import tabulate

from scripts.create_views import get_db_name
from scripts.rew_module.excel_wrapper import SheetWrapper, WorkbookWrapper, CellWrapper
from scripts.rew_module.rew_helpers import trim_to_null, str_to_int, get_text_value_with_default
import psycopg2.extensions

class DB_CONSTANTS:
    SCHEMA_NAME = "rew"
    TABLE_HF = "hf"
    
    TABLE_SET = "set"
    
    TABLE_SET_M2M = "set_m2m"

class SHEET_BACKGROUND_SERVICES_CONSTANTS:
    
    # header labels
    HEALTH_FACILTY = "health facility"
    WARD = "ward"
    LGA = "lga"
    
    # table column headers
    SERVICES = 'services'

# column names
class SHEET_TARGET_POP_CONSTANTS:
    SN = "S/N".lower()
    TOTAL_POPULATION = "Total population".lower()
    URBAN_RURAL = "Settlement Type (Urban/ Rural)".lower()
    SETTLEMENT_NAME = "Village/Settlement".lower()
    HARD_TO_REACH = "Hard to Reach/ Nomadic/ Riverine".lower()

def check_name(name: str, should_be: str):
    if name != should_be:
        raise Exception(f"Value: [{name}] expected [{should_be}]")


def read_excel_rew(path: Path, conn: psycopg2.extensions.connection, gmt_state: str, gmt_lga: str):
    # print(f"Parsing {path} to DB {db_name}")
    #return 
    with WorkbookWrapper(path) as workbook:

        # background / services

        background_services_sheet = workbook.sheet_by_index(0)

        check_name(background_services_sheet.name, "Background and Services")

        hf_db_id = read_sheet_background_and_services(conn, background_services_sheet, path, gmt_state, gmt_lga)
        
        target_population = workbook.sheet_by_index(1)
        
        check_name(target_population.name, "Target Population")
        
        read_sheet_target_population(conn, hf_db_id, target_population)
        
        catchment_area = workbook.sheet_by_index(2)
        
        # small workaround, sometimes there is a sheet1 inserted, or a different named one
        if catchment_area.name != "Catchment Area for Services":
            catchment_area = workbook.sheet_by_index(3)
        
        check_name(catchment_area.name, "Catchment Area for Services")
        
        read_sheet_catchment_area(conn, hf_db_id, catchment_area)


def read_sheet_target_population(conn, hf_db_id: int, sheet: SheetWrapper):
    
    assert isinstance(hf_db_id, int)
    
    header_row_index = find_row_with_value(sheet, "S/N") 
    
    assert header_row_index and header_row_index >= 0
        
    # s/n is spanning 2 rows and we want the last one since we want the non merged headers
    expected_columns = 11
    table_rows, header_row = read_xls_table(sheet, header_row_index, header_row_index+1, expected_columns)

    # The order of the columns can change, so instead we'll remove headers with a % in it
    # which are the target population columns
    
    expected_column_names = [
        SHEET_TARGET_POP_CONSTANTS.SN,
        SHEET_TARGET_POP_CONSTANTS.TOTAL_POPULATION,
        SHEET_TARGET_POP_CONSTANTS.URBAN_RURAL,
        SHEET_TARGET_POP_CONSTANTS.SETTLEMENT_NAME,
        SHEET_TARGET_POP_CONSTANTS.HARD_TO_REACH
    ]
    
    cols_to_keep = set()
    
    filtered_header_row = []
    
    # this can be blank
    if header_row[1] == "":
        header_row[1] = SHEET_TARGET_POP_CONSTANTS.SETTLEMENT_NAME
    if header_row[10] == "":
        header_row[10] = SHEET_TARGET_POP_CONSTANTS.HARD_TO_REACH

    column_header_to_idx: Dict[str, int] = {}
    
    for c in expected_column_names:
        if c not in header_row:
            pprint.pp(header_row)
            raise Exception(f"Could not find [{c}]")
            
        assert c in header_row
        col_idx = header_row.index(c)
        
        column_header_to_idx[c] = col_idx
                
        cols_to_keep.add(col_idx)
        
        filtered_header_row.append(header_row[col_idx])
    
    if len(header_row) < expected_columns:
        raise Exception(f"Not enough headers in target population: {header_row} in row index {header_row_index}, len {len(header_row)}")
    
    
    # remove the target population columns
    assert len(filtered_header_row) == 5
    # filtered_rows = []
    
    with conn.cursor() as cur:
        for row_idx, tr in enumerate(table_rows):
            
            sn_value = tr[column_header_to_idx[SHEET_TARGET_POP_CONSTANTS.SN]]
            
            # we are done, there are some rows that say FARMING AND REARING
            # we want to skip
            if sn_value.lower() == 'total':
                break 
            
            set_name = tr[column_header_to_idx[SHEET_TARGET_POP_CONSTANTS.SETTLEMENT_NAME]]
            
            if not set_name:
                continue
            
            # print(f"Sn {sn_value} name {set_name}")
            
            
            # There can be duplicates, so we check what's already there for this hf id
            sql = f"""
                SELECT name, hf_id, total_pop, type, problems
                FROM {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET}
                WHERE name ilike %s AND hf_id = %s
                LIMIT 1
            """
                
            cur.execute(sql, (set_name, hf_db_id))
            
            existing_row = cur.fetchone()
            
            values_to_insert = (
                set_name,
                hf_db_id,
                str_to_int(tr[column_header_to_idx[SHEET_TARGET_POP_CONSTANTS.TOTAL_POPULATION]]),
                # urban / rural != null used to tell something was parsed in this sheet 
                get_text_value_with_default(tr[column_header_to_idx[SHEET_TARGET_POP_CONSTANTS.URBAN_RURAL]]),
                tr[column_header_to_idx[SHEET_TARGET_POP_CONSTANTS.HARD_TO_REACH]],
            )
            
            if existing_row is not None:
                print(f"An existing row !")
                dup_rows = [existing_row, values_to_insert]
                ts = tabulate(dup_rows, headers=["Set Name", "Hf REW id", "Total Pop", "Urban/Rural", "Hard to Reach"], tablefmt='orgtbl')
                print(ts)
                continue
                
                
            sql = f"""
            INSERT INTO {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET}
            (name, hf_id, total_pop, type, problems)
            VALUES (%s, %s, %s, %s, %s)
            """
            cur.execute(sql, values_to_insert)
            
            
            # sliced_tr = [item for index, item in enumerate(tr) if index in cols_to_keep]

            # assert len(sliced_tr) == 5
            
            # if len(sliced_tr[1].strip()) == 0:
            #     continue
            
            # filtered_rows.append(sliced_tr)
        
    # remove trailing data
    
    #ts = tabulate(filtered_rows, headers=filtered_header_row, tablefmt='orgtbl')
    #print(ts)


def read_sheet_catchment_area(conn, hf_db_id: int, sheet: SheetWrapper):

    header_row_index = find_row_with_value(sheet, "S/N") 
    
    assert header_row_index and header_row_index >= 0
        
    # s/n is spanning 2 rows and we want the last one since we want the non merged headers
    expected_columns = 10
    table_rows, header_row = read_xls_table(sheet, header_row_index, header_row_index+1,expected_columns)
    
    assert "settlement" in header_row[1]
    assert "fixed" in header_row[2]
    assert "outreach" in header_row[3]
    assert "mobile" in header_row[4]
    assert "yes" in header_row[5]
    assert "session" in header_row[6]
    assert "anc" in header_row[7]
    assert "delivery" in header_row[8] 
    assert "family" in header_row[9] 
    
    assert len(header_row) == expected_columns
    #filtered_rows = []
    
    with conn.cursor() as cur:
    
        for row_idx, tr in enumerate(table_rows):
            #del tr[3:9]
            assert len(tr) == expected_columns
            
            set_name = tr[1]
            fixed = trim_to_null(tr[2])
            outreach = trim_to_null(tr[3])
            mobile = trim_to_null(tr[4], ['na'])
            ri_yes_no = tr[5]
            sessions = tr[6]
            anc = tr[7]
            delivery = tr[8]
            family = tr[9]
            
            if len(set_name) == 0:
                continue
            
            # Try to get the id
            sql = f"""
            SELECT id FROM {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET}
            WHERE name ilike %s AND hf_id = %s
            LIMIT 1
            """
            
            cur.execute(sql, (set_name, hf_db_id))
            set_id = cur.fetchone()
            
            if set_id is None:
                # print(f"!!! Catchment area & services set name [{set_name}] has no entry in target pop for {hf_db_id}")
                sql = f"""
        INSERT INTO {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET}
        (name, hf_id)
        VALUES (%s, %s)
        RETURNING id
        """
                cur.execute(sql, (
                    set_name,
                    hf_db_id,
                ))
                set_id = cur.fetchone()
                assert set_id is not None 
                # conn.commit()

            # anc is null is used to tell if nothing was found in the catchment area for services sheet
            assert isinstance(anc, str)
            
            sql = f"""
            UPDATE {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} s
            SET dist_fp = %s,
                dist_out = %s,
                dist_mobile = %s,
                ri_yes_no = %s,
                sessions = %s,
                anc = %s,
                labour_delivery = %s,
                family_planning = %s
            WHERE s.id = %s
            """
            cur.execute(sql, (
                fixed,
                outreach,
                mobile,
                ri_yes_no,
                sessions,
                anc,
                delivery,
                family,
                set_id
            ))
            
            assert 1 == cur.rowcount
            
            # if len(tr[1].strip()) == 0:
            #     continue
            
            # filtered_rows.append(tr)        
    
    conn.commit()
    # ts = tabulate(filtered_rows, headers=header_row, tablefmt='orgtbl')
    # print(ts)


def get_label_values(
    excel_path: Path,
    background_services_sheet: SheetWrapper
) -> Tuple[Dict[str,str], int]:
    """
    :param background_services_sheet:
    :return: label=> value dict and 0 based row index where the background/services table is
    """
    nrows = background_services_sheet.nrows
    

    label_values = {}
    
    # First find the header row of the back/services table
    back_services_header_row_idx = None
    for row_index in range(0, min(20, nrows)):
        row = background_services_sheet.row(row_index)
        header_text_list = get_header_text_xls(row)

        if "Services" in header_text_list or "S/N" in header_text_list:
            back_services_header_row_idx = row_index
            break
    
    assert back_services_header_row_idx is not None
    
    label_values = gather_label_values(background_services_sheet,
                                       excel_path,
                                       0, back_services_header_row_idx-1,
                                       0, background_services_sheet.ncols-1)

    # pprint.pp(label_values)

    return label_values, back_services_header_row_idx
    


def read_sheet_background_and_services(
    conn, background_services_sheet: SheetWrapper, file_path: Path, gmt_state: str, gmt_lga: str) -> int:
    # Read the header info in form of label: value

    label_values, services_table_row_index = get_label_values(file_path, background_services_sheet)
    
    # pprint.pp(label_values)
    
    # assert_label_value(label_values, SHEET_LABEL_CONSTANTS.HEALTH_FACILTY)
    # assert_label_value(label_values, SHEET_LABEL_CONSTANTS.WARD)
    # assert_label_value(label_values, SHEET_LABEL_CONSTANTS.LGA)

    expected_columns = 7
    table_rows, header_row = read_xls_table(background_services_sheet, services_table_row_index, None, expected_columns)
    
    
    assert len(header_row) == expected_columns
    
    # print(header_row)
        
    if SHEET_BACKGROUND_SERVICES_CONSTANTS.SERVICES not in header_row:
        # Sometimes this is blank, but is after S/N
        sn_col_idx = header_row.index("s/n")
        if header_row[sn_col_idx+1].strip() == "":
            services_col_idx = sn_col_idx+1
        else:
            assert False
    else:            
        services_col_idx = header_row.index(SHEET_BACKGROUND_SERVICES_CONSTANTS.SERVICES)
    
    services_yes_no_col_idx = -1
    for col_idx, col_name in enumerate(header_row):
        # Is this facility providing this service? (Yes/No)
        if "providing" in col_name.lower() and "yes" in col_name.lower():
            services_yes_no_col_idx = col_idx 
            break 
        
    assert services_yes_no_col_idx >= 0

    
    day_of_service_col_idx = -1
    for col_idx, col_name in enumerate(header_row):
        if 'day' in col_name:
            day_of_service_col_idx = col_idx
            
    assert day_of_service_col_idx > services_col_idx
    
    services = []
    services_yes_no = []
    days_of_ri = None
    filtered_rows = []
    for row_idx, tr in enumerate(table_rows):
        
        assert len(tr) == expected_columns
        
        if len(tr[1].strip()) == 0:
            continue
        
        filtered_rows.append(tr)
        
        service_name = tr[services_col_idx]
        services.append(service_name)
        
        service_yes_no = tr[services_yes_no_col_idx]
        services_yes_no.append(service_yes_no)
        
        if service_name.lower() == 'routine immunization':
            days_of_ri = tr[day_of_service_col_idx]
    
    # ts = tabulate(filtered_rows, headers=header_row, tablefmt='orgtbl')
    # print(ts)
    
    sql = f"""
    INSERT INTO {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF}
    (name, lga, ward, 
    services, ri_days, file_path,
    services_yes_no, gmt_state, gmt_lga
    )
    VALUES (
        %s, %s, %s, 
        %s, %s, %s, 
        %s, %s, %s)
    RETURNING id
    """
    
    with conn.cursor() as cur:
        cur.execute(sql, (
            label_values.get(SHEET_BACKGROUND_SERVICES_CONSTANTS.HEALTH_FACILTY),
            label_values.get(SHEET_BACKGROUND_SERVICES_CONSTANTS.LGA),
            label_values.get(SHEET_BACKGROUND_SERVICES_CONSTANTS.WARD),
            services,
            days_of_ri,
            str(file_path),
            services_yes_no,
            gmt_state, 
            gmt_lga
        ))
        r = cur.fetchone()
        conn.commit()
        
    return r[0] 
    

def assert_label_value(label_values: Dict[str,str], key: str):
    
    if key not in label_values or not isinstance(label_values[key], str):
        pprint.pp(label_values)
        print(f"{key} missing")


def get_header_text_xls(row: List[CellWrapper]) -> List[str]:
    # [empty:'', text:'Name of Facility In Charge: __________________________', empty:'', text:'RABI IDRS MUSA', empty:'', text:'Phone Number: ________________________________', number:7037866529.0, empty:'']
    s = ""
    cell_text_list = []
    for cell in row:
        text = cell.get_cell_text().replace("_", "").strip()
        if len(text) <= 0:
            continue
        cell_text_list.append(text)

    return cell_text_list


def get_table_row(row) -> List[str]:
    # [empty:'', text:'Name of Facility In Charge: __________________________', empty:'', text:'RABI IDRS MUSA', empty:'', text:'Phone Number: ________________________________', number:7037866529.0, empty:'']
    s = ""
    cell_text_list = []
    for cell in row:
        text = cell.get_cell_text()
        text = normalize_whitespace(text).strip()
        
        cell_text_list.append(text)

    return cell_text_list


def find_row_with_value(sheet: SheetWrapper, searchText: str) -> Optional[int]:
    
    nrows = sheet.nrows
    
    for row_index in range(0, nrows):
        row = sheet.row(row_index)
        
        header_text_list = get_header_text_xls(row)

        if searchText in header_text_list:
            return row_index
        
    return None 
    



def normalize_whitespace(text: str) -> str:
    return re.sub(r'\s+', ' ', text)

def first_non_empty_index(lst: List[str]) -> Union[int, None]:
    
    if not lst:
        return None 
    
    for i, item in enumerate(lst):
        
        if item:
            return i 
        
    return None 


def first_empty_index(lst: List[str]) -> int:
    
    assert lst 
    
    for i, item in enumerate(lst):
        
        if len(item) == 0:
            return i 
        
    return len(lst)

def read_xls_table(sheet: SheetWrapper,
                   header_row_index1: int, 
                   header_row_index2: Optional[int],
                   number_columns: int
                   ) -> Tuple[ List[List[str]], List[str]]:
    """
    Whitespace normalized and values stripped of leading/trailing whitespace

    Assumption is header starts at 1st non empty column

    :param sheet:
    :param header_row_index1: 0 based index of header
    :param header_row_index2: in case there are 2 header rows
    :param number_columns:
    :return: table data, header row
    """
    
    header_row = get_table_row(sheet.row(header_row_index1))

    first_data_row_index = header_row_index1 + 1
    
    if header_row_index2 is not None:
        assert header_row_index2 > header_row_index1
        first_data_row_index = header_row_index2 + 1
        
        second_header_row = get_table_row(sheet.row(header_row_index2))
        
        header_row = [a + b for a, b in zip_longest(header_row, second_header_row, fillvalue='')]

    # lower case header row
    header_row = [s.lower() for s in header_row]
    
    # find index of first non empty cell
    first_table_col = first_non_empty_index(header_row)
    
    assert first_table_col is not None and first_table_col >= 0
    
    header_row = header_row[first_table_col:]
    
    # We assume all the headers have a value and that the first blank is where we stop
    #last_table_col = first_empty_index(header_row)
    
    header_row = header_row[0: number_columns]
    
    # since we stripped header_row first we need to add that back
    last_table_col = first_table_col + number_columns
    
    # print("Header row")
    # pprint.pp(header_row)
    
    table_rows = []
    
    for row_index in range(first_data_row_index, min(first_data_row_index+300, sheet.nrows)):
        
        row = sheet.row(row_index)
        # print(sh.row(row_index))

        table_row = get_table_row(row)
        table_row = table_row[first_table_col:last_table_col]
        
        # pprint.pp(table_row)
        table_rows.append(table_row)
        
    return table_rows, header_row
    

def add_key_value(label: str, value: str, key_values: Dict[str,str]):
        assert label 
        
        label = label.strip().lower()
        
        assert len(label) > 0
        
        assert value is not None 
        key_values[label] = value.strip()
        
        # workaround when health was missing from label
        if label == "facility":
            key_values[SHEET_BACKGROUND_SERVICES_CONSTANTS.HEALTH_FACILTY] = value.strip()


def gather_label_values(
    sheet: SheetWrapper,
    excel_path: Path,
    start_row_idx: int, stop_row_idx: int,
    start_col_idx: int, stop_col_idx: int,
                        ) -> Dict[str,str]:
    """
    :param sheet: 
    :param start_row_idx:  0 based
    :param stop_row_idx: 
    :param start_col_idx: 
    :param stop_col_id: 

    :return: label=>value stripped/trimmed
    """
    
    label_values: Dict[str,str] = {}
    
    # 3 types, inline label where we have label: value in 1 cell
    # label: and value in seperate cells same row
    # label:
    # value below
    
    # row, col
    offsets_to_try = [
        (0, -1), # left
        (-1, 0), # above
        (-1, -1),
        (0, -2),
        (1, -1) # in rare cases the label is below/left
    ]
    
    debug = False 
    
    for row_index in range(start_row_idx, stop_row_idx+1):
        for col_index in range(start_col_idx, stop_col_idx+1):
            c = sheet.cell(row_index, col_index)
            cell_text = trim_to_null( c.get_cell_text().replace("_", "") )
            if cell_text is None:
                continue 
            
            contains_label = ":" in cell_text 
            
            if contains_label:
                colon_pos = cell_text.index(":")
                assert colon_pos > 0
            
                label = cell_text[0: colon_pos]
                value = cell_text[colon_pos + 1:] or ""
                
                if len(value) > 0:
                    # Assume that no more text
                    add_key_value(label, value, label_values)
                
                continue 
            
            value = cell_text
            if debug:
                print(f"Finding label for {cell_text}")
            found = False 
            # here we have a value, we want to find the label, look to left and above
            for offset_row_idx, offset_col_idx in offsets_to_try:
                look_row = row_index + offset_row_idx
                look_col = col_index + offset_col_idx
                
                if look_row < start_row_idx or look_row > stop_row_idx:
                    continue 
                
                if look_col < start_col_idx or look_col > stop_col_idx:
                    continue 
                
                look_cell = sheet.cell(look_row, look_col)
                look_cell_text = trim_to_null(look_cell.get_cell_text().replace("_", ""))
                
                if look_cell_text is None:
                    continue 
                
                if debug:
                    print(f"Considering {look_cell_text}")
                
                if ":" in look_cell_text:
                    colon_pos = look_cell_text.index(":")
                    label = look_cell_text[0: colon_pos]
                    
                    # ignore label: value, so make sure : is at the end
                    if colon_pos == len(look_cell_text) - 1:
                        add_key_value(label, value, label_values)
                        found = True 
                        break 
                
            if not found and debug:
                print(f"Label not found for {value} in {excel_path}")
    
    return label_values