# coding=utf-8
import logging

import psycopg2
import psycopg2.extras
from psycopg2.sql import SQL, Literal


log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__ )



def get_geometry_column_info(conn, schema_name, table_name):
    sql = SQL("""
	SELECT column_name, g.type as geometry_type, g.srid 
	FROM information_schema.columns c 
	INNER JOIN public.geometry_columns g 
	    ON  g.f_geometry_column = c.column_name
	WHERE c.table_name = {} AND c.table_schema = {}
	--done for speed, if in inner join its super slow
	AND g.f_table_name = {} AND g.f_table_schema = {}
	""").format(
        Literal(table_name),
        Literal(schema_name),
        Literal(table_name),
        Literal(schema_name)
    )

    # cur = conn.cursor(cursor_factory=psycopg2.extras.NamedTupleCursor)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    #trace_log.debug(sql.as_string(cur))
    cur.execute(sql, (table_name, schema_name))

    recs = cur.fetchall()

    #trace_log.debug(f"Num records {len(recs)}")

    if (lr := len(recs)) > 1:
        raise Exception("Multiple geometry columns not supported")
    elif lr == 1:
        return recs[0]
    else:
        return None





