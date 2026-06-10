from scripts.export_module.db_constants import *
import psycopg2.extensions
import scripts.export_module.indicator_constants as ic
from scripts.export_module.db_export import db_connect


def check_disjoint(
    conn: psycopg2.extensions.connection,
        table_or_view1, table_or_view2):
    """

    :param table_or_view1:
    :param table_or_view2:
    :return:
    """
    sql = f"""
    SELECT tv1.global_id FROM 
    {SCHEMA_EXPORT}.{table_or_view1} tv1 
    INNER JOIN 
    {SCHEMA_EXPORT}.{table_or_view2} tv2
    ON tv1.global_id = tv2.global_id
    """

    with conn.cursor() as cur:
        print(sql)
        cur.execute(sql)

        rows = cur.fetchall()

        if len(rows) > 0:
            raise Exception(f"{table_or_view1} and {table_or_view2} are not disjoint but should be")


def check_subset(
        conn: psycopg2.extensions.connection,
        table_or_view1, table_or_view2):
    """
    Every row in 1 is in 2
    :param table_or_view1:
    :param table_or_view2:
    :return:
    """
    sql = f"""
    SELECT tv1.global_id FROM 
    {SCHEMA_EXPORT}.{table_or_view1} tv1 
    LEFT JOIN 
    {SCHEMA_EXPORT}.{table_or_view2} tv2
    ON tv1.global_id = tv2.global_id
    WHERE tv2.global_id IS NULL
    """

    with conn.cursor() as cur:
        cur.execute(sql)

        rows = cur.fetchall()

        if len(rows) > 0:
            raise Exception(f"{table_or_view1} is not a subset of {table_or_view2} but should be")


def db_checks():
    set_short_name_map = ic.build_set_short_name_map()
    conn, _baseline_conn = db_connect()

    """
    Checks db is coherent for things we can't do a constraint for
    """
    # new and before pilot are disjoint
    check_disjoint(
        conn,
        set_short_name_map[ic.IND_NEW_SETTLEMENTS_ADDED_IN_GMT],
        set_short_name_map[ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_BEFORE_PILOT])

    # deleted is subset of before
    check_subset(
        conn,
        set_short_name_map[ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_DELETED_OR_DEMOTED],
        set_short_name_map[ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_BEFORE_PILOT])

    # new is subset of after
    check_subset(
        conn,
        set_short_name_map[ic.IND_NEW_SETTLEMENTS_ADDED_IN_GMT],
        set_short_name_map[ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_AFTER_PILOT])

    # deleted and after are disjoint
    check_disjoint(
        conn,
        set_short_name_map[ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_DELETED_OR_DEMOTED],
        set_short_name_map[ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_AFTER_PILOT])

    # new & deleted are disjoint
    check_disjoint(
        conn,
        set_short_name_map[ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_DELETED_OR_DEMOTED],
        set_short_name_map[ic.IND_NEW_SETTLEMENTS_ADDED_IN_GMT])

    # before pilot - deleted + new = after pilot
    table_before_pilot = set_short_name_map[ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_BEFORE_PILOT]
    table_after_pilot = set_short_name_map[ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_AFTER_PILOT]
    table_new = set_short_name_map[ic.IND_NEW_SETTLEMENTS_ADDED_IN_GMT]
    table_del = set_short_name_map[ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_DELETED_OR_DEMOTED]
    sql = f"""
    with a_calc AS (
    SELECT global_id FROM {SCHEMA_EXPORT}.{table_before_pilot} b
    UNION
    SELECT global_id FROM {SCHEMA_EXPORT}.{table_new} n
    EXCEPT
    SELECT global_id FROM {SCHEMA_EXPORT}.{table_del} d

) select a1.global_id, a2.global_id from  a_calc a1
full outer join {SCHEMA_EXPORT}.{table_after_pilot} a2 ON a1.global_id = a2.global_id
where a1.global_id is null or a2.global_id is null
    """

    with conn.cursor() as cur:
        cur.execute(sql)

        rows = cur.fetchall()

        if len(rows) > 0:
            raise Exception(f"settlements before pilot - deleted + new = after pilot check failed")

    hf_short_name_map = ic.build_hf_short_name_map()

    # FP RI / Not RI = before pilot + new fp - deleted
    check_disjoint(
        conn,
        hf_short_name_map[ic.IND_FP_NOT_DOING_RI],
        hf_short_name_map[ic.IND_FP_THAT_ARE_DOING_RI],
    )

    check_disjoint(
        conn,
        hf_short_name_map[ic.IND_FP_BEFORE_PILOT],
        hf_short_name_map[ic.IND_FP_NEW],
    )

    check_subset(
        conn,
        hf_short_name_map[ic.IND_FP_DELETED],
        hf_short_name_map[ic.IND_FP_BEFORE_PILOT]
    )
