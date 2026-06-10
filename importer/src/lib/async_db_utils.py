import asyncio
import json
import logging
from typing import (
    Optional,
    Union,
    LiteralString,
    cast,
    Tuple,
    List,
    Dict,
    Annotated,
    Literal as LiteralTyping,
    Set,
    TYPE_CHECKING,
)
import asyncpg
from asyncpg import PostgresError, Record
from pydantic import Field, BaseModel, StringConstraints, field_validator
from psycopg.sql import SQL, Identifier, Literal, Literal as LiteralSql, Composed
import sqlglot
import sqlglot.optimizer

log = logging.getLogger(__name__)
trace_log = logging.getLogger(__name__ + "_trace")


PostgresqlIdentifier = Annotated[
    str,
    StringConstraints(
        min_length=1,
        max_length=63,  # PostgreSQL max identifier length
    ),
]


if TYPE_CHECKING:
    #     # At runtime this fails with a cannot subscript error
    PoolType = asyncpg.Pool[asyncpg.Record]
    ConnType = asyncpg.Connection[asyncpg.Record]
#     PoolType = asyncpg.Pool
#     ConnType = asyncpg.Connection
#
else:
    PoolType = asyncpg.Pool
    ConnType = asyncpg.Connection

PoolConn = Union[ConnType, PoolType]


class SchemaTable(BaseModel):
    schema_name: PostgresqlIdentifier = Field(description="Schema name")
    table_name: PostgresqlIdentifier = Field()

    def with_column_name(self, column_name: str) -> "SchemaTableColumn":
        return SchemaTableColumn(
            schema_name=self.schema_name,
            table_name=self.table_name,
            column_name=column_name,
        )

    def as_identifier(self) -> Identifier:
        return Identifier(self.schema_name, self.table_name)

    def __str__(self) -> str:
        return f"{self.schema_name}.{self.table_name}"


class SchemaTableColumn(SchemaTable):
    column_name: PostgresqlIdentifier = Field()

    def get_schema_table(self) -> SchemaTable:
        return SchemaTable(
            schema_name=self.schema_name,
            table_name=self.table_name,
        )

    def __str__(self) -> str:
        return f"{self.schema_name}.{self.table_name}.{self.column_name}"


class SchemaView(BaseModel):
    schema_name: PostgresqlIdentifier = Field(description="Schema name")
    view_name: PostgresqlIdentifier = Field()

    def __str__(self) -> str:
        return f"{self.schema_name}.{self.view_name}"

    def as_identifier(self) -> Identifier:
        return Identifier(self.schema_name, self.view_name)

    def with_table_column(self, column_name: str) -> SchemaTableColumn:
        return SchemaTableColumn(
            schema_name=self.schema_name,
            table_name=self.view_name,
            column_name=column_name,
        )


async def table_exists(
    conn: PoolConn,
    schema_table: SchemaTable,
) -> bool:
    sql = (
        SQL(
            """SELECT 1 FROM information_schema.tables WHERE table_name = {} AND table_schema = {}
            AND table_type = 'BASE TABLE'
            """
        )
        .format(Literal(schema_table.table_name), Literal(schema_table.schema_name))
        .as_string()
    )

    results = await conn.fetch(sql)

    result_count = len(results)

    return result_count > 0


async def view_exists(
    conn: PoolConn,
    schema_view: SchemaView,
) -> bool:
    sql = (
        SQL(
            """SELECT 1 FROM information_schema.tables WHERE table_name = {} AND table_schema = {}
            AND table_type = 'VIEW'
            """
        )
        .format(Literal(schema_view.view_name), Literal(schema_view.schema_name))
        .as_string()
    )

    results = await conn.fetch(sql)

    result_count = len(results)

    return result_count > 0


async def drop_table(
    conn: PoolConn,
    schema_table: SchemaTable,
    cascade: bool = False,
) -> None:
    sql = (
        SQL(
            """
		DROP TABLE IF EXISTS {}
		"""
        )
        .format(Identifier(schema_table.schema_name, schema_table.table_name))
        .as_string()
    )

    if cascade:
        sql += " CASCADE"

    await conn.execute(sql)


async def truncate_table(
    conn: PoolConn,
    schema_table: SchemaTable,
    cascade: bool = False,
) -> None:
    sql = (
        SQL(
            """
        TRUNCATE TABLE {} 
        """
        )
        .format(Identifier(schema_table.schema_name, schema_table.table_name))
        .as_string()
    )

    if cascade:
        sql += " CASCADE"

    await conn.execute(sql)


async def create_schema(
    conn: PoolConn,
    schema_name: str,
    comment: Union[str, None] = None,
) -> None:
    sql = (
        SQL(
            """
        CREATE SCHEMA IF NOT EXISTS {schema_name};

        """
        )
        .format(schema_name=Identifier(schema_name))
        .as_string()
    )

    await conn.execute(sql)

    if comment:
        sql = (
            SQL(
                """
        COMMENT ON SCHEMA {} IS {}
        """
            )
            .format(Identifier(schema_name), Literal(comment))
            .as_string()
        )

    await conn.execute(sql)


async def drop_schema(
    conn: PoolConn,
    schema_name: str,
    cascade: bool = True,
) -> str:
    log.info(f"Dropping schema {schema_name}")

    # Cleanup any existing tables
    table_names = await conn.fetch(
        SQL(
            """
    SELECT table_name FROM information_schema.tables
    where table_schema = {}
    AND table_type != 'VIEW'
    """
        )
        .format(Literal(schema_name))
        .as_string()
    )
    if table_names is None:
        table_names = []
    table_names_strs: List[str] = [t[0] for t in table_names]

    # do this as cascade deleting the schema can be too long
    for table_name in table_names_strs:
        log.debug(f"Dropping table {table_name}")
        await drop_table(
            conn,
            SchemaTable(schema_name=schema_name, table_name=table_name),
            cascade=cascade,
        )

    # use cascade to also delete any views that may be present
    return await conn.execute(
        SQL(
            """
    DROP SCHEMA IF EXISTS {} {}
    """
        )
        .format(Identifier(schema_name), SQL("CASCADE" if cascade else ""))
        .as_string()
    )


async def add_foreign_key(
    conn: PoolConn,
    src: SchemaTableColumn,
    ref: SchemaTableColumn,
    add_on_delete_cascade: bool = False,
    add_index: bool = False,
) -> str:
    # Normally this does nothing since the FK ref is a PK
    await add_unique_constraint(
        conn,
        ref,
    )

    # Do this first since if the FK exists, we still want the index
    if add_index:
        await create_index(conn, target=src, is_geom=False)

    existing_constraints = await get_constraints(
        conn, src.get_schema_table(), column_name=src.column_name
    )

    # log.debug("Existing constraints: %i", len(existing_constraints))

    for c in existing_constraints:
        if c.constraint_type != "f":
            continue

        log.info(
            (
                f"FK constraint already exists on {src.schema_name}.{src.table_name}.{src.column_name} =>"
                f" {ref.schema_name}.{ref.table_name}.{ref.column_name}\n{c}"
            )
        )

        return "Constraint already exists"

    sql = (
        SQL(
            """
    ALTER TABLE {}
    ADD FOREIGN KEY({}) REFERENCES {} ({})
      """
        )
        .format(
            Identifier(src.schema_name, src.table_name),
            Identifier(src.column_name),
            Identifier(ref.schema_name, ref.table_name),
            Identifier(ref.column_name),
        )
        .as_string()
    )

    if add_on_delete_cascade:
        sql = sql + " ON DELETE CASCADE"

    # log.debug(sql)

    ret = await conn.execute(sql)

    return ret


async def create_index(
    conn: PoolConn,
    target: SchemaTableColumn,
    is_geom: bool = False,
    check_if_index_exists: bool = True,
) -> str:
    """ """

    # log.debug(f"Add index {target}")

    if check_if_index_exists:
        index_records = await get_indexes(
            conn,
            target=target,
            column_name=target.column_name,
        )
        # trace_log.debug("Found %i existing indexes" % (len(index_records),))

        # Note that as perf. of multi column index not the same, it only counts if its the same column set
        for idx in index_records:
            if idx.column_names != [target.column_name]:
                continue
            exists_str = f"Existing index {index_records[0]}"
            # log.debug(exists_str)
            return exists_str

    index_name = "idx_%s_%s_%s" % (
        target.schema_name,
        target.table_name,
        target.column_name,
    )
    index_name = index_name.lower()

    index_type: LiteralString = "BTREE"
    if is_geom:
        index_type = "GIST"

    sql = (
        SQL("CREATE INDEX {} ON {} USING {} ({}) ")
        .format(
            Identifier(index_name),
            Identifier(target.schema_name, target.table_name),
            SQL(index_type),
            Identifier(target.column_name),
        )
        .as_string()
    )

    # log.debug(sql)
    await conn.execute(sql)
    return index_name


async def add_multi_column_unique_constraint(
    conn: PoolConn, target: SchemaTable, column_names: List[str]
) -> str:
    assert len(column_names) > 0
    existing_indexes = await get_indexes(
        conn=conn,
        target=target,
        # multi one will match
        column_name=column_names[0],
    )

    for index in existing_indexes:
        if not index.is_primary_key and not index.is_unique:
            continue

        if set(column_names) == set(index.column_names):
            return f"Existing index found {index}"

    return await conn.execute(
        SQL(
            """
        ALTER TABLE {}
        ADD UNIQUE ({});
          """
        )
        .format(
            target.as_identifier(),
            SQL(", ").join([Identifier(column_name) for column_name in column_names]),
        )
        .as_string()
    )


async def add_unique_constraint(
    conn: PoolConn,
    src: SchemaTableColumn,
) -> str:
    return await add_multi_column_unique_constraint(
        conn, src.get_schema_table(), [src.column_name]
    )


class IndexInfo(BaseModel):
    index_name: str = Field()
    # schema_table: SchemaTable

    is_primary_key: bool = False
    is_unique: bool = False

    column_names: List[str] = Field(min_length=1)

    index_type: LiteralTyping["gist", "btree"] = Field()

    def __str__(self) -> str:
        """
        Returns a string representation of the IndexInfo object.

        The string representation includes the index name, type, and a list of column names.
        For primary keys and unique indexes, additional information is included.

        Example:
            - Primary key index on "id" column: `PRIMARY KEY index "id"`
            - Unique index on "email" column: `UNIQUE index "idx_email" on "email"`
            - GIST index on "location" column: `GIST index "idx_location" on "location"`
            - B-tree index on multiple columns: `B-tree index "idx_composite" on ("column1", "column2")`

        Returns:
            str: The string representation of the IndexInfo object.
        """

        index_type_str = self.index_type.upper()
        column_names_str = ", ".join(f'"{col}"' for col in self.column_names)

        if self.is_primary_key:
            return f"PRIMARY KEY index {column_names_str}"
        elif self.is_unique:
            return (
                f"UNIQUE {index_type_str} index {self.index_name} on {column_names_str}"
            )
        else:
            return f"{index_type_str} index {self.index_name} on {column_names_str}"


async def get_index_records(
    conn: PoolConn,
    schema_table: SchemaTable,
    column_name: Optional[str] = None,
) -> List[Record]:
    """
    This is for indexes only, not constraints.
    """

    sql = (
        SQL(
            """
SELECT    
    i.relname AS index_name, 
    ARRAY_AGG(a.attname ORDER BY a.attname) AS column_names,
    ix.indisunique AS is_unique,
    ix.IndIsPrimary as is_primary_key,
    am.amname AS index_type
FROM pg_index ix 
LEFT JOIN pg_class i 
    ON i.oid = ix.indexrelid
LEFT JOIN pg_class t 
    ON t.oid = indrelid
LEFT JOIN pg_namespace n 
    ON n.oid = t.relnamespace
--For multi column indexes this can join several    
INNER JOIN pg_attribute a 
    ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
LEFT JOIN pg_am am 
    ON i.relam = am.oid
WHERE n.nspname = {schema}
    AND t.relname = {table}
GROUP BY
    i.relname, ix.indisunique, ix.indisprimary, am.amName  
--Done this way since a multi column index just needs one column to match    
HAVING SUM(CASE WHEN a.attname = COALESCE({column}, a.attname) THEN 1 ELSE 0 END) > 0;      
    """
        )
        .format(
            schema=Literal(schema_table.schema_name),
            table=Literal(schema_table.table_name),
            column=Literal(column_name),
        )
        .as_string()
    )

    # log.debug(sql)

    rows = await conn.fetch(sql)

    return rows


async def get_indexes(
    conn: PoolConn,
    target: SchemaTable,
    column_name: Optional[str] = None,
) -> List[IndexInfo]:
    """ """

    rows = await get_index_records(conn, target, column_name)

    ret = [IndexInfo(**r) for r in rows]

    return ret


async def drop_indexes_on_column(conn: PoolConn, target: SchemaTableColumn) -> None:
    indexes = await get_indexes(conn, target.get_schema_table(), target.column_name)
    log.debug(f"Found {len(indexes)} indexes on {target}")
    for i in indexes:
        sql = (
            SQL("DROP INDEX {}")
            .format(Identifier(target.schema_name, i.index_name))
            .as_string()
        )
        log.debug(sql)
        await conn.execute(sql)


class ConstraintInfo(BaseModel):
    constraint_name: str = Field()
    # schema_table: SchemaTable

    column_names: List[str] = Field(min_length=0)

    # primary, unique, check, foreign key
    constraint_type: Optional[LiteralTyping["u", "p", "c", "f"]] = Field(default=None)

    @field_validator("constraint_type", mode="before")
    def bytes_to_str(cls, value: Union[str, bytes, None]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, bytes):
            return value.decode("utf-8")  # Convert bytes to str
        assert isinstance(value, str)
        return value

    definition: str = Field(
        examples=[
            "FOREIGN KEY (fk1) REFERENCES test_schema.test_table2(id)",
            "PRIMARY KEY (id)",
            "CHECK (((srid > 0) AND (srid <= 998999)))",
        ]
    )

    target_schema: Optional[PostgresqlIdentifier] = Field(
        description="For foreign keys", default=None
    )
    target_table: Optional[PostgresqlIdentifier] = Field(
        description="For foreign keys", default=None
    )
    target_columns: Optional[List[PostgresqlIdentifier]] = Field(
        description="For foreign keys", default=None
    )

    def __str__(self) -> str:
        """
        Returns a string representation of the ConstraintInfo object.

        The string representation includes the constraint name, type, and a list of involved columns.
        For foreign key constraints, the target table and columns are also included.

        Example:
            - Primary key constraint: `PRIMARY KEY constraint "pk_id" on "id"`
            - Unique constraint: `UNIQUE constraint "uq_email" on "email"`
            - Check constraint: `CHECK constraint "ck_age" with expression "age > 18"`
            - Foreign key constraint: `FOREIGN KEY constraint "fk_order_customer" from "order_id" to "customer_id" in "customers" table`

        Returns:
            str: The string representation of the ConstraintInfo object.
        """

        if self.constraint_type == "p":
            return f"PRIMARY KEY constraint {self.constraint_name} on {', '.join(self.column_names)}"
        elif self.constraint_type == "u":
            return f"UNIQUE constraint {self.constraint_name} on {', '.join(self.column_names)}"
        elif self.constraint_type == "c":
            return f"CHECK constraint {self.constraint_name} with expression {self.definition}"
        elif self.constraint_type == "f":
            assert self.target_columns is not None
            return f"FOREIGN KEY constraint {self.constraint_name} from {', '.join(self.column_names)} to {', '.join(self.target_columns)} in {self.target_table} table"
        else:
            return f"Constraint {self.constraint_name}: {self.definition}"


async def get_constraint_records(
    conn: PoolConn,
    schema_table: SchemaTable,
    column_name: Optional[str] = None,
) -> List[Record]:
    """ """

    sql = (
        SQL(
            """
select 
    con.conname as constraint_name,
    con.contype as constraint_type, --p, c, p
    --t.relname as table_name,
    --n.nspname as schema_name,
    array_agg(DISTINCT c.attname ORDER BY c.attname) as column_names,
    pg_get_constraintdef(con.oid) AS definition,
    n2.nspname AS target_schema,            -- Schema of the target table
    t2.relname AS target_table,             -- Target table name
    CASE
        --to avoid {{null}} 
        WHEN COUNT(c2.attname) = 0 THEN NULL
    ELSE
        array_agg(DISTINCT c2.attname order by c2.attname)
    END as target_columns
FROM pg_constraint con
LEFT JOIN
    pg_class t ON t.oid = con.conrelid    -- Join with pg_class to get the table name
LEFT JOIN
    pg_namespace n ON n.oid = t.relnamespace
LEFT JOIN
    pg_attribute c ON c.attnum = ANY(con.conkey) AND c.attrelid = con.conrelid
LEFT JOIN
    pg_class t2 ON t2.oid = con.confrelid   -- Target table
LEFT JOIN
    pg_namespace n2 ON n2.oid = t2.relnamespace -- Target schema
LEFT JOIN
    pg_attribute c2 ON c2.attnum = ANY(con.confkey)
        AND c2.attrelid = con.confrelid -- Target column
WHERE n.nspname = {schema}
    AND t.relname = {table}
GROUP BY 
    con.conname, con.contype, 
    con.oid, n2.nspname, t2.relname
--Done this way since a multi column index just needs one column to match    
HAVING SUM(CASE WHEN c.attname = COALESCE({column}, c.attname) THEN 1 ELSE 0 END) > 0;       
"""
        )
        .format(
            schema=Literal(schema_table.schema_name),
            table=Literal(schema_table.table_name),
            column=Literal(column_name),
        )
        .as_string()
    )

    # log.debug(sql)

    rows = await conn.fetch(sql)

    return rows


async def get_constraints(
    conn: PoolConn,
    target: SchemaTable,
    column_name: Optional[str] = None,
) -> List[ConstraintInfo]:
    """ """

    rows = await get_constraint_records(conn, target, column_name)

    ret = [ConstraintInfo(**r) for r in rows]

    return ret


def create_where_statement(where_statement: Optional[str]) -> SQL:
    if not isinstance(where_statement, str) or len(where_statement) == 0:
        return SQL("")

    where_statement = where_statement.lstrip()
    # we don't want to modify full string to lower case
    if (
        not where_statement.startswith("where")
        and not where_statement.startswith("WHERE")
    ) and where_statement != "":
        where_statement = " WHERE " + where_statement
    return SQL(cast(LiteralString, where_statement))  # type: ignore[redundant-cast]


def create_and_where_statement(where_statement: Optional[str]) -> SQL:
    if not isinstance(where_statement, str) or len(where_statement) == 0:
        return SQL("")

    where_statement = where_statement.lstrip()
    where_statement = " AND " + where_statement
    return SQL(cast(LiteralString, where_statement))  # type: ignore[redundant-cast]


async def get_chunks(
    conn: PoolConn,
    table_name: str,
    id_field: str = "id",
    schema_name: str = "postgis",
    chunk_size: int = 10000,
    where_statement: str = "",
) -> List[Tuple[int, int]]:
    """
    Improved function of get_chunks where we don't have to query for each chunk
    return list of lists with the format [[in start_offset value, int stop_offset value]]

    These are inclusive, non overlapping ranges

    """
    sql = (
        SQL(
            """
WITH numbered_ids AS 
(
    --Row number starts at 1
    SELECT {id_field}, 
    ROW_NUMBER() OVER (ORDER BY {id_field}) AS row_num
    FROM {schema_table}
    {where_statement}
),
chunked_ids AS (
    SELECT
        {id_field},
        row_num,
        FLOOR((row_num - 1) / {chunk_size}) AS chunk_num
    FROM
        numbered_ids
)
SELECT
    MIN({id_field}) AS range_start,
    MAX({id_field}) AS range_stop
FROM
    chunked_ids
GROUP BY
    chunk_num
ORDER BY
    range_start;
"""
        )
        .format(
            id_field=Identifier(id_field),
            schema_table=Identifier(schema_name, table_name),
            where_statement=create_where_statement(where_statement),
            chunk_size=Literal(chunk_size),
        )
        .as_string()
    )

    id_values = await conn.fetch(sql)
    log.info(f"# of chunks for {table_name} is {len(id_values)}")

    tuples = [tuple(row.values()) for row in id_values]
    return tuples


# Returns true if table has rows in it, if clean is true will remove them
async def check_clean_table(
    conn: PoolConn,
    clean: bool,
    target: SchemaTable,
    cascade: bool = False,
) -> bool:
    if not await table_exists(conn, target):
        return False

    if clean:
        await conn.execute(
            SQL("TRUNCATE TABLE {} {}")
            .format(
                Identifier(target.schema_name, target.table_name),
                SQL("CASCADE") if cascade else SQL(""),
            )
            .as_string()
        )

    row_count = await conn.fetchval(
        SQL("""SELECT COUNT(*) FROM {}""")
        .format(
            Identifier(target.schema_name, target.table_name),
        )
        .as_string()
    )
    assert isinstance(row_count, int)

    if row_count > 0:
        log.info(
            f"Already {row_count} rows in {target.schema_name}.{target.table_name}, skipping step"
        )
        return True

    return False


async def check_clean_table_where(
    conn: PoolConn,
    clean: bool,
    schema_table: SchemaTable,
    where_clause: str,
) -> bool:
    if clean:
        await conn.execute(
            SQL("DELETE FROM {} {}")
            .format(
                Identifier(schema_table.schema_name, schema_table.table_name),
                create_where_statement(where_clause),
            )
            .as_string()
        )

    row_count = await conn.fetchval(
        SQL("""SELECT COUNT(*) FROM {} {}""")
        .format(
            Identifier(schema_table.schema_name, schema_table.table_name),
            create_where_statement(where_clause),
        )
        .as_string()
    )
    assert isinstance(row_count, int)

    if row_count > 0:
        log.info(
            f"Already {row_count} rows in "
            f"{schema_table.schema_name}.{schema_table.table_name} "
            f"with {where_clause}, skipping step"
        )
        return True

    return False


async def get_row_count(
    conn: PoolConn,
    target: SchemaTable,
    return_value_on_table_not_exist: int = -1,
    where_clause: str = "",
) -> int:
    if not await table_exists(conn, target):
        return return_value_on_table_not_exist

    sql = (
        SQL(
            """
    SELECT count(*) FROM {} {}
    """
        )
        .format(
            Identifier(target.schema_name, target.table_name),
            create_where_statement(where_clause),
        )
        .as_string()
    )

    v = await conn.fetchval(sql)
    assert isinstance(v, int)

    return v


async def get_row_count_for_view(
    conn: PoolConn,
    target: SchemaView,
    return_value_on_table_not_exist: int = -1,
    where_clause: str = "",
) -> int:
    if not await get_view_info(conn, target):
        mvi = get_mat_view_info(conn, target)

        if not mvi:
            return return_value_on_table_not_exist

    sql = (
        SQL(
            """
    SELECT count(*) FROM {} {}
    """
        )
        .format(
            target.as_identifier(),
            create_where_statement(where_clause),
        )
        .as_string()
    )

    v = await conn.fetchval(sql)
    assert isinstance(v, int)

    return v


async def add_column(
    conn: PoolConn,
    target: SchemaTableColumn,
    column_type: LiteralString,
) -> None:
    sql = (
        SQL(
            """
     ALTER TABLE {schema_name}.{table_name} 
     ADD COLUMN IF NOT EXISTS {column_name} {column_type};
     """
        )
        .format(
            schema_name=Identifier(target.schema_name),
            table_name=Identifier(target.table_name),
            column_name=Identifier(target.column_name),
            column_type=SQL(column_type),
        )
        .as_string()
    )

    await conn.execute(sql)


async def get_schemas(
    conn: PoolConn,
) -> List[str]:
    """
    Get list of all schemas for conn db
    :param conn:
    :return:
    """

    sql = SQL("""SELECT schema_name FROM information_schema.schemata;""").as_string()
    results = await conn.fetch(sql)

    return [r[0] for r in results]


async def schema_exists(conn: PoolConn, schema_name: str) -> bool:
    sql = (
        SQL(
            """ SELECT 1 FROM information_schema.schemata WHERE schema_name = {schema_name};"""
        )
        .format(schema_name=Literal(schema_name))
        .as_string()
    )

    ret = await conn.fetch(sql)

    result_count = len(ret)

    return result_count > 0


async def refresh_materialized_view(conn: PoolConn, target: SchemaView) -> None:
    sql = (
        SQL(
            """
    REFRESH MATERIALIZED VIEW {}
    """
        )
        .format(Identifier(target.schema_name, target.view_name))
        .as_string()
    )

    await conn.execute(sql)


async def get_column_names(conn: PoolConn, target: SchemaTable) -> List[str]:
    """
    Works with views, mat views, and columns
    """
    recs = await conn.fetch(
        SQL(
            """
SELECT
    --c.relname,
    --c.relkind,
    --n.nspname AS schema_name,
    a.attname AS column_name
    --pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_value,
    --a.atttypid::regtype AS data_type,
    --a.attnotnull AS is_not_null
FROM
    pg_catalog.pg_attribute a
INNER JOIN pg_catalog.pg_class c 
    ON a.attrelid = c.oid
INNER JOIN pg_catalog.pg_namespace n 
    ON c.relnamespace = n.oid  -- Join to get schema information
LEFT JOIN pg_catalog.pg_attrdef d 
    ON a.attnum = d.adnum AND d.adrelid = c.oid
WHERE
    c.relname = {table_name} 
    AND n.nspname = {schema_name}
    AND c.relkind IN ('r', 'v', 'm')    -- 'v' for views, 'm' for materialized views
    AND a.attnum > 0               -- Exclude system columns
    AND NOT a.attisdropped
    """
        )
        .format(
            table_name=Literal(target.table_name),
            schema_name=Literal(target.schema_name),
        )
        .as_string()
    )

    if recs is None:
        return []

    return [r[0] for r in recs]


async def set_columns_to_not_null(
    conn: PoolConn,
    target: SchemaTable,
    not_null_columns: List[str],
) -> str:
    assert len(not_null_columns) > 0

    sql = (
        SQL(
            """
    ALTER TABLE {target} {alter}
    """
        )
        .format(
            target=Identifier(target.schema_name, target.table_name),
            alter=SQL(",\n").join(
                [
                    SQL("ALTER COLUMN {c} SET NOT NULL").format(c=Identifier(c))
                    for c in not_null_columns
                ]
            ),
        )
        .as_string()
    )

    return await conn.execute(sql)


async def set_primary_key(
    conn: PoolConn,
    target: SchemaTableColumn,
) -> str:
    return await set_multi_column_primary_key(
        conn, target.get_schema_table(), [target.column_name]
    )


async def set_multi_column_primary_key(
    conn: PoolConn,
    target: SchemaTable,
    pk_column_names: List[str],
) -> str:
    assert len(pk_column_names) > 0
    indexes = await get_primary_keys(
        conn, SchemaTable(schema_name=target.schema_name, table_name=target.table_name)
    )
    # search for existing pkey

    for index in indexes:
        if index.is_primary_key and set(index.column_names).issuperset(
            set(pk_column_names)
        ):
            return f"Existing PK {index} found in {target}"

    log.info(f"Creating primary key constraint in {target}")

    sql = (
        SQL("""ALTER TABLE {table_name} ADD PRIMARY KEY ({column_names})""")
        .format(
            column_names=SQL(", ").join(
                [Identifier(column_name) for column_name in pk_column_names]
            ),
            table_name=target.as_identifier(),
        )
        .as_string()
    )
    return await conn.execute(sql)


async def get_primary_keys_records(conn: PoolConn, target: SchemaTable) -> List[Record]:
    sql = (
        SQL(
            """
SELECT a.attname as column_name, 
    con.conname as constraint_name
    --format_type(a.atttypid, a.atttypmod) AS data_type
FROM pg_index i
JOIN pg_attribute a ON a.attrelid = i.indrelid
                     AND a.attnum = ANY(i.indkey)
LEFT JOIN pg_constraint con ON con.conrelid = i.indrelid
                 AND con.conkey[1] = i.indkey[1]
                 AND con.contype = 'p'  -- Ensures it's a primary key constraint
WHERE i.indRelId = {}::regclass
    AND i.indIsPrimary;
    """
        )
        .format(
            Literal(f"{target.schema_name}.{target.table_name}"),
        )
        .as_string()
    )

    rows = await conn.fetch(sql)
    return rows


async def get_primary_keys(conn: PoolConn, target: SchemaTable) -> List[IndexInfo]:
    rows = await get_indexes(conn, target)

    return [r for r in rows if r.is_primary_key]


async def drop_view(
    conn: PoolConn,
    target: SchemaView,
    cascade: bool = False,
) -> None:
    sql = (
        SQL(
            """
    DROP VIEW IF EXISTS {schema_name}.{view_name}
    """
        )
        .format(
            schema_name=Identifier(target.schema_name),
            view_name=Identifier(target.view_name),
        )
        .as_string()
    )

    await conn.execute(sql)


async def database_exists(conn: PoolConn, db_name: str) -> bool:
    sql = (
        SQL("""SELECT 1 AS result FROM pg_database WHERE datname={}""")
        .format(Literal(db_name))
        .as_string()
    )
    r = await conn.fetchval(sql)

    return r is not None


async def drop_item(
    conn: PoolConn,
    schema_name: str,
    item_name: str,
) -> None:
    sql = (
        SQL(
            """
    DO $$
    DECLARE
        obj_type text;
        obj_name text := {item_name};  
        obj_schema text := {schema_name};
    BEGIN
        SELECT CASE
            WHEN relkind = 'r' THEN 'table'
            WHEN relkind = 'v' THEN 'view'
            WHEN relkind = 'm' THEN 'materialized view'
            ELSE NULL
        END INTO obj_type
        FROM pg_class
        WHERE relname = obj_name
        AND relkind IN ('r', 'v', 'm')
        AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = obj_schema);  

        
        IF obj_type IS NOT NULL THEN
            IF obj_type = 'table' THEN
                EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', obj_schema, obj_name);
            ELSIF obj_type = 'view' THEN
                EXECUTE format('DROP VIEW IF EXISTS %I.%I CASCADE', obj_schema, obj_name);
            ELSIF obj_type = 'materialized view' THEN
                EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS %I.%I CASCADE', obj_schema, obj_name);
            END IF;
        ELSE
            RAISE NOTICE 'Item %.% is not a table, view, or mat view', obj_schema, obj_name;
        END IF;
    END $$;
"""
        )
        .format(item_name=Literal(item_name), schema_name=Literal(schema_name))
        .as_string()
    )

    await conn.execute(sql)


async def get_column_name_type_map(
    conn: PoolConn,
    target: SchemaTable,
    is_temp_table: bool = False,
) -> Dict[str, str]:
    schema_filter: Union[SQL, Composed] = SQL("AND n.nspname = {schema}").format(
        schema=LiteralSql(target.schema_name)
    )

    if is_temp_table:
        schema_filter = SQL(r"AND n.nspname like 'pg\_temp%'")

    sql = (
        SQL(
            """
SELECT 
    a.attname AS column_name,
    t.typname AS column_type,
    a.attnum AS column_position
FROM 
    pg_catalog.pg_class c
INNER JOIN pg_catalog.pg_attribute a 
    ON a.attrelid = c.oid
INNER JOIN pg_catalog.pg_type t 
    ON a.atttypid = t.oid
INNER JOIN pg_catalog.pg_namespace n 
    ON n.oid = c.relnamespace
WHERE 
    c.relkind IN ('r', 'v', 'm')    -- 'v' for views, 'm' for materialized views, 'r' tables
    AND a.attnum > 0 
    AND NOT a.attisdropped 
    {schema_filter}
    AND c.relname = {table}
    """
        )
        .format(
            table=LiteralSql(target.table_name),
            schema_filter=schema_filter,
        )
        .as_string()
    )

    rows = await conn.fetch(sql)

    ret: Dict[str, str] = {}

    for r in rows:
        ret[r[0]] = r[1]

    return ret


async def get_column_name_type_map_for_query(
    conn: PoolConn,
    query: Union[Composed, SQL],
) -> Dict[str, str]:
    """
    Works with views, mat views, and columns
    """
    tmp_table_name = "tmp_for_col_name_map"

    sql = (
        SQL(
            """
        DROP TABLE IF EXISTS pg_temp.{tmp_table_name};
         
        CREATE TEMP TABLE {tmp_table_name} AS 
        {query}
        LIMIT 0
        """
        )
        .format(
            query=query,
            tmp_table_name=Identifier(tmp_table_name),
        )
        .as_string()
    )

    await conn.execute(sql)

    return await get_column_name_type_map(
        conn,
        target=SchemaTable(schema_name="pg_temp", table_name=tmp_table_name),
        is_temp_table=True,
    )


async def get_view_info(
    conn: PoolConn, target: SchemaView
) -> Optional[Tuple[str, str]]:
    sql = (
        SQL(
            """
SELECT definition, viewowner
FROM pg_views v    
WHERE
    v.schemaname = {schema_name}
    AND v.viewname = {view_name}
"""
        )
        .format(
            schema_name=Literal(target.schema_name), view_name=Literal(target.view_name)
        )
        .as_string()
    )

    log.debug(sql)
    record = await conn.fetchrow(sql)
    if record is None:
        return None

    return record[0], record[1]


async def get_mat_view_info(
    conn: PoolConn, target: SchemaView
) -> Optional[Tuple[str, str, bool, bool]]:
    sql = (
        SQL(
            """
SELECT definition, MatViewOwner, HasIndexes, IsPopulated
FROM pg_matviews v    
WHERE
    v.SchemaName = {schema_name}
    AND v.MatViewName = {view_name}
"""
        )
        .format(
            schema_name=Literal(target.schema_name), view_name=Literal(target.view_name)
        )
        .as_string()
    )

    log.debug(sql)
    record = await conn.fetchrow(sql)

    if record is None:
        return None

    return record[0], record[1], record[2], record[3]


def pretty_print_record(record: Record) -> str:
    # Convert asyncpg.Record to a dictionary
    record_dict = dict(record)

    # Decode byte strings in the dictionary
    for key, value in record_dict.items():
        if isinstance(value, bytes):
            # Decode bytes to UTF-8 string
            record_dict[key] = value.decode("utf-8")

    # Convert the dictionary to JSON
    json_output = json.dumps(record_dict, indent=2)

    # Output the JSON string
    return json_output


async def reset_sequence(
    conn: PoolConn,
    target: SchemaTableColumn,
) -> None:
    sql = (
        SQL(
            """
    SELECT 
    pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) AS sequence_name
FROM 
    pg_class c
JOIN 
    pg_namespace n ON n.oid = c.relnamespace
JOIN 
    pg_attribute a ON a.attrelid = c.oid
WHERE 
    n.nspname = {schema_name}
    AND c.relname = {table_name}
    AND a.attname = {column_name}

"""
        )
        .format(
            schema_name=Literal(target.schema_name),
            table_name=Literal(target.table_name),
            column_name=Literal(target.column_name),
        )
        .as_string()
    )

    sequence_name = await conn.fetchval(sql)

    assert sequence_name is not None

    sql = (
        SQL("ALTER SEQUENCE {} RESTART WITH 1;").format(SQL(sequence_name)).as_string()
    )

    log.debug(sql)

    await conn.execute(sql)


async def get_non_nullable_column_names(
    conn: PoolConn, target: SchemaTable
) -> List[str]:
    sql = (
        SQL(
            """
    SELECT col1.column_name 
    FROM information_schema.columns col1

    WHERE col1.table_name     = {table_name}
        AND col1.table_schema = {schema_name}
        AND col1.is_nullable = 'NO'
    """
        )
        .format(
            schema_name=LiteralSql(target.schema_name),
            table_name=LiteralSql(target.table_name),
        )
        .as_string()
    )

    rows = await conn.fetch(sql)

    if rows is None:
        return []

    columns = [r[0] for r in rows]

    return columns


async def drop_constraints_and_indexes(
    conn: PoolConn,
    target: SchemaTable,
    # remove_indexes: bool = True,
    keep_primary_key: bool = True,
) -> None:
    """
    Drops all constraints on the table
    and removes any NOT NULL restriction
    """
    constraints = await get_constraints(conn, target)

    pk_columns: Set[str] = set()

    for constraint_info in constraints:
        if keep_primary_key and constraint_info.constraint_type == "p":
            pk_columns.update(constraint_info.column_names)
            continue

        sql = (
            SQL(
                """ALTER TABLE {table_name} DROP CONSTRAINT IF EXISTS {constraint_name} CASCADE ;"""
            )
            .format(
                table_name=Identifier(target.schema_name, target.table_name),
                constraint_name=Identifier(constraint_info.constraint_name),
            )
            .as_string()
        )
        await conn.execute(sql)

    indexes = await get_indexes(conn, target)

    for index_info in indexes:
        if index_info.is_primary_key and keep_primary_key:
            pk_columns.update(index_info.column_names)
            continue

        sql = (
            SQL("""DROP INDEX IF EXISTS {index_name}  ;""")
            .format(
                # table_name=Identifier(target.schema_name, target.table_name),
                index_name=Identifier(target.schema_name, index_info.index_name),
            )
            .as_string()
        )
        log.debug(sql)
        await conn.execute(sql)

    not_nullable_columns = await get_non_nullable_column_names(conn, target)

    for column_name in not_nullable_columns:
        if column_name in pk_columns and keep_primary_key:
            continue

        sql = (
            SQL(
                """
        ALTER TABLE {schema_name}.{table_name}
        ALTER {column_name} DROP NOT NULL;
        """
            )
            .format(
                schema_name=Identifier(target.schema_name),
                table_name=Identifier(target.table_name),
                column_name=Identifier(column_name),
            )
            .as_string()
        )

        await conn.execute(sql)

    constraints = await get_constraints(conn, target=target)
    indexes = await get_indexes(conn, target)

    for c in constraints:
        if c.constraint_type == "p" and keep_primary_key:
            continue

        raise Exception(f"Constraint still exists {c.constraint_name}")
    for i in indexes:
        if i.is_primary_key and keep_primary_key:
            continue

        raise Exception(f"Index still exists {i.index_name}")


async def pg_type_exists(conn: PoolConn, type_name: str) -> bool:
    sql = (
        SQL(
            """
SELECT 1 FROM pg_catalog.pg_type 
WHERE typname = {}"""
        )
        .format(LiteralSql(type_name))
        .as_string()
    )

    ret = await conn.fetchval(sql)

    return ret is not None


class DbItem(BaseModel):
    schema_name: PostgresqlIdentifier
    table_or_view_name: str
    type: LiteralTyping["table", "mat_view", "view"]


async def get_tables_and_views(
    conn: PoolConn,
    schema_name: Optional[str] = None,
) -> List[DbItem]:
    ret: List[DbItem] = []
    sql = (
        SQL(
            """
SELECT schemaname, viewname, 'view' 
FROM pg_views  v
WHERE v.schemaname IS NOT DISTINCT FROM {schema_name}
UNION ALL 
SELECT schemaname, tablename, 'table' 
FROM pg_tables t 
WHERE t.schemaname IS NOT DISTINCT FROM {schema_name}
UNION ALL
SELECT schemaname, matviewname, 'mat_view' 
FROM pg_matviews m
WHERE m.schemaname IS NOT DISTINCT FROM {schema_name}
    """
        )
        .format(schema_name=LiteralSql(schema_name))
        .as_string()
    )

    # log.debug(sql)
    rows = await conn.fetch(sql)

    for r in rows:
        ret.append(DbItem(schema_name=r[0], table_or_view_name=r[1], type=r[2]))

    return ret


def format_sql(sql: str) -> str:
    formatted_sql = ""
    for s in sqlglot.parse(sql, dialect="postgres"):
        assert s is not None
        formatted_sql += s.sql(pretty=True, indent=4, pad=4, dialect="postgres") + ";\n"

    return formatted_sql


def canonical_sql(sql: str) -> str:
    ret = ""
    for s in sqlglot.parse(sql, dialect="postgres"):
        assert s is not None
        opt = sqlglot.optimizer.optimize(s)
        ret += opt.sql(pretty=True, indent=4, pad=4, dialect="postgres") + ";\n"

    return ret


# This is used so we get the natural limit of the pool to set
# how many queries can be executed in parallel
async def run_pool_sql(pool: PoolType, sql: str) -> None:
    async with pool.acquire() as conn:
        # log.debug(f"Running pool acquire sql:\n{sql}")
        try:
            await conn.execute(sql)
        except Exception as ex:
            log.exception(f"Problem with sql:\n{sql}")
            raise ex


async def kill_existing_connections(conn: PoolConn, db_name: str) -> None:
    sql = (
        SQL(
            """
SELECT 
    pg_terminate_backend(pg_stat_activity.pid)
FROM pg_stat_activity
WHERE 
    pg_stat_activity.datname = {}  
        AND pid <> pg_backend_pid()
        AND query not like 'autovacuum%'
"""
        )
        .format(LiteralSql(db_name))
        .as_string()
    )
    try:
        ret = await conn.execute(sql)
        log.info(f"Terminated connections: {ret}")
    except asyncpg.exceptions.InsufficientPrivilegeError as ex:
        # Catch error on CERN DBAAS: must be a member of the role whose query is being canceled or member of pg_signal_backend:
        log.warning("Sql:\n%s\n\nFailed to terminate connections: %s" % (sql, ex))


async def drop_existing_connections(
    conn: PoolConn, db_name: str, try_again: bool = False
) -> None:
    where_sql = (
        SQL(
            """
    WHERE pg_stat_activity.datname = {}  AND pid <> pg_backend_pid()
    and query not like 'autovacuum%%';
    """
        )
        .format(LiteralSql(db_name))
        .as_string()
    )

    cancel_sql = (
        """
            SELECT pg_cancel_backend(pg_stat_activity.pid)
            FROM pg_stat_activity

            """
        + where_sql
    )

    try:
        ret = await conn.execute(cancel_sql)

        log.info(f"Cancelled connections: {ret}")
    except asyncpg.exceptions.InsufficientPrivilegeError as ex:
        # Catch error on CERN DBAAS: must be a member of the role whose query is being canceled or member of pg_signal_backend:
        log.warning("Sql:\n%s\n\nFailed to cancel connections: %s" % (cancel_sql, ex))

    await kill_existing_connections(conn, db_name=db_name)

    list_sql = (
        """
            SELECT pid, query, now()-query_start AS query_duration
            FROM pg_stat_activity

        """
        + where_sql
    )
    recs = await conn.fetch(list_sql)

    if recs is None or len(recs) == 0:
        log.info(f"All existing sessions dropped from {db_name}")

    for r in recs:
        log.warning(
            "Unkilled session. PID: %i Duration: %s Query: %s"
            % (r[0], r[2], r[1][0:500])
        )

    if not try_again:
        return

    # We cannot drop the connections on CERN DBAAS we try again
    # as the connections probably come from the monitoring agent

    # Long interval as the query might take a long time
    interval_seconds = 5
    max_retry = 60
    for n in range(max_retry):
        log.debug(f"Retrying in {interval_seconds} seconds.")
        await asyncio.sleep(interval_seconds)
        await kill_existing_connections(conn, db_name=db_name)
        recs = await conn.fetch(list_sql)

        if len(recs) > 0:
            for r in recs:
                log.warning(
                    "Unkilled session. PID: %i Duration: %s Query: %s"
                    % (r[0], r[2], r[1][0:500])
                )

        else:
            log.info("No more sessions were found.")
            break


async def drop_database(conn: PoolConn, database_name: str) -> None:
    sql = (
        SQL(""" DROP DATABASE IF EXISTS {} """)
        .format(Identifier(database_name))
        .as_string()
    )

    log.debug(sql)
    await conn.execute(sql)


async def rename_database(conn: PoolConn, old_name: str, new_name: str) -> None:
    sql = (
        SQL(
            """
        ALTER DATABASE {old_name}
        RENAME TO {new_name};
        """
        )
        .format(old_name=Identifier(old_name), new_name=Identifier(new_name))
        .as_string()
    )

    log.debug(sql)
    await conn.execute(sql)


async def execute_log(conn: PoolConn, sql: str, log_return: bool = False) -> str:
    try:
        ret = await conn.execute(sql)
        if log_return:
            log.debug(f"return = [{ret}]")
        return ret
    except PostgresError:
        log.error(f"Error with sql:\n{sql}")
        raise


async def fetch_log(conn: PoolConn, sql: str, log_return: bool = False) -> List[Record]:
    try:
        ret = await conn.fetch(sql)
        if log_return:
            log.debug(f"return = [{len(ret)}]")
        return ret
    except PostgresError:
        log.error(f"Error with sql:\n{sql}")
        raise


async def get_enum_values(conn: PoolConn, type_name: str, schema_name:str) -> List[str]:
    sql = SQL("""
    SELECT e.enumlabel
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE t.typname = {}
  AND n.nspname = {}
ORDER BY e.enumsortorder;

    """)  .format(
       LiteralSql(type_name),
        LiteralSql(schema_name),
    )    .as_string()

    rows = await conn.fetch(sql)

    return [r[0] for r in rows]
