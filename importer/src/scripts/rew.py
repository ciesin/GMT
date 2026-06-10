import os
import psycopg2
import psycopg2.extensions
import psycopg2.extras
import queue
import shlex
import sys
from functools import partial
from pathlib import Path

import lib.db_utils as db_utils
import lib.thread_utils as thread_utils

from lib.thread_utils import run_process_stream_output
from scripts.create_views import get_db_name
from scripts.rew_module.rew_gmt_excel import modify_gmt_xlsx
from scripts.rew_module.rew_match_hf import match_gmt_hfs
from scripts.rew_module.rew_match_set import match_gmt_sets
from scripts.rew_module.rew_parse import DB_CONSTANTS, read_excel_rew


def db_connect():
    conn = psycopg2.connect(
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"]
    )
    
    name = get_db_name(conn)
    
    assert name == 'gmt'

    return conn


def setup_rew_tables(conn):
    
    db_utils.drop_schema(conn,  DB_CONSTANTS.SCHEMA_NAME)
    
    db_utils.create_schema(conn, DB_CONSTANTS.SCHEMA_NAME)
    
    sql = f"""
    --create extension pg_trgm;
    
    CREATE TABLE {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF}
    (
        id serial PRIMARY KEY,
        name text,
        file_path text NOT NULL UNIQUE,
        
        --These are the values in the spreadsheet
        lga text,
        ward text,
        
        --These are known in advance
        gmt_lga text NOT NULL,
        gmt_state text NOT NULL,
        
        services text[] NOT NULL,
        services_yes_no text[] NOT NULL,
        ri_days text,
        
        --GMT HF id
        global_id uuid
    );
    
    CREATE TABLE {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET}
    (
        id serial PRIMARY KEY,
        name text NOT NULL,
        hf_id int REFERENCES {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_HF} (id),
        
        --the target population fields
        
        total_pop int,
        type text, --urban rural
        problems text, --hard to reach / nomadic / riverine      
        
        --being the catchment area for services tab fields
        
        dist_fp text,
        dist_out text,
        dist_mobile text,
        
        sessions text, -- Type of Immunization Sessions (FS, OS1, OS2, etc.)
        ri_yes_no text,
        anc text,
        labour_delivery text,
        family_planning text,
        
        --sn GMT uuid
        --global_id uuid,
        
          
        --There are dups in the name
        UNIQUE(name, hf_id)
    );
    
    CREATE TABLE {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET_M2M}
    (
        set_id int NOT NULL REFERENCES {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} (id),
        global_id uuid NOT NULL,
        
        UNIQUE(set_id, global_id)
    )
    """
    db_utils.run_sql(conn, sql)
    



def show_not_in_set_tab(conn, lga_name: str, state_name: str):
    sql = f"""
    select b1.name, b2.name, b3.name, s.name, s.global_id, sn.uninhabited, sn.estimated_pop, sp.computed_pop

from {DB_CONSTANTS.SCHEMA_NAME}.{DB_CONSTANTS.TABLE_SET} s
inner join partitions.sn_view_latest sn  on sn.global_id = s.global_id
inner join partitions.sp_view_latest sp  on sp.global_id = sn.settlement_part
inner join boundary.polygon_latest b3 on b3.global_id = sn.boundary_polygon
inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
where s.global_id != '00000000-0000-0000-0000-000000000000'
--exclude if in catchment
and not exists (
    select 1 from partitions.hf_view_latest hf
    inner join boundary.polygon_latest b3 on b3.global_id = hf.boundary_polygon
    inner join boundary.polygon_latest b2 on b2.global_id = b3.boundary_polygon
    inner join boundary.polygon_latest b1 on b1.global_id = b2.boundary_polygon
    inner join partitions.ci_view_latest ci on ci.health_facility_point = hf.global_id and ci.type != 'exclude'
    inner join partitions.sp_view_latest sp  on sp.global_id = ci.settlement_part
    inner join partitions.sn_view_latest sn  on sn.settlement_part = sp.global_id
    WHERE b2.name = %(lga_name)s
        and b1.name = %(state_name)s
        and sn.global_id = s.global_id
)
order by global_id
 """
    with conn.cursor() as cur:
        cur.execute(sql, {
            'lga_name': lga_name,
            'state_name': state_name
        })

def main():
    
    # conn = db_connect()
    # read_excel_rew(Path("/data/rew/Dambatta/WOMEN CENTRE PHC.xlsx"), conn)
    # return 
    
    if len(sys.argv) > 1 and len(sys.argv[1]) > 1:
        gmt_state = sys.argv[1]
        gmt_lga = sys.argv[2]
        excel_to_parse = Path(sys.argv[3])
        # print(f"Calling with path [{excel_to_parse}]")
        conn = db_connect()
        read_excel_rew(excel_to_parse, conn, gmt_state, gmt_lga)
        return 
    
    lga_name_to_guid = {
        'Dambatta': 'ec14654c-7aef-43aa-b175-ae4ff47085e3',
        'Dawakin Kudu': 'e160b8d3-1042-49d2-9dcd-408036f51f95',
        'Dawakin Tofa': '2095f39b-4ebf-4b0a-a703-7b39f186cc90',
        'Gabasawa': '7bbe2df7-4977-48af-b660-327da884a3e9',
        'Gaya': '6d2bc6b8-7006-4098-8f68-6bd2315e4d35',
        'Ungogo': '8eeff76f-806e-41e4-9e40-b8ca45603649',
    }
    
    state_name = "Kano"
    #lga_name = "Dambatta"
    # lga_name = "Dawakin Kudu"
    #lga_name = "Dawakin Tofa"
    # lga_name = "Gabasawa"
    lga_name = "Gaya"
    # lga_name = "Ungogo"
    
    
    
    
    # Python script is started with s, do settlement matching
    if len(sys.argv) > 1 and sys.argv[1] == "s":
        for lga_name in lga_name_to_guid:
            # if lga_name != "Dawakin Tofa":
            #     continue 
            # set the partition.[hf,sn,sp,ci]_view_latest
            thread_utils.run_process_stream_output(
                "python3 create_views.py " + lga_name_to_guid[lga_name],
                cwd = '/src/scripts'
            )
            conn = db_connect()
            match_gmt_sets(conn, lga_name, state_name)
            conn.close()
        return 
    
    # this is done normally, match health facilities, re-entrant
    if len(sys.argv) > 1 and sys.argv[1] == "h":
        for lga_name in lga_name_to_guid:
            # set the partition.[hf,sn,sp,ci]_view_latest
            thread_utils.run_process_stream_output(
                "python3 create_views.py " + lga_name_to_guid[lga_name],
                cwd = '/src/scripts'
            )
            conn = db_connect()
            match_gmt_hfs(conn, lga_name, state_name)
            conn.close()
        return 
    
    if len(sys.argv) > 1 and sys.argv[1] == "e":
        for lga_name in lga_name_to_guid:
            # if lga_name != "Gaya":
            #     continue
            # set the partition.[hf,sn,sp,ci]_view_latest
            thread_utils.run_process_stream_output(
                "python3 create_views.py " + lga_name_to_guid[lga_name],
                cwd = '/src/scripts'
            )
            conn = db_connect()
            modify_gmt_xlsx(conn, lga_name)
            conn.close()
        return 
    
    conn = db_connect()
    setup_rew_tables(conn)
    
    for lga_name in lga_name_to_guid:
    
        # set the partition.[hf,sn,sp,ci]_view_latest
        thread_utils.run_process_stream_output(
            "python3 create_views.py " + lga_name_to_guid[lga_name],
            cwd = '/src/scripts'
        )

        rew_input_dir = Path(r"/data/rew") / lga_name
        
        #rew_input_dir = Path(r"/data/rew/Dawakin Kudu")
            
        f_count = 0

        task_queue = queue.Queue()
        task_count = 0

        to_queue = []
        for f in rew_input_dir.rglob("*"):

            if not f.is_file or f.suffix.lower() not in (".xls", ".xlsx"):
                continue
            
            if f.name.startswith("~"):
                continue
            
            to_queue.append(f)
            
        to_queue.sort()
        
        for f in to_queue:
            print(f"Queuing {f}")

            f_count += 1
            
            # Once these have all been converted, we shouldn't need to do this check
            # if f.suffix.lower() == ".xls" and zipfile.is_zipfile(f):
            #     print(f"Zip file detected, probably xlsx!")
                
            #     new_file_path = f.with_suffix(".xlsx")
            #     f = f.rename(new_file_path)

            # task_queue.put(partial(read_excel_rew, f))
            cmd_parts = [
                    'python3', 
                    'rew.py', 
                    shlex.quote(state_name),
                    shlex.quote(lga_name),
                    shlex.quote(str(f))]
            task_queue.put(partial(
                run_process_stream_output,
                ' '.join(cmd_parts),  cwd = '/src/scripts'
                ))

            task_count += 1
            
            # if f_count > 1:
            #     break
        
        # it is 3x faster to run the excel parsing in a seperate python process
        thread_utils.finish_threads_with_context(task_queue = task_queue,
                                        fn_context_create = None,
                                        max_num_processes = 4,
                                        num_items_in_queue= task_count,
                                        fn_cleanup=None
                                        )
        
    # match_gmt_hfs(conn, lga_name)
    
    # match_gmt_sets(conn, lga_name)
    
    if False:       
        thread_utils.finish_threads_with_context(task_queue = task_queue,
                                       fn_context_create = lambda _i: {'conn': db_connect()} ,
                                       max_num_processes = 4,
                                       num_items_in_queue= task_count,
                                       fn_cleanup=lambda context: context['conn'].close()
                                       )


if __name__ == "__main__":
    main()
