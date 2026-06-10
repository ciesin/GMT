from importer.diff.worker import sanitize_id
from .fixtures import *

log = logging.getLogger(__name__)


def test_database_schema(db_test, conn):
    table_count = db_utils.get_single_value(conn, f"""select count(*) from information_schema.tables
where table_schema = '{DbConstants.SCHEMA_MASTER}'""")

    assert table_count >= 1


def test_sanitize_id():
    """
    In case markdown anchor links are needed
    """

    assert sanitize_id("Feature #39 : wardcode: 10109 Changed") == "feature-39--wardcode-10109-changed"

