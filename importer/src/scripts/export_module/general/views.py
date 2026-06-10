from scripts.export_module.db_constants import *
import psycopg2.extensions


def create_view_with_filter_helper(
    conn: psycopg2.extensions.connection,
    indicator_name: str,
    source_table_name: str,
    short_name_map: Dict[str, str],
    sql_where_clause: str,
) -> bool:
    """
    For views that just need a simple filter 
    """
    view_name = short_name_map[indicator_name]

    view_sql = f"""
        CREATE VIEW {SCHEMA_EXPORT}.{view_name} AS
        SELECT a.* FROM {SCHEMA_EXPORT}.{source_table_name} a 
        WHERE {sql_where_clause}
        """
    with conn.cursor() as cur:
        cur.execute(view_sql)
        conn.commit()

    return True


def lateral_boundary_join(level: int, alias: str) -> str:
    return f"""
    LEFT JOIN LATERAL (
        SELECT b{level}.name 
        FROM boundary.polygon_latest b{level}
        WHERE b{level}.level = {level}
        AND ST_Intersects({alias}.geom, b{level}.geom)
        LIMIT 1
    ) b{level}_geo ON True
    """


def exists_select(base_view_or_table: str, alias: str, additional_where: str="") -> str:
    return f"""
    EXISTS (
        SELECT 1 
        FROM {SCHEMA_EXPORT}.{base_view_or_table} g
        WHERE g.global_id = {alias}.global_id 
            {additional_where}
    )
    """


def db_round(field: str, places: int, field_as: Optional[str] = None) -> str:
    if field_as is None:
        field_as = field
        if "." in field:
            last_dot_pos = field.rfind(".")
            field_as = field[last_dot_pos+1:]

    return f"""
    ROUND( CAST({field} AS numeric), {places} ) AS {field_as}
    """
