# coding=utf-8

from lib import geo_db_utils, db_utils
import pytest
from importer.tests.test_config import TestConfig as cfg
import os
import queue

from lib.db_utils import table_exists, get_results
from lib.test_utils import create_point_table, TestConstants, conn


def test_create_point_table_with_sql(conn):
    create_point_table(conn)

    r = get_results(
        conn,
        f"select count(*) from {TestConstants.TEST_SCHEMA}.{TestConstants.TABLE_NAME_POINTS}")

    assert r[0][0] == 100

