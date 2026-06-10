from psycopg.sql import Composed
from tabulate import tabulate  # type: ignore[import-untyped]

from lib.async_db_utils import PoolConn, fetch_log
from lib.logger_utils import get_logger

log = get_logger(__name__)


async def print_db_rows(
    conn: PoolConn,
    sql: Composed,
    desc: str,
) -> int:
    rows = await fetch_log(conn, sql.as_string())

    # Fetch the column names
    if len(rows) > 0:
        data = [dict(record) for record in rows]

        ts = tabulate(data, headers="keys", tablefmt="orgtbl")

        log.warning(desc)
        log.info("\n" + ts)

        return len(rows)
    return 0


class ValidationError(Exception):
    """Raised when data validation fails"""

    def __init__(self, message: str) -> None:
        super().__init__(message)


async def run_problem_query(dest_conn: PoolConn, sql: Composed, prob_desc: str) -> bool:
    """
    Runs the query, throws exception if any rows

    Assumption is the query only returns problems
    """

    len_rows = await print_db_rows(dest_conn, sql, prob_desc)
    if len_rows > 0:
        # INSERT INTO master.logs
        # (id, user_name, message, payload, "timestamp", githash, app_version)
        # VALUES(nextval('master.logs_id_seq'::regclass), '', '', '', CURRENT_TIMESTAMP, '', '');
        #         raise ValidationError(f"Rows found for {prob_desc}\n{sql}")
        # log.debug(sql.as_string())
        return False
    else:
        return True
