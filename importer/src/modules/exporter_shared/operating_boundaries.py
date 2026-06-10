import os
import uuid
from functools import cached_property
from typing import List

from psycopg.sql import SQL, Literal as SqlLiteral, Composed
from pydantic import BaseModel, Field

from lib.async_db_utils import ConnType, fetch_log, PoolConn
from modules.exporter_shared.gmt_db_objects import GeneralDbNames, ExportDbNames

BOUNDARY_OPERATING_LEVEL = int(os.environ.get("OPERATIONAL_BOUNDARY_LEVEL", 3))
# how for to pad extent when finding surrounding boundaries
EXTENT_PADDING_METERS = 3000


class OperatingBoundary(BaseModel):
    global_id: uuid.UUID
    code: str
    name: str

    partition_id: int

    hierarchy_guids: List[uuid.UUID] = Field(
        description="child => parent order up to country"
    )
    hierarchy_names: List[str] = Field(description="Like hierarchy_guids but names")

    is_surrounding: bool = Field(
        description="False if directly linked via attribute, True if this is in the surrounding boundaries"
    )

    participating: bool = Field(description="False if null")

    def __repr__(self) -> str:
        return " / ".join(reversed(self.hierarchy_names))

    def __str__(self) -> str:
        return self.__repr__()

    #
    @cached_property
    def partition_id_str(self) -> str:
        return str(self.partition_id).zfill(5)


async def get_operating_boundaries(
    conn: PoolConn, boundary_id_list: List[uuid.UUID]
) -> List[OperatingBoundary]:
    """
    Fetches operating boundary level

    boundary guids in boundary_id_list can be any level

    This fetches operating boundaries in the extended extent
    """

    sql = (
        SQL("""
WITH extended_extents AS (
        {extended_extents}
    ),
    parent_boundaries AS (
        {parent_boundaries}
    ),
    attributed_boundaries AS (
        {attributed_boundaries}
    )
SELECT
    op_b.global_id,
    upper(op_b.code) as code,
    op_b.name,
    bid.id as partition_id,    
    -- country => this level 
    pb.parent_guids as hierarchy_guids,
    pb.parent_names as hierarchy_names,
    ab.global_id IS NULL as is_surrounding,    
    COALESCE((op_b.properties->'participating')::boolean, False) as participating
FROM parent_boundaries pb
INNER JOIN {boundary} op_b 
    ON op_b.global_id = 
        pb.parent_guids[1]
INNER JOIN {bid} bid 
    ON bid.global_id = op_b.global_id 
LEFT JOIN attributed_boundaries ab 
    ON ab.global_id = op_b.global_id   

                """)
        .format(
            extended_extents=extended_extents(boundary_id_list),
            boundary=GeneralDbNames.BOUNDARY_POLYGON_LATEST.as_identifier(),
            attributed_boundaries=attributed_boundaries(boundary_id_list),
            parent_boundaries=parent_boundaries(),
            bid=GeneralDbNames.BOUNDARY_ID.as_identifier(),
        )
        .as_string()
    )

    recs = await fetch_log(conn, sql)

    return [OperatingBoundary(**dict(r)) for r in recs]


def attributed_boundaries(boundary_ids: List[uuid.UUID]) -> Composed:
    return SQL("""
WITH RECURSIVE boundaries AS (
    
    SELECT 
    	global_id, boundary_polygon, LEVEL    	
    FROM {boundary}
    WHERE global_id IN ( {boundary_ids} )

    UNION ALL

    -- Recursively get children
    SELECT 
    	c.global_id,     	
    	c.boundary_polygon, 
    	c.LEVEL
    FROM {boundary} c
    INNER JOIN boundaries p ON c.boundary_polygon = p.global_id
    WHERE p.LEVEL = c.LEVEL - 1
)
SELECT DISTINCT global_id FROM boundaries
WHERE level = {operating_level}               
               """).format(
        boundary=GeneralDbNames.BOUNDARY_POLYGON_LATEST.as_identifier(),
        operating_level=SqlLiteral(BOUNDARY_OPERATING_LEVEL),
        boundary_ids=SQL(", ").join([SqlLiteral(b_id) for b_id in boundary_ids]),
    )


def extended_extents(boundary_ids: List[uuid.UUID]) -> Composed:
    return SQL("""
SELECT ST_Transform(ST_SetSRID(
            ST_MakeBox2D(
                ST_Point(
                    ST_XMin(sb.geom_envelope) - {meters},
                    ST_YMin(sb.geom_envelope) - {meters}
                ),
                ST_Point(
                    ST_XMax(sb.geom_envelope) + {meters},
                    ST_YMax(sb.geom_envelope) + {meters}
                )
            ), 3857), 4326) as geom
        FROM {boundary} b
        CROSS JOIN LATERAL (
            SELECT ST_Transform(ST_Envelope(b.geom), 3857)
            as geom_envelope
        ) sb
        WHERE b.global_id IN ( {boundary_ids} )    
               """).format(
        boundary=GeneralDbNames.BOUNDARY_POLYGON_LATEST.as_identifier(),
        meters=SqlLiteral(EXTENT_PADDING_METERS),
        boundary_ids=SQL(", ").join([SqlLiteral(b_id) for b_id in boundary_ids]),
    )


def parent_boundaries() -> Composed:
    return SQL("""
       
WITH RECURSIVE boundaries AS (
    -- Start with Alice
    SELECT 
    	boundary_polygon, LEVEL, 
    	ARRAY[global_id] AS parent_guids,
    	ARRAY[name] AS parent_names
    FROM {boundary}    
    WHERE global_id IN
    (
        SELECT b.global_id
        FROM {boundary} b,
            extended_extents ee
        WHERE ST_Intersects(ee.geom, b.geom)
        AND b.level = {operating_level}
    )

    UNION ALL

    -- Recursively get parents
    SELECT 
    	p.boundary_polygon, 
    	p.LEVEL, 
    	--Returns level 0 - 3 order  	
    	b.parent_guids || p.global_id AS parent_guids,
		b.parent_names || p.name AS parent_names
    FROM {boundary} p
    INNER JOIN boundaries b ON b.boundary_polygon = p.global_id
    WHERE p.LEVEL = b.LEVEL - 1
)
SELECT * FROM boundaries
--when we get to top level, we have all parents 
WHERE level = 0
    
               """).format(
        boundary=GeneralDbNames.BOUNDARY_POLYGON_LATEST.as_identifier(),
        operating_level=SqlLiteral(BOUNDARY_OPERATING_LEVEL),
    )


async def create_boundary_table(
    conn: ConnType, op_b_list: List[OperatingBoundary]
) -> None:
    create_sql = (
        SQL(
            """   
    DROP TABLE IF EXISTS {boundary};
    
    -- boundary.polygon definition
    CREATE TABLE {boundary} (
        global_id uuid PRIMARY KEY,    
        hierarchy_names text[] NOT NULL,
        hierarchy_guids uuid[] NOT NULL,        
        partition_id int NOT NULL,
        participating bool NOT NULL,
        is_surrounding bool NOT NULL
    );
                """
        )
        .format(boundary=ExportDbNames.BOUNDARY.as_identifier())
        .as_string()
    )

    await conn.execute(create_sql)

    await conn.copy_records_to_table(
        table_name=ExportDbNames.BOUNDARY.table_name,
        schema_name=ExportDbNames.BOUNDARY.schema_name,
        columns=[
            "global_id",
            "hierarchy_names",
            "hierarchy_guids",
            "partition_id",
            "participating",
            "is_surrounding",
        ],
        records=[
            (
                op_b.global_id,
                op_b.hierarchy_names,
                op_b.hierarchy_guids,
                op_b.partition_id,
                op_b.participating,
                op_b.is_surrounding,
            )
            for op_b in op_b_list
        ],
    )
