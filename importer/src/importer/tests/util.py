import logging
import random
from datetime import timedelta, datetime
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point, Polygon

from .test_config import TestConfig
from lib import file_utils
from lib.thread_utils import run_process

log = logging.getLogger(__name__)

class DummyCommandLineArguments:
    username = None
    password = None
    diff_summary_only = False
    use_db_copy = False
    skip_pdf = True
    db_filter = None
    input_layer = None
    input_path = None


def random_date(start, end):
    """
    This function will return a random datetime between two datetime
    objects.
    """
    delta = end - start
    int_delta = (delta.days * 24 * 60 * 60) + delta.seconds
    random_second = random.randrange(int_delta)
    return start + timedelta(seconds=random_second)


def create_import_sqlite_db(cfg: TestConfig, is_changed, is_points):
    sqlite_path = cfg.PATH_SQLITE_POINTS if is_points else cfg.PATH_SQLITE_POLYGON

    file_path = sqlite_path.parent / \
                (sqlite_path.stem + ("_changed" if is_changed else "") + sqlite_path.suffix)

    if file_path.exists() and not cfg.REBUILD_ASSETS:
        return file_path

    file_utils.remove_file(file_path)

    ogr2ogr_path = cfg.OSGEO_BIN_DIR / "ogr2ogr"

    assert ogr2ogr_path.exists()

    if is_points:
        shapefile_path = create_import_shapefile_points(cfg, is_changed)
    else:
        shapefile_path = create_import_shapefile_polygon(cfg, is_changed)

    assert shapefile_path.exists()

    cmd_line_parts = [
        f'"{ogr2ogr_path}"',
        # target
        '-f "SQLite"',
        # '-lco FID=id',
        '-lco GEOMETRY_NAME=shape',
        '-dsco SPATIALITE=YES',
        # dest
        f'"{file_path}"',
        # src
        f'"{shapefile_path}"',
    ]

    ogr_cmd = ' '.join(cmd_line_parts)

    my_env = {}
    if hasattr(cfg, 'GDAL_DATA'):
        my_env["GDAL_DATA"] = str(cfg.GDAL_DATA)

    print(ogr_cmd)

    return_code, output, stderr = run_process(
        ogr_cmd, env_override=my_env, throw_on_error_code=False)

    if return_code != 0:
        raise Exception(
            f"ogr2ogr failed! return code: [{return_code}]\n{ogr_cmd}\nOutput:\n{output}\nStdErr:\n{stderr}")

    return file_path


def clip(x, min, max):
    if min > max:
        return x
    elif x < min:
        return min
    elif x > max:
        return max
    else:
        return x


def create_import_shapefile_polygon(cfg, is_changed) -> Path:
    file_path = cfg.PATH_SHAPEFILE_POLYGONS.parent / \
                (cfg.PATH_SHAPEFILE_POLYGONS.stem + ("_changed" if is_changed else "") +
                 cfg.PATH_SHAPEFILE_POLYGONS.suffix)

    if file_path.exists() and not cfg.REBUILD_ASSETS:
        return file_path

    file_utils.remove_file(file_path)

    random.seed(42)

    n_polygons = 22 if is_changed else 20
    poly_vertices = []

    kano = [8.5920, 12.0022]
    square_width = 0.003

    for p in range(0, n_polygons):

        ctr_x = random.uniform(kano[0] - square_width, kano[0] + square_width)
        ctr_y = random.uniform(kano[1] - square_width, kano[1] + square_width)

        if is_changed and p == 1:
            ctr_x += square_width / 2
            ctr_y -= square_width / 3

        if is_changed and p == 4:
            ctr_x += square_width / 1.5
            ctr_y += square_width / 2

        # polygon_vertices = generate_polygon(
        #     ctr_x, ctr_y, avg_radius=square_width, irregularity=0.8, spikeyness= 0, num_verts=7)
        #
        # print(polygon_vertices)

        poly_vertices.append([
            Point(ctr_x, ctr_y).buffer(square_width),
            p,
            random.choice(TestConfig.RANDOM_STRINGS),  # string
            random.randint(-42, 42),
            str(random_date(datetime.strptime('2013-06-15 21:07', fmt := '%Y-%m-%d %H:%M'),
                            datetime.strptime('2015-05-14 07:42', fmt)))

        ])

        if p == 2 and is_changed:
            poly_vertices[-1][2] += " -- edited"
            poly_vertices[-1][3] += 2
            poly_vertices[-1][4] = str(datetime.strptime('1980-12-15 07:42', fmt))
        if p == 4 and is_changed:
            poly_vertices[-1][2] += " -- edited again 4"
            poly_vertices[-1][3] -= 3
            poly_vertices[-1][4] = str(datetime.strptime('1980-12-15 11:33', fmt))

        if p == 7 and is_changed:
            # empty collection
            poly_vertices[-1][0] = Polygon()

    if is_changed:
        del poly_vertices[17]
        del poly_vertices[8]
        del poly_vertices[3]

    df = pd.DataFrame(poly_vertices, columns=['shape', 'id', 'str', 'an_int', 'a_date'])

    # df['shape'] = df.apply(lambda row: Polygon(row.vertices), axis=1)

    # df.drop('vertices', axis=1, inplace=True)

    gdf = gpd.GeoDataFrame(df, geometry='shape')

    gdf.crs = {'init': 'epsg:4326'}

    if is_changed:
        # gdf = gdf.to_crs({'init': 'epsg:3857'})
        gdf = gdf.to_crs({'init': 'epsg:32632'})

    gdf.to_file(driver='ESRI Shapefile', filename=file_path)

    return file_path


def create_import_shapefile_points(cfg, is_changed) -> Path:
    file_path = cfg.PATH_SHAPEFILE_POINTS.parent / \
                (cfg.PATH_SHAPEFILE_POINTS.stem + ("_changed" if is_changed else "") + cfg.PATH_SHAPEFILE_POINTS.suffix)

    if file_path.exists() and not cfg.REBUILD_ASSETS:
        return file_path

    file_utils.remove_file(file_path)

    random.seed(42)

    n_points = 22 if is_changed else 20
    point_xy = []

    kano = [8.5920, 12.0022]
    square_width = 0.003

    for p in range(0, n_points):
        point_xy.append(
            [random.uniform(kano[0] - square_width, kano[0] + square_width),
             random.uniform(kano[1] - square_width, kano[1] + square_width),
             p
             ])

    if is_changed:
        del point_xy[17]
        del point_xy[8]
        del point_xy[3]

        point_xy[1][0] += square_width / 2
        point_xy[1][1] -= square_width / 3

    df = pd.DataFrame(point_xy, columns=['x', 'y', 'id'])

    df['shape'] = df.apply(lambda row: Point(row.x, row.y), axis=1)

    gdf = gpd.GeoDataFrame(df, geometry='shape')

    gdf.crs = {'init': 'epsg:4326'}

    if is_changed:
        # gdf = gdf.to_crs({'init': 'epsg:3857'})
        gdf = gdf.to_crs(epsg=32632)

    gdf.to_file(driver='ESRI Shapefile', filename=file_path)

    return file_path



def create_shapefile_points_with_param(cfg, filestem_suffix, srid, test_points) -> Path:
    file_path = cfg.PATH_SHAPEFILE_POINTS.parent / \
                (cfg.PATH_SHAPEFILE_POINTS.stem + filestem_suffix + cfg.PATH_SHAPEFILE_POINTS.suffix)

    file_utils.remove_file(file_path)

    random.seed(42)

    n_points = len(test_points)

    df = pd.DataFrame(test_points, columns=['x', 'y'])

    df['id'] = range(0, n_points)
    df['shape'] = df.apply(lambda row: Point(row.x, row.y), axis=1)

    gdf = gpd.GeoDataFrame(df, geometry='shape')

    gdf.crs = {'init': f'epsg:{srid}'}

    gdf.to_file(driver='ESRI Shapefile', filename=file_path)

    return file_path