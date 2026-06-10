import contextlib
import logging
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from importer.constants import DbConstants, DirectoryLocations
from lib import geo_db_utils, db_utils, file_utils
from lib.db_utils import create_schema
from .test_config import TestConfig
from .util import create_import_sqlite_db, create_import_shapefile_points, create_shapefile_points_with_param, \
    create_import_shapefile_polygon
from .. import create_initial_migration_files

log = logging.getLogger(__name__)


@pytest.fixture(scope="session")
def cfg():
    return TestConfig


@pytest.fixture()
def conn(db_test, cfg):
    with db_utils.create_db_connection(cfg) as conn:
        yield conn


@pytest.fixture(scope="session")
def db_test(cfg):

    # drop the staging schema only
    staging_name = "stage_unit_test"

    if db_utils.database_exists(cfg, cfg.POSTGRESQL_DATABASE):
        with contextlib.closing(db_utils.create_db_connection(cfg)) as conn:

            db_utils.run_sql(conn, f"drop schema if exists {staging_name} cascade")

    yield


@pytest.fixture()
def sqlite_points_changed(cfg):
    yield create_import_sqlite_db(cfg, True, is_points=True)


@pytest.fixture()
def sqlite_points(cfg):
    yield create_import_sqlite_db(cfg, False, is_points=True)


@pytest.fixture()
def sqlite_polygons_changed(cfg):
    yield create_import_sqlite_db(cfg, True, is_points=False)


@pytest.fixture()
def sqlite_polygons(cfg):
    yield create_import_sqlite_db(cfg, False, is_points=False)


@pytest.fixture()
def shapefile_polygons(cfg):
    yield create_import_shapefile_polygon(cfg, False)


@pytest.fixture()
def shapefile_points(cfg):
    yield create_import_shapefile_points(cfg, False)


@pytest.fixture()
def shapefile_points_changed(cfg):
    yield create_import_shapefile_points(cfg, False)


@pytest.fixture
def shapefile_points_with_param_2(cfg, filestem_suffix_2, srid_2, test_points_2) -> Path:
    return create_shapefile_points_with_param(cfg, filestem_suffix_2, srid_2, test_points_2)

@pytest.fixture
def shapefile_points_with_param(cfg, filestem_suffix, srid, test_points) -> Path:
    return create_shapefile_points_with_param(cfg, filestem_suffix, srid, test_points)

