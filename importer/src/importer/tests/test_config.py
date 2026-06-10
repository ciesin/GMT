import os
from pathlib import Path


class TestConfig(object):

    POSTGRESQL_PORT = int(os.environ.get('DB_PORT', '5432'))
    POSTGRESQL_HOST = os.environ.get('DB_HOST', 'db')
    POSTGRESQL_USERNAME = os.environ['DB_ADMIN_USER']
    POSTGRESQL_PASSWORD = os.environ['DB_ADMIN_PASSWORD']
    POSTGRESQL_DATABASE = os.environ['DB_NAME']
    POSTGRESQL_TABLESPACE = os.environ.get('POSTGRESQL_TABLESPACE', 'pg_default')
    POSTGRESQL_BIN_DIR = Path(os.environ.get('POSTGRESQL_BIN_DIR', r'C:\PostgreSQL\pg96\bin'))

    IMPORTER_DIR = Path(__file__).parent.parent

    ASSETS_DIR = Path("/src/importer/assets")

    GIS_ASSETS_DIR = ASSETS_DIR / "gis"

    PATH_SQLITE_EMPTY = GIS_ASSETS_DIR / "empty.db"
    PATH_SQLITE_POINTS = GIS_ASSETS_DIR / "points.db"
    PATH_SQLITE_POLYGON = GIS_ASSETS_DIR / "polygons.db"

    POINTS_TABLE_NAME = "test_points"
    POLYGON_TABLE_NAME = "test_polygons"
    PATH_SHAPEFILE_POINTS = GIS_ASSETS_DIR / f"{POINTS_TABLE_NAME}.shp"
    PATH_SHAPEFILE_POLYGONS = GIS_ASSETS_DIR / f"{POLYGON_TABLE_NAME}.shp"

    PATH_TEST_YML_CONFIG = ASSETS_DIR / "importer_config" / "test_command.yml"

    OSGEO_BIN_DIR = Path("/usr/bin")

    REBUILD_ASSETS = True

    PATH_DIFF_OUTPUT = Path("/python_src/importer/assets/diff_output")

    RANDOM_STRINGS = ["Locutus", "42", "Necronomicon", "Omnissiah", "Deus Mechanicus", "Tzeentch"]

    TEMP_DIR = Path("/tmp")
