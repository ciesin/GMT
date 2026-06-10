import os
import logging
import psycopg2
from psycopg2.sql import SQL
from lib import db_utils
from sys import stdout


def simplify_boundaries(filter=None):

    # DB connection
    DB_HOST = os.environ.get("DB_HOST")                 # subu07
    DB_PORT = os.environ.get("DB_PORT")                 # 12432
    DB_NAME = os.environ.get("DB_NAME")
    DB_USER = os.environ.get("DB_ADMIN_USER")           # postgres
    DB_PASSWORD = os.environ.get("DB_ADMIN_PASSWORD")   #

    # Table / view to build from
    BOUNDARY_TABLE = 'boundary.polygon_latest'

    db_uri = f'''
        host={DB_HOST} 
        port={DB_PORT} 
        dbname={DB_NAME} 
        user={DB_USER} 
        password={DB_PASSWORD}
    '''

    # For testing only (restrict simplification to a certain extent)
    # filter = [7.8, 11.3, 9.2, 12.7]
    # filter = [7.6, 6.0, 8.6, 6.9]
    # filter = [6.6,5.0,9.4,7.6]
    # filter = [2.9,2.7,12.3,11.2]

    # Logger
    logger = logging.getLogger('simplifier')
    logger.setLevel(logging.DEBUG)
    logFormatter = logging.Formatter('  %(asctime)s %(levelname)-8s %(message)s')
    consoleHandler = logging.StreamHandler(stdout)
    consoleHandler.setFormatter(logFormatter)
    logger.addHandler(consoleHandler)

    try:
        logger.info(f'Connecting to database "{os.environ.get("DB_NAME")}@{os.environ.get("DB_HOST")}:{os.environ.get("DB_PORT")}"')
        with psycopg2.connect(db_uri) as connection:
            logger.info(f'Simplifying polygons in table "{BOUNDARY_TABLE}"')

            # Get the lowest level of boundaries
            query = SQL(f"""
                SELECT
                    max(p.level)
                FROM {BOUNDARY_TABLE} p
            """)
            BOUNDARY_LEVEL = int(db_utils.get_single_value(connection, query))
            logger.info(f'Starting with polygons at level {BOUNDARY_LEVEL}')

            # Get the max extent of the boundaries if there is no filter
            if not filter:
                query = SQL(f"""
                    SELECT
                        ST_AsText(ST_Envelope(ST_Union(ST_Envelope(geom)))) AS extent
                    FROM
                        {BOUNDARY_TABLE} p
                    WHERE
                        p.level = {BOUNDARY_LEVEL};
                """)
                BOUNDARY_EXTENT = db_utils.get_single_value(connection, query)
                logger.info(f'Using the maximum extent of all polygons')
            else:
                BOUNDARY_EXTENT = f'''
                    POLYGON((
                        {filter[0]} {filter[1]},
                        {filter[0]} {filter[3]},
                        {filter[2]} {filter[3]},
                        {filter[2]} {filter[1]},
                        {filter[0]} {filter[1]}
                    ))
                '''
                logger.info(f'Using the following extent filter "{filter}"')

            # Count the amount of original polygons
            query = SQL(f"""
                SELECT
                    count(*)
                FROM
                    {BOUNDARY_TABLE} p
                WHERE
                    p.level = {BOUNDARY_LEVEL}
                AND
                    ST_Intersects(ST_SetSRID(ST_GeomFromText('{BOUNDARY_EXTENT}'), 4326), p.geom);
            """)
            BOUNDARY_LEVEL_COUNT = db_utils.get_single_value(connection, query)

            # Create a simplified copy of all boundaries of level 3
            BOUNDARY_LEVEL_TABLE = f'{BOUNDARY_TABLE}_level_{BOUNDARY_LEVEL}_snapped'
            query = SQL(f"""
                DROP INDEX IF EXISTS polygon_level_{BOUNDARY_LEVEL}_gist;
                DROP TABLE IF EXISTS {BOUNDARY_LEVEL_TABLE};
                CREATE TABLE
                    {BOUNDARY_LEVEL_TABLE}
                AS SELECT DISTINCT ON (p.global_id)
                    p.global_id,
                    p.boundary_polygon,
                    p.version_id,
                    p.name,
                    p.level,
                    (ST_DUMP(ST_SnapToGrid(geom, 0.001))).geom AS geom
                FROM
                    {BOUNDARY_TABLE} p
                WHERE
                    p.level = {BOUNDARY_LEVEL}
                -- AND p.is_deleted = FALSE
                AND
                    ST_Intersects(ST_SetSRID(ST_GeomFromText('{BOUNDARY_EXTENT}'), 4326), p.geom)
                ORDER BY
                    p.global_id,
                    p.version_id DESC;
                ALTER TABLE
                    {BOUNDARY_LEVEL_TABLE}
                ADD COLUMN
                    id SERIAL PRIMARY KEY;
                CREATE INDEX
                    polygon_level_{BOUNDARY_LEVEL}_gist
                ON
                    {BOUNDARY_LEVEL_TABLE}
                USING gist(geom);
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            count_query = SQL(f"""
                SELECT
                    count(*)
                FROM
                    {BOUNDARY_LEVEL_TABLE} p
            """)
            logger.info(f'Created {db_utils.get_single_value(connection, count_query)} simplified polygons in "{BOUNDARY_LEVEL_TABLE}" from {BOUNDARY_LEVEL_COUNT} original polygons')

            # Fix problems in the snapped geometries
            query = SQL(f"""
                DELETE FROM
                    {BOUNDARY_LEVEL_TABLE}
                WHERE
                    ST_area(geom) = 0;
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            logger.info(f'Removed zero (area) geometries from "{BOUNDARY_LEVEL_TABLE}"')

            # Buffer to remove any self-intersecting polygon vertices
            query = SQL(f"""
                UPDATE
                    {BOUNDARY_LEVEL_TABLE}
                SET
                    geom = ST_Buffer(ST_MakeValid(geom), 0)
                WHERE NOT
                    ST_IsEmpty(ST_Buffer(geom, 0))
                AND NOT
                    ST_IsEmpty(ST_MakeValid(geom));
                UPDATE
                    {BOUNDARY_LEVEL_TABLE}
                SET
                    geom = ST_Buffer(ST_MakeValid(geom), 0)
                WHERE
                    ST_IsEmpty(ST_Buffer(geom, 0));
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            logger.info(f'Removing polygon vertices self intersection problems in "{BOUNDARY_LEVEL_TABLE}"')

            # Add dangling self intersecting polygons to their neighbour polygons
            query = SQL(f"""
                WITH
	                neighbours AS (
                        SELECT DISTINCT ON
                            (s.id)
                            s.id AS small_id,
                            p.id AS poly_id,
                            s.geom AS dangle,
                            st_makevalid(p.geom) AS poly
                        FROM
                            (
                                SELECT
                                    d.id,
                                    d.geom
                                FROM (
                                    SELECT
                                        e.id,
                                        (ST_Dump(e.geom)).geom
                                    FROM (
                                        SELECT
                                            id,
                                            ST_CollectionExtract(ST_MakeValid(geom), 3) AS geom
                                        FROM
                                            {BOUNDARY_LEVEL_TABLE} pls
                                    ) AS e
                                ) AS d
                            WHERE
                                st_area(d.geom) <= 0.001*0.001
                            ) AS s
                        INNER JOIN
                            (
                                SELECT
                                    id,
                                    geom
                                FROM
                                    {BOUNDARY_LEVEL_TABLE}
                                WHERE
                                    st_area(geom) > 0.001*0.001
                            ) AS p
                        ON
                            st_intersects(st_buffer(s.geom, 0.001), p.geom) AND
                            s.id != p.id
                    )
                UPDATE
                    {BOUNDARY_LEVEL_TABLE} b
                SET
                    geom = ST_Union(neighbours.dangle, neighbours.poly)
                FROM
                    neighbours
                WHERE
                    b.id = neighbours.poly_id;
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            logger.info(f'Transferred dangling polygon artifacts to neighbour polygons in "{BOUNDARY_LEVEL_TABLE}"')

            # Remove dangling self intersecting polygons from their original polygons
            query = SQL(f"""
                UPDATE
                    {BOUNDARY_LEVEL_TABLE} bt
                SET
                    geom = c.geom
                FROM
                    (
                        SELECT DISTINCT
                            ON(s.id)
                            s.id,
                            s.geom
                        FROM
                            (
                                SELECT
                                    d.id,
                                    d.geom
                                FROM
                                    (
                                        SELECT
                                            e.id,
                                            (ST_Dump(e.geom)).geom
                                        FROM
                                            (
                                                SELECT
                                                    id,
                                                    ST_CollectionExtract(ST_MakeValid(geom), 3) AS geom
                                                FROM
                                                    {BOUNDARY_LEVEL_TABLE}
                                                WHERE NOT
                                                    ST_IsEmpty(ST_MakeValid(geom))
                                            ) AS e
                                    ) AS d
                            ) AS s
                        ORDER BY
                            s.id ASC,
                            ST_Area(s.geom) DESC
                    ) AS c
                WHERE
                    bt.id = c.id
                AND
                    ST_Area(bt.geom) - ST_Area(c.geom) < 3*0.001*0.001;
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            logger.info(f'Removed dangling polygon artifacts from their original polygons in "{BOUNDARY_LEVEL_TABLE}"')



            # Remove any polygon that is completely contained by another
            query = SQL(f"""
                DELETE FROM
                    {BOUNDARY_LEVEL_TABLE}
                WHERE
                    id
                IN (
                    SELECT
                        b.id AS id
                    FROM
                        {BOUNDARY_LEVEL_TABLE} a
                    INNER JOIN
                        {BOUNDARY_LEVEL_TABLE} b
                    ON
                        ST_Contains(a.geom, b.geom)
                    AND
                        a.id != b.id
                );
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            logger.info(f'Removing any polygons from "{BOUNDARY_LEVEL_TABLE}" that are contained by another (Remaining {db_utils.get_single_value(connection, count_query)})')

            # Remove any overlapping parts
            BOUNDARY_LEVEL_TABLE_CLEANED = f'{BOUNDARY_TABLE}_level_{BOUNDARY_LEVEL}_cleaned'
            query = SQL(f"""
                DROP TABLE IF EXISTS
                    {BOUNDARY_LEVEL_TABLE_CLEANED};
                CREATE TABLE
                    {BOUNDARY_LEVEL_TABLE_CLEANED}
                AS SELECT
                    id,
                    global_id,
                    ST_Difference(geom, (
                        SELECT
                            ST_Union(b.geom)
                        FROM
                            {BOUNDARY_LEVEL_TABLE} b
                        WHERE
                            ST_Intersects(a.geom, b.geom)
                        AND
                            a.id != b.id
                    )) AS geom
                FROM
                    {BOUNDARY_LEVEL_TABLE} a;
                WITH overlapping AS
                    (
                        SELECT
                            CASE
                                WHEN ST_Area(a.geom) <= ST_Area(b.geom) THEN a.global_id
                                WHEN ST_Area(a.geom) > ST_Area(b.geom) THEN b.global_id
                            END global_id,
                            ST_Buffer(ST_Intersection(a.geom, b.geom),0) AS geom
                        FROM
                            {BOUNDARY_LEVEL_TABLE} a,
                            {BOUNDARY_LEVEL_TABLE} b
                        WHERE
                            ST_Intersects(a.geom, b.geom)
                        AND
                            ST_Area(ST_Intersection(a.geom, b.geom)) > 0
                        AND
                            a.id != b.id
                    )
                UPDATE
                    {BOUNDARY_LEVEL_TABLE_CLEANED} c
                SET
                    geom = ST_Union(c.geom, o.geom)
                FROM
                    overlapping o
                WHERE
                    c.global_id = o.global_id;
                ALTER TABLE
                    {BOUNDARY_LEVEL_TABLE_CLEANED}
                ADD COLUMN
                    simple_geom geometry(POLYGON, 4326);
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            logger.info(f'Cleaned any overlapping parts in "{BOUNDARY_LEVEL_TABLE_CLEANED}"')

            # Make a check if we have any invalid geometries remaining
            query = SQL(f"""
                SELECT
                    count(id)
                FROM
                    {BOUNDARY_LEVEL_TABLE_CLEANED}
                WHERE
                    st_isvalidreason(geom) != 'Valid Geometry';
            """)
            if int(db_utils.get_single_value(connection, query)) > 0:
                logger.info(f'Warning: {db_utils.get_single_value(connection, query)} invalid geometries found in "{BOUNDARY_LEVEL_TABLE_CLEANED}" (This should be fixed)')
            else:
                logger.info(f'No invalid geometries found in "{BOUNDARY_LEVEL_TABLE_CLEANED}"')

            # Create a topology
            TOPOLOGY = f'topology_level_{BOUNDARY_LEVEL}'
            query = SQL(f"""
                SELECT
                    topology.DropTopology('{TOPOLOGY}')
                WHERE EXISTS
                    (
                        SELECT
                            *
                        FROM
                            topology.topology t
                        WHERE
                            t.name = '{TOPOLOGY}'
                    );
                SELECT topology.CreateTopology('{TOPOLOGY}', 4326, 0);
                SELECT
                    ST_CreateTopoGeo('{TOPOLOGY}',
                    ST_Collect(ST_SnapToGrid(geom,0.001)))
                FROM
                    {BOUNDARY_LEVEL_TABLE_CLEANED};
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            logger.info(f'Created topology "{TOPOLOGY}" from polygons in "{BOUNDARY_LEVEL_TABLE_CLEANED}"')

            # Create a simplified version of the topology
            TOPOLOGY_SIMPLE = f'topology_level_{BOUNDARY_LEVEL}_simple'
            query = SQL(f"""
                SELECT
                    topology.DropTopology('{TOPOLOGY_SIMPLE}')
                WHERE EXISTS
                    (
                        SELECT
                            *
                        FROM
                            topology.topology t
                        WHERE
                            t.name = '{TOPOLOGY_SIMPLE}'
                    );
                SELECT topology.CreateTopology('{TOPOLOGY_SIMPLE}', 4326, 0);
                SELECT
                    ST_CreateTopoGeo('{TOPOLOGY_SIMPLE}', geom)
                FROM
                    (
                        SELECT
                            ST_Collect(ST_SimplifyPreserveTopology(geom, 0.005)) AS geom
                        FROM
                            {TOPOLOGY}.edge_data
                    ) AS t;
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            logger.info(f'Created simplified topology "{TOPOLOGY_SIMPLE}" of topology "{TOPOLOGY}"')

            # Update geometries with simplified topology by area match
            BOUNDARY_LEVEL_TABLE_SIMPLIFIED = f'{BOUNDARY_TABLE}_level_{BOUNDARY_LEVEL}_simplified'
            query = SQL(f"""
                DROP TABLE IF EXISTS {BOUNDARY_LEVEL_TABLE_SIMPLIFIED};
                CREATE TABLE
                    {BOUNDARY_LEVEL_TABLE_SIMPLIFIED}
                AS SELECT
                    s.geom
                FROM
                    (
                        SELECT
                            st_getFaceGeometry('{TOPOLOGY_SIMPLE}', face_id) as geom
                        FROM
                            {TOPOLOGY_SIMPLE}.face
                        WHERE face_id > 0
                    ) AS s;
                WITH simple_face AS (
                    SELECT
                        st_getFaceGeometry('{TOPOLOGY_SIMPLE}', face_id) as geom
                    FROM
                        {TOPOLOGY_SIMPLE}.face
                    WHERE face_id > 0
                ) UPDATE
                    {BOUNDARY_LEVEL_TABLE_CLEANED} b
                SET
                    simple_geom = sf.geom
                FROM
                    simple_face sf
                WHERE
                    st_intersects(b.geom, sf.geom) AND
                    st_area(st_intersection(sf.geom, b.geom))/st_area(sf.geom) > 0.5;
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            logger.info(f'Updated boundary polygons in "{BOUNDARY_LEVEL_TABLE_CLEANED}" with simplified polygons of topology "{TOPOLOGY_SIMPLE}"')

            # Fill holes in simplified polygons
            query = SQL(f"""
                WITH gaps AS (
	                SELECT
	                    (ST_DumpRings(u.geom)).geom
                    FROM
                        (
                            SELECT
                                (ST_Dump(ST_Union(simple_geom))).geom AS geom
                            FROM
                                {BOUNDARY_LEVEL_TABLE_CLEANED}
                        ) AS u
                    ORDER BY
                        ST_Area(u.geom) DESC
                    OFFSET 1
                )
                INSERT INTO
	                {BOUNDARY_LEVEL_TABLE_CLEANED}
	                (global_id, simple_geom)
                SELECT
                    c.global_id,
                    g.geom
                FROM
                    gaps g,
                    {BOUNDARY_LEVEL_TABLE_CLEANED} c
                WHERE
                    ST_Area(st_intersection(g.geom, c.geom))/ST_Area(g.geom) > 0.5;
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            logger.info(f'Filled missing gaps in "{BOUNDARY_LEVEL_TABLE_CLEANED}"')

            # Create simplified table from simplified polygons
            TABLE_SIMPLIFIED = 'boundary.polygon_simplified'
            query = SQL(f"""
                CREATE TABLE IF NOT EXISTS
                    {TABLE_SIMPLIFIED}
                    (
                        global_id uuid NOT NULL,
                        boundary_polygon uuid NOT NULL,
                        geom geometry(MultiPolygon,4326) NOT NULL,
                        name text,
                        level smallint NOT NULL
                    );
                TRUNCATE {TABLE_SIMPLIFIED};
                INSERT INTO
                    {TABLE_SIMPLIFIED}
                SELECT
                    b.global_id,
                    b.boundary_polygon,
                    s.geom,
                    b.name,
                    b.level
                FROM
                    (
                        SELECT
                            c.global_id,
                            ST_Multi(ST_Union(c.simple_geom)) AS geom
                        FROM
                            {BOUNDARY_LEVEL_TABLE_CLEANED} c
                        GROUP BY
                            c.global_id
                    ) AS s
                INNER JOIN
                    (
                        SELECT
                            p.global_id,
                            p.name,
                            p.boundary_polygon,
                            p.level
                        FROM
                            {BOUNDARY_TABLE} p
                    ) AS b
                ON
                    s.global_id = b.global_id
                WHERE
	                geom IS NOT NULL;
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            count_query = SQL(f"""
                SELECT
                    count(*)
                FROM
                    {TABLE_SIMPLIFIED} p
            """)
            logger.info(f'Wrote {db_utils.get_single_value(connection, count_query)} simplified polygons to final output table "{TABLE_SIMPLIFIED}"')

            # Build parent boundaries
            for i in list(range(0, BOUNDARY_LEVEL))[::-1]:
                logger.info(f'Creating boundaries for boundary level {i}')
                query = SQL(f"""
                    INSERT INTO
                        {TABLE_SIMPLIFIED}
                    SELECT
                        p.global_id,
                        p.boundary_polygon,
                        s.geom,
                        p.name,
                        {i}
                    FROM
                        (
                            SELECT
                                boundary_polygon,
                                ST_Multi(ST_MakePolygon(St_ExteriorRing((ST_Dump(ST_Union(geom))).geom))) AS geom
                            FROM
                                {TABLE_SIMPLIFIED}
                            GROUP BY
                                boundary_polygon
                        ) AS s
                    INNER JOIN
                        (
                            SELECT
                                global_id,
                                boundary_polygon,
                                name
                            FROM
                                {BOUNDARY_TABLE}
                            WHERE
                                level = {i}
                        ) AS p
                    ON
                        s.boundary_polygon = p.global_id;
                    -- Union polygons with the same global_id
                    UPDATE
	                    {TABLE_SIMPLIFIED} s
                    SET
	                    geom = u.geom
                    FROM 
                        (
                            SELECT 
                                global_id,
                                ST_Multi(ST_Union(geom)) AS geom
                            FROM 
                                {TABLE_SIMPLIFIED} 
                            WHERE 
                                level = {i}
                            GROUP BY 
                                global_id
                        ) AS u 
                    WHERE
                        s.global_id = u.global_id;
                    -- Remove doubles which we created in the update before
                    DELETE FROM
                        {TABLE_SIMPLIFIED}
                    WHERE
                        ctid NOT IN (
                            SELECT DISTINCT ON (global_id) 
                                ctid
                            FROM
                                {TABLE_SIMPLIFIED}
                            WHERE level = {i}
                        )
                    AND
                        level = {i};
                """)
                db_utils.execute_sql(connection, query)
                connection.commit()
                count_query = SQL(f"""
                    SELECT
                        count(*)
                    FROM
                        {TABLE_SIMPLIFIED} s
                    WHERE
                        s.level = {i}
                """)
                logger.info(f'Wrote {db_utils.get_single_value(connection, count_query)} simplified polygons for level {i} to final output table "{TABLE_SIMPLIFIED}"')

            # Refresh materialized view
            MATERIALIZED_VIEW_SIMPLIFIED = 'boundary.polygon_simplified_latest'
            query = SQL(f"""REFRESH MATERIALIZED VIEW {MATERIALIZED_VIEW_SIMPLIFIED};""")
            db_utils.execute_sql(connection, query)
            connection.commit()
            logger.info(f'Updated the materialized view')

            # Clean up
            query = SQL(f"""
                DROP INDEX IF EXISTS polygon_level_{BOUNDARY_LEVEL}_gist;
                DROP TABLE IF EXISTS {BOUNDARY_LEVEL_TABLE};
                DROP TABLE IF EXISTS {BOUNDARY_LEVEL_TABLE_CLEANED};
                DROP TABLE IF EXISTS {BOUNDARY_LEVEL_TABLE_SIMPLIFIED};
                SELECT topology.DropTopology('{TOPOLOGY}');
                SELECT topology.DropTopology('{TOPOLOGY_SIMPLE}')
            """)
            db_utils.execute_sql(connection, query)
            connection.commit()
            logger.info(f'Removed temporary tables and topologies')

    except psycopg2.Error as e:
        logger.info(f'Database error: "{e.diag.message_primary}"')
