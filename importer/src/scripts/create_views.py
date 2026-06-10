import sys
import os
from typing import List
from urllib.parse import urlparse, parse_qs
import psycopg2

# These views are to aggregrate around a boundary for easier querying
# nothing to do with export views

# Function to extract the database name from the connection object
def get_db_name(conn) -> str:
    # Extract the dsn string
    dsn = conn.dsn
    # print(dsn)
    params = parse_qs(dsn.replace(" ", "&"))
    # Get the dbname from the parsed parameters
    db_name = params.get('dbname', [None])[0]
    return db_name
    # for a db conn str
    # Parse the dsn string to get the database name
    # parsed_dsn = urlparse(dsn)
    # print(parsed_dsn)
    # db_name = parsed_dsn.path.lstrip('/')
    # return db_name

def create_helper_views(target_conn, only_latest: bool, view_boundary_guid_list: List[str]):
    """
    Creates views partitions.(sn,hf,ci,sp)_view[_latest]
    """
    db_name = get_db_name(target_conn)
    # if db_name not in ["gmt", "gmt_test", ]:
    if db_name not in ["gmt", "gmt_training"]:
        raise Exception(f"Not creating partition views in non local {db_name}")
    else:
        print(f"Creating partition views in {db_name}")


    if only_latest:
        only_latest_sql = "|| '_latest)'"
        view_suffix = "_latest"
    else:
        only_latest_sql = "|| ')'"
        view_suffix = ""

    b_in_list = ", ".join([f"'{b_id}'" for b_id in view_boundary_guid_list])

    sql = f"""

do $$
    declare
    myrow record;
begin
        drop view if exists partitions.sp_view{view_suffix};
        drop view if exists partitions.hf_view{view_suffix};
        drop view if exists partitions.sn_view{view_suffix};
        drop view if exists partitions.ci_view{view_suffix};
for myrow in
SELECT
     'create view partitions.sp_view{view_suffix} as ' || string_agg(sp, ' union all ') as spv,
       'create view partitions.sn_view{view_suffix} as ' || string_agg(sn, ' union all ') as snv,
       'create view partitions.hf_view{view_suffix} as ' || string_agg(hf, ' union all ') as hfv,
       'create view partitions.ci_view{view_suffix} as ' || string_agg(ci, ' union all ') as civ

FROM (

    WITH extended_extent AS
    (
        SELECT ST_Transform(ST_SetSRID(
            ST_MakeBox2D(
                ST_Point(
                    ST_XMin(sb.geom_envelope) - 3000,
                    ST_YMin(sb.geom_envelope) - 3000
                ),
                ST_Point(
                    ST_XMax(sb.geom_envelope) + 3000,
                    ST_YMax(sb.geom_envelope) + 3000
                )
            ), 3857), 4326) as geom 
        FROM boundary.polygon_latest b
        CROSS JOIN LATERAL (
            SELECT ST_Transform(ST_Envelope(b.geom), 3857) 
            as geom_envelope
        ) sb
        WHERE b.global_id IN ({b_in_list})
    )
    select '(select * from partitions_settlement_part.settlement_part_' || lpad(id::text, 5, '0') {only_latest_sql} as sp,
        '(select * from partitions_settlement_name.settlement_name_' || lpad(id::text, 5, '0') {only_latest_sql} as sn,
        '(select * from partitions_ri_catchment_item.ri_catchment_item_' || lpad(id::text, 5, '0') {only_latest_sql} as ci,
        '(select * from partitions_health_facility_point.health_facility_point_' || lpad(id::text, 5, '0') {only_latest_sql} as hf
    from partitions.boundary_id b
    inner join boundary.polygon_latest p
    on p.global_id = b.global_id
    where p.level = 3 and
    b.global_id IN (
                    SELECT b.global_id
        from boundary.polygon_latest b,
             extended_extent ee
        where ST_Intersects(ee.geom, b.geom)


    )
) sq
loop
execute myrow.spv;
execute myrow.snv;
execute myrow.hfv;
execute myrow.civ;
end loop;
end;
$$;
"""

    with target_conn.cursor() as target_cur:
        target_cur.execute(sql)

    target_conn.commit()

def main():
    dest_conn = psycopg2.connect(
        dbname=os.environ.get("DEST_DB_NAME", "gmt"),
        user=os.environ.get("DEST_DB_USER", "postgres"),
        password=os.environ.get("DEST_DB_PASSWORD", "postgres"),
        host=os.environ.get("DEST_DB_HOST", "db"),
        port=os.environ.get("DEST_DB_PORT", "5432")
    )

    # ec14654c-7aef-43aa-b175-ae4ff47085e3,Dambatta
    # e160b8d3-1042-49d2-9dcd-408036f51f95,Dawakin Kudu
    # 2095f39b-4ebf-4b0a-a703-7b39f186cc90,Dawakin Tofa
    # 7bbe2df7-4977-48af-b660-327da884a3e9,Gabasawa
    # 6d2bc6b8-7006-4098-8f68-6bd2315e4d35,Gaya
    # 8eeff76f-806e-41e4-9e40-b8ca45603649,Ungogo


    boundary_guid = "ec14654c-7aef-43aa-b175-ae4ff47085e3"
    
    if len(sys.argv) > 1 and len(sys.argv[1]) > 1:
        boundary_guid = sys.argv[1].strip()
    
    create_helper_views(dest_conn, True, [boundary_guid])
    create_helper_views(dest_conn,False, [boundary_guid])

    # investigate_fixed_post("f810039e-2a19-40fc-958f-07bfe90c6fb8")
    sys.exit(0)

if __name__ == "__main__":
    main()