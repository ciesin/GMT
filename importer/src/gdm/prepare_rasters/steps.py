import json
import logging
import math
import os
import shutil
from pathlib import Path

#from yarl import URL

from config import Config as cfg
from lib import geo_db_utils, db_utils, file_utils
from lib.raster_utils import RasterStats
from lib.thread_utils import run_process_stream_output
from osgeo import ogr
from osgeo import osr

log = logging.getLogger(__name__)




def step_create_new_database():
    """
    Creates an empty PostGIS database on the local dev machine.

    Populates with the initial schema

    Environment: Local PostGIS database
    """

    geo_db_utils.create_database(
        cfg=cfg,
        drop_if_exists=True, add_postgis=True)


def step_download_admin_1(conn):
    """
    downloads layers

    rsync --progress --verbose -r /home/eric/git/pop_model/country_specific/MP/working/ /mnt/d/git/pop_model/country_specific/MP/working


    """

    url = URL('https://geoserver.grid3.gov.ng/geoserver/GRIDMaster/ows') % {
        "SERVICE": "WFS",
          "VERSION": "1.1.0",
          "REQUEST": "GetCapabilities",
        # cql filter?
    }

    log.info(f"Url is {url}")

    # ogrinfo WFS:"https://www.wondermap.it/cgi-bin/qgis_mapserv.fcgi?&map=/home/ubuntu/qgis/projects/Demo_sci_WMS/demo_sci.qgs&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetCapabilities"


    cfg.ADMIN_PATH.mkdir(parents=True, exist_ok=True)

    if not cfg.ADMIN_1_PATH_UNPROJECTED.exists():

        cmd_parts = [
            "ogr2ogr",
            "-f FlatGeobuf",
            "-progress",
            "-f FlatGeobuf",
            '-t_srs EPSG:4326',
            f'-nln "{cfg.ADMIN_1_PATH_UNPROJECTED.stem}"',
            f'"{cfg.ADMIN_1_PATH_UNPROJECTED}"',
            f'WFS:"{url}"',
            f"GRIDMaster:u_boundary_states",
        ]

        cmd = ' '.join(cmd_parts)

        run_process_stream_output(cmd, cwd=f"{cfg.WORKING_FOLDER}")

def step_choose_projection(conn):
    """
    Chooses projection
    """

    if cfg.PROJ_STR.exists():
        log.info(f"{cfg.PROJ_STR} exists, skipping")
        return

    from osgeo import ogr
    inDriver = ogr.GetDriverByName("FlatGeobuf")

    inDataSource = inDriver.Open(str(cfg.ADMIN_1_PATH_UNPROJECTED), 0)
    inLayer = inDataSource.GetLayer()
    extent = inLayer.GetExtent()

    log.info(extent)

    min_x, max_x, min_y, max_y = extent

    # A + (B-A) / 2
    # A + B/2 - A/2
    # A/2 + B/2
    # (A+B) /2

    center_y_lat = (max_y + min_y) / 2.0
    center_x_lon = (max_x + min_x) / 2.0

    proj = f"+proj=laea +lat_0={center_y_lat} +lon_0={center_x_lon} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs"

    log.info(proj)

    cfg.PROJ_STR.parent.mkdir(parents=True, exist_ok=True)

    with cfg.PROJ_STR.open("w") as f:
        f.write(proj)

def step_download_layers(conn):
    """
    Downloads all layers
    """

    url = URL('https://geoserver.grid3.gov.ng/geoserver/GRIDMaster/ows') % {
        "SERVICE": "WFS",
        "VERSION": "1.1.0",
        "REQUEST": "GetCapabilities",
        # cql filter?
    }

    log.info(f"Url is {url}")

    xml_file = cfg.WORKING_FOLDER / "grid3_wfs.xml"

    with xml_file.open("w") as f:
        f.write(f"""<OGRWFSDataSource>
        <URL>{url}</URL>
        <PagingAllowed>OFF</PagingAllowed>
        <Version>1.1.0</Version>        
    </OGRWFSDataSource>""")

    proj = cfg.PROJ_STR.read_text(encoding="UTF-8")

    for i in cfg.INPUT_FILES:

        if i.path.exists():
            if cfg.CLEAN:
                i.path.unlink()
            else:
                log.info(f"{i.path} exists, skipping")
                continue

        i.path.parent.mkdir(parents=True, exist_ok=True)

        assert not i.path.exists()

        cmd_parts = [
            "ogr2ogr",
            "-f FlatGeobuf",
            "-progress",
            "-f FlatGeobuf",
            f'-t_srs "{proj}"',
            f'-nln "{i.path.stem}"',
            f'"{i.path}"',
            f'"{xml_file}"',
            "-dialect SQLite",
            "-sql",
            f'"select *, rowid as row_id FROM \'{i.wfs_typename}\'"',
        ]



        cmd = ' '.join(cmd_parts)

        run_process_stream_output(cmd, cwd=f"{cfg.WORKING_FOLDER}")

    url = URL('https://gis.geopode.world/r32DzgDwKk345MU8ar4V/geoserver/nigeria/wms') % {
        "SERVICE": "WFS",
        "VERSION": "1.1.0",
        "REQUEST": "GetCapabilities",
        # cql filter?
    }

    xml_file = cfg.WORKING_FOLDER / "geopode_wfs.xml"
    username = os.environ["GEOPODE_USERNAME"]
    password = os.environ["GEOPODE_PASSWORD"]
    with xml_file.open("w") as f:
        f.write(f"""<OGRWFSDataSource>
    <URL>{url}</URL>
    <PagingAllowed>ON</PagingAllowed>
    <Version>1.1.0</Version>
    <HttpAuth>BASIC</HttpAuth>
    <UserPwd>{username}:{password}</UserPwd>    
</OGRWFSDataSource>""")


    for i in cfg.GEOPODE_INPUT:

        if i.path.exists():
            log.info(f"{i.path} exists, skipping")
            continue

        i.path.parent.mkdir(parents=True, exist_ok=True)

        cmd_parts = [
            "ogr2ogr",
            "-f FlatGeobuf",
            "-progress",
            "-f FlatGeobuf",
            f'-t_srs "{proj}"',
            f'-nln "{i.path.stem}"',
            f'"{i.path}"',
            f'"{xml_file}"',
            f"{i.wfs_typename}",
        ]

        cmd = ' '.join(cmd_parts)

        run_process_stream_output(cmd, cwd=f"{cfg.WORKING_FOLDER}")

    for i in cfg.GEOPODE_FGDB_INPUT:

        if i.path.exists():
            log.info(f"{i.path} exists, skipping")
            continue

        i.path.parent.mkdir(parents=True, exist_ok=True)

        cmd_parts = [
            "ogr2ogr",
            "-f FlatGeobuf",
            "-progress",
            "-f FlatGeobuf",
            f'-t_srs "{proj}"',
            f'-nln "{i.path.stem}"',
            f'"{i.path}"',
            f'"/input/GEOPODE_GEOMETRY_EXPORT.gdb"',
            "-dialect SQLite",
            "-sql",
            f'"select *, rowid as row_id FROM \'{i.wfs_typename}\'"',
        ]

        cmd = ' '.join(cmd_parts)

        run_process_stream_output(cmd, cwd=f"{cfg.WORKING_FOLDER}")

def step_rasterize_layers(conn):
    """
    Rasterize layers
    """

    rasterized_dir = cfg.WORKING_FOLDER / "rasterized"
    input_dir = cfg.WORKING_FOLDER / "fixed"

    snap_raster = cfg.WORKING_FOLDER / "pop_proj.tif"

    for f in input_dir.glob("*.fgb"):

        output_tif = (rasterized_dir / f.stem).with_suffix(".tif")

        if f.stem in ["names"]:
            continue

        if not cfg.CLEAN and output_tif.exists():
            log.info(f"{output_tif} exists, continuing")
            continue

        rust_cmd_parts = [
            'cargo',
            'run',
            '--release',
            '--bin cmdline_tools',
            '--',
            'burn-polygon-to-raster',
            #'--layer-name',
            #f'{cfg.SCHEMA_DATA_WORK}.{zone_table}',
            '--ogr-conn-str',
            f'"{f}"',
            '--snap-raster',
            f'"{snap_raster}"',
             '--clean',
            '--output-raster',
            f'"{output_tif}"',
            '--all-touched',
            '--burn-field',
            'orig_fid'
        ]

        rust_cmd = ' '.join(rust_cmd_parts)

        run_process_stream_output(rust_cmd, cwd="/rust")


def step_generate_config(conn):
    """
    Generates json files representing the configuration
    """

    json_dir = cfg.JSON_CFG_DIR
    json_dir.mkdir(parents=True, exist_ok=True)

    data_source_dir = cfg.WORKING_FOLDER / "data_source"
    data_source_dir.mkdir(parents=True, exist_ok=True)


    data_source_dir = cfg.CFG_DATA_SOURCE_PATH
    settlement_path = cfg.CFG_SETTLEMENT_PATH
    boundary_path = cfg.CFG_BOUNDARY_PATH
    json_dir.mkdir(parents=True, exist_ok=True)

    with open(data_source_dir, "w") as f:
        json.dump({
            SOURCE.GRID3_WFS: {
                KEYS.DATA_SOURCE: "https://geoserver.grid3.gov.ng/geoserver/GRIDMaster/ows?SERVICE=WFS&VERSION=1.1.0&REQUEST=GetCapabilities",
                KEYS.SOURCE_FORMAT: GDAL_DRIVER_TYPES.WFS
            },
            SOURCE.GEOPODE_EXPORT: {
                KEYS.DATA_SOURCE: "/input/GEOPODE_GEOMETRY_EXPORT.gdb",
                KEYS.SOURCE_FORMAT: GDAL_DRIVER_TYPES.FILE_GDB
            },
            SOURCE.GEOPODE_WFS: {
                KEYS.SOURCE_FORMAT: GDAL_DRIVER_TYPES.WFS,
                KEYS.DATA_SOURCE: "https://gis.geopode.world/r32DzgDwKk345MU8ar4V/geoserver/nigeria/wms?SERVICE=WFS&VERSION=1.1.0&REQUEST=GetCapabilities",
                KEYS.ENV_USERNAME: "GEOPODE_USERNAME",
                KEYS.ENV_PASSWORD: "GEOPODE_PASSWORD",
            }
        }, f, indent=4, sort_keys=True)

    with open(settlement_path, "w") as f:
        json.dump([
            {
                KEYS.ADMIN_CODE: "WardCode",
                KEYS.SETTLEMENT_TYPE_NAME: "Hamlet Area",
                KEYS.INTERSECTION_PRIORITY: 3,
                KEYS.FILE_STEM: "ha",
                KEYS.SOURCE_ID: SOURCE.GEOPODE_EXPORT,
                KEYS.SOURCE_LAYER: "FE_HamletAreas_Export"
            },
            {
                KEYS.ADMIN_CODE: "WardCode",
                KEYS.SETTLEMENT_TYPE_NAME: "Builtup Area",
                KEYS.INTERSECTION_PRIORITY: 1,
                KEYS.FILE_STEM: "bua",
                KEYS.SOURCE_ID: SOURCE.GEOPODE_EXPORT,
                KEYS.SOURCE_LAYER: "FE_BuiltUpArea_Export"
            },{
                KEYS.ADMIN_CODE: "ward_code",
                KEYS.SETTLEMENT_TYPE_NAME: "Small Settlement Area",
                KEYS.INTERSECTION_PRIORITY: 2,
                KEYS.FILE_STEM: "ssa",
                KEYS.SOURCE_ID: SOURCE.GRID3_WFS,
                KEYS.SOURCE_LAYER: "GRIDMaster:u_fe_smlsettlement_areas"
            }
        ], f, indent=4, sort_keys=True)

    with open(boundary_path, "w") as f:
        json.dump([
            {
                KEYS.BOUNDARY_TYPE_NAME: "Ward",
                KEYS.ADMIN_LEVEL: 3,
                KEYS.FILE_STEM: "ward",
                KEYS.SOURCE_ID: SOURCE.GEOPODE_EXPORT,
                KEYS.SOURCE_LAYER: "Boundary_VaccWards_Export"
            },
            {
                KEYS.BOUNDARY_TYPE_NAME: "LGA",
                KEYS.ADMIN_LEVEL: 2,
                KEYS.FILE_STEM: "lga",
                KEYS.SOURCE_ID: SOURCE.GEOPODE_EXPORT,
                KEYS.SOURCE_LAYER: "Boundary_VaccLGAs_Export"
            },
            {
                KEYS.BOUNDARY_TYPE_NAME: "State",
                KEYS.ADMIN_LEVEL: 1,
                KEYS.FILE_STEM: "state",
                KEYS.SOURCE_ID: SOURCE.GEOPODE_EXPORT,
                KEYS.SOURCE_LAYER: "Boundary_VaccStates_Export"
            }
        ], f, indent=4, sort_keys=True)

    with open(cfg.CFG_HEALTH_FACILITY_PATH, "w") as f:
        json.dump([
            {
                KEYS.FILE_STEM: "hf",
                KEYS.SOURCE_ID: SOURCE.GRID3_WFS,
                KEYS.SOURCE_LAYER: "GRIDMaster:u_fc_healthcare_facilities",
                KEYS.IS_POINT: True
            },

        ], f, indent=4, sort_keys=True)



def step_reproject_pop_raster(conn):
    """
    Reprojects the population raster
    """

    from osgeo import ogr
    inDriver = ogr.GetDriverByName("FlatGeobuf")

    inDataSource = inDriver.Open(str(cfg.INPUT_FILES[0].path), 0)
    inLayer = inDataSource.GetLayer()
    extent = inLayer.GetExtent()

    log.info(extent)

    min_x, max_x, min_y, max_y = extent

    output_path = cfg.WORKING_FOLDER / "pop_proj.tif"

    if output_path.exists() and not cfg.CLEAN:
        log.info(f"{output_path} exists")
        return

    proj = cfg.PROJ_STR.read_text(encoding="UTF-8")

    # [, 2.6687637405272837] [12.920750077578427, 12.91986348166899]
    #
    origin_x = 2.668750004
    test_x = 2.667821701900319
    width_x = 0.0008333333299798793

    x = (test_x - origin_x)
    print(x)
    x = x / width_x
    print(x)

    #return

    pixel_width = 100.0
    num_rows = math.ceil( (max_y - min_y) / pixel_width )
    num_cols = math.ceil( (max_x - min_x) / pixel_width )

    cmd_parts = [
        "cargo",
        "run",
        "--release",
        "--bin=raster_resample",
        '--',
        f'--input="{cfg.POP_RASTER_INPUT}"',
        f'--output="{output_path}"',
        f'--projection-proj4="{proj}"',
        f'--origin-x={min_x}',
        f'--origin-y={max_y}',
        f'--num-rows={num_rows}',
        f'--num-cols={num_cols}',
        f'--pixel-width={pixel_width}',
        f'--pixel-height={-pixel_width}',
    ]

    if cfg.CLEAN:
        cmd_parts.append('--clean')

    cmd = ' '.join(cmd_parts)

    run_process_stream_output(cmd, cwd="/rust")

    cmd_parts = [
        "cargo",
        "run",
        "--release",
        "--bin=raster_resample",
        '--',
        f'--input="{cfg.POP_RASTER_INPUT}"',
        f'--output="{output_path}"',
        f'--projection="3857"',
        f'--origin-x={min_x}',
        f'--origin-y={max_y}',
        f'--num-rows={num_rows}',
        f'--num-cols={num_cols}',
        f'--pixel-width={pixel_width}',
        f'--pixel-height={-pixel_width}',
    ]

    if cfg.CLEAN:
        cmd_parts.append('--clean')

    cmd = ' '.join(cmd_parts)

    run_process_stream_output(cmd, cwd="/rust")

def create_pop_raster_3857_extent(ward_code):
    """
    Produces raster for just the configured extent
    """

    from osgeo import gdal

    raster_path = cfg.WORKING_FOLDER / "pop_proj_3857.tif"

    subset = cfg.WORKING_FOLDER / "processed" / ward_code / "pop_3857_extent.tif"

    if cfg.CLEAN:
        file_utils.remove_file(subset)

    if subset.exists():
        log.info(f"{subset} exists, skipping...")
        return

    dataset = gdal.Open(str(raster_path), gdal.GA_ReadOnly)

    rs = RasterStats.from_gdal_dataset(dataset)

    log.info(rs)

    # Reproject the extent to 3857
    from osgeo import ogr
    from osgeo import osr

    sr_4326 = osr.SpatialReference()
    sr_4326.ImportFromEPSG(4326)  # WGS84/Geographic
    sr_4326.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER);
    sr_3857 = osr.SpatialReference()
    sr_3857.ImportFromEPSG(3857)  # WGS84 UTM Zone 56 South

    top_left = ogr.Geometry(ogr.wkbPoint)
    top_left.AddPoint(cfg.EXTENT.min_x, cfg.EXTENT.max_y)  # use your coordinates here
    top_left.AssignSpatialReference(sr_4326)  # tell the point what coordinates it's in
    top_left.TransformTo(sr_3857)  # project it to the out spatial reference

    bottom_right = ogr.Geometry(ogr.wkbPoint)
    bottom_right.AddPoint(cfg.EXTENT.max_x, cfg.EXTENT.min_y)  # use your coordinates here
    bottom_right.AssignSpatialReference(sr_4326)  # tell the point what coordinates it's in
    bottom_right.TransformTo(sr_3857)  # project it to the out spatial reference

    assert cfg.EXTENT.min_y < cfg.EXTENT.max_y
    assert bottom_right.GetY() < top_left.GetY()

    log.info(f"3857 {top_left} {bottom_right}")

    x_col_left = math.floor(rs.get_col_as_float(top_left.GetX()))
    x_col_right = math.ceil(rs.get_col_as_float(bottom_right.GetX()))
    y_row_top = math.floor(rs.get_row_as_float(top_left.GetY()))
    y_row_bottom = math.ceil(rs.get_row_as_float(bottom_right.GetY()))

    log.info(f"Subset {x_col_left} {x_col_right} rows {y_row_top} {y_row_bottom}")

    cmd_parts = [
        "gdal_translate",
        f'"{raster_path}"',
        f'"{subset}"',
        f"-srcwin {x_col_left} {y_row_top} {x_col_right-x_col_left+1} {y_row_bottom-y_row_top+1}",
    ]

    cmd = ' '.join(cmd_parts)

    run_process_stream_output(cmd, cwd="/rust")


def create_friction_raster_3857_extent(ward_code):
    """
    Produces raster for just the configured extent
    """

    from osgeo import gdal

    raster_path = cfg.WORKING_FOLDER / "friction_proj_3857.tif"

    subset = cfg.WORKING_FOLDER / "processed" / ward_code / "friction_3857_extent.tif"

    if cfg.CLEAN:
        file_utils.remove_file(subset)

    if subset.exists():
        log.info(f"{subset} exists, skipping...")
        return

    dataset = gdal.Open(str(raster_path), gdal.GA_ReadOnly)

    rs = RasterStats.from_gdal_dataset(dataset)

    log.info(rs)

    # Reproject the extent to 3857
    from osgeo import ogr
    from osgeo import osr

    sr_4326 = osr.SpatialReference()
    sr_4326.ImportFromEPSG(4326)  # WGS84/Geographic
    sr_4326.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER);
    sr_3857 = osr.SpatialReference()
    sr_3857.ImportFromEPSG(3857)  # WGS84 UTM Zone 56 South

    top_left = ogr.Geometry(ogr.wkbPoint)
    top_left.AddPoint(cfg.EXTENT.min_x, cfg.EXTENT.max_y)  # use your coordinates here
    top_left.AssignSpatialReference(sr_4326)  # tell the point what coordinates it's in
    top_left.TransformTo(sr_3857)  # project it to the out spatial reference

    bottom_right = ogr.Geometry(ogr.wkbPoint)
    bottom_right.AddPoint(cfg.EXTENT.max_x, cfg.EXTENT.min_y)  # use your coordinates here
    bottom_right.AssignSpatialReference(sr_4326)  # tell the point what coordinates it's in
    bottom_right.TransformTo(sr_3857)  # project it to the out spatial reference

    assert cfg.EXTENT.min_y < cfg.EXTENT.max_y
    assert bottom_right.GetY() < top_left.GetY()

    log.info(f"3857 {top_left} {bottom_right}")

    x_col_left = math.floor(rs.get_col_as_float(top_left.GetX()))
    x_col_right = math.ceil(rs.get_col_as_float(bottom_right.GetX()))
    y_row_top = math.floor(rs.get_row_as_float(top_left.GetY()))
    y_row_bottom = math.ceil(rs.get_row_as_float(bottom_right.GetY()))

    log.info(f"Subset {x_col_left} {x_col_right} rows {y_row_top} {y_row_bottom}")

    cmd_parts = [
        "gdal_translate",
        f'"{raster_path}"',
        f'"{subset}"',
        f"-srcwin {x_col_left} {y_row_top} {x_col_right-x_col_left+1} {y_row_bottom-y_row_top+1}",
    ]

    cmd = ' '.join(cmd_parts)

    run_process_stream_output(cmd, cwd="/rust")

def step_reproject_friction_raster_3857():
    """
    Gets friction raster to 3857
    """

    output_path = cfg.FRICTION_WALK_RASTER_OUTPUT

    pop_path = cfg.POP_RASTER_OUTPUT

    cmd_parts = [
        "cargo",
        "run",
        "--release",
        "--bin=raster_resample",
        '--',
        f'--input="{cfg.FRICTION_WALK_RASTER_INPUT}"',
        f'--output="{output_path}"',
        f'--snap="{pop_path}"',
    ]

    if cfg.CLEAN:
        cmd_parts.append('--clean')

    cmd = ' '.join(cmd_parts)

    run_process_stream_output(cmd, cwd="/rust")



def step_reproject_mixed_friction_raster_3857():
    """
    Gets friction raster to 3857
    """

    output_path = cfg.WORKING_FOLDER / "friction_mixed_proj_3857.tif"

    pop_path = cfg.WORKING_FOLDER / "pop_proj_3857.tif"

    cmd_parts = [
        "cargo",
        "run",
        "--release",
        "--bin=raster_resample",
        '--',
        f'--input="{cfg.FRICTION_MIXED_RASTER_INPUT}"',
        f'--output="{output_path}"',
        f'--snap="{pop_path}"',
    ]

    if cfg.CLEAN:
        cmd_parts.append('--clean')

    cmd = ' '.join(cmd_parts)

    run_process_stream_output(cmd, cwd="/rust")


def step_reproject_pop_raster_3857(conn):
    """
    Reprojects the population raster.

    Note this needs the boundaries to be imported to the
    local docker GMT database
    """

    # Get the extent from the current imported boundary layer
    sql = f"""
    SELECT ST_Xmin(ex), ST_Xmax(ex), ST_Ymin(ex), ST_Ymax(ex) FROM 
(
    SELECT ST_Transform( ST_SetSRID(ST_Extent(geom), 4326), 3857) AS ex 
    FROM boundary.polygon_latest
) sq         
    """

    extent = db_utils.get_results(conn, sql)

    log.info(f"Extent {extent}")
    min_x, max_x, min_y, max_y = extent[0]

    output_path = cfg.POP_RASTER_OUTPUT

    if output_path.exists():
        log.info(f"{output_path} exists")
        return

    pixel_width = 100.0
    num_rows = math.ceil( (max_y - min_y) / pixel_width )
    num_cols = math.ceil( (max_x - min_x) / pixel_width )

    cmd_parts = [
        "cargo",
        "run",
        "--release",
        "--bin=raster_resample",
        '--',
        f'--input="{cfg.POP_RASTER_INPUT}"',
        f'--output="{output_path}"',
        f'--projection="3857"',
        f'--origin-x={min_x}',
        f'--origin-y={max_y}',
        f'--num-rows={num_rows}',
        f'--num-cols={num_cols}',
        f'--pixel-width={pixel_width}',
        f'--pixel-height={-pixel_width}',
    ]

    if cfg.CLEAN:
        cmd_parts.append('--clean')

    cmd = ' '.join(cmd_parts)

    run_process_stream_output(cmd, cwd="/rust")


def step_copy_to_input():
    """
    Copies reprojected rasters to input directory
    """

    for src_path in [
        cfg.POP_RASTER_OUTPUT,
        cfg.FRICTION_MIXED_RASTER_OUTPUT,
        cfg.FRICTION_WALK_RASTER_OUTPUT
    ]:
        dest_path = cfg.RASTER_INPUT_DIR / src_path.name

        if cfg.CLEAN and dest_path.exists():
            dest_path.unlink()

        if dest_path.exists():
            log.info(f"Not copying to {dest_path}")
            continue

        log.info(f"copying from {src_path} to {dest_path}")
        shutil.copyfile(src_path, dest_path)



def step_run_microplan(conn):

    """
    Creates /working/hf_assignment.tif
    """

    cmd_parts = [
        "cargo",
        "run",
        "--release",
        "--bin=microplan",
        '--',
    ]

    cmd = ' '.join(cmd_parts)

    run_process_stream_output(cmd, cwd="/rust")


def calculate_extent(ward_name):
    """
    Calculate extent of certains wards
    """


    conn_string = cfg.WORKING_FOLDER / "processed" / "ward.fgb"
    ds = ogr.Open(str(conn_string))
    lyr = ds.GetLayer('ward')
    #SELECT * FROM ward WHERE  = 'alwasa'
    lyr.SetAttributeFilter(f"WardName = '{ward_name}'")

    log.info(f"Layer Feature Count: {lyr.GetFeatureCount()}")

    source = osr.SpatialReference()
    source.ImportFromEPSG(3857)

    target = osr.SpatialReference()
    target.ImportFromEPSG(4326)

    transform = osr.CoordinateTransformation(source, target)

    for feature in lyr:
        geom = feature.GetGeometryRef()
        geom.Transform(transform)
        extent = geom.GetEnvelope()

        log.info(f"Extent is {extent}")

        cfg.EXTENT.min_y = extent[0]
        cfg.EXTENT.max_y = extent[1]
        cfg.EXTENT.min_x = extent[2]
        cfg.EXTENT.max_x = extent[3]

        return feature.GetField("WardCode")

    log.error(f"Cannot find ward for name [{ward_name}]")

def layers_to_geojson(ward_code):
    """
    Choose by a certain extent and also convert to geojson
    """

    output_dir = cfg.WORKING_FOLDER / "processed" / ward_code

    for fgb in output_dir.parent.glob("*.fgb"):

        output_path = output_dir / fgb.with_suffix(".geojson").name

        if not cfg.CLEAN and output_path.exists():
            log.info(f"{output_path} exists, skipping...")
            continue

        file_utils.remove_file(output_path)

        cmd_parts = [
            "ogr2ogr",
            "-f GeoJSON",
            "-spat_srs EPSG:4326",
            f"-spat {cfg.EXTENT.min_x} {cfg.EXTENT.min_y} {cfg.EXTENT.max_x} {cfg.EXTENT.max_y}",
            "-progress",
            f'"{output_path}"',
            f'"{fgb}"',
        ]

        cmd = ' '.join(cmd_parts)

        run_process_stream_output(cmd, cwd=f"{cfg.WORKING_FOLDER}")


def step_layers_to_fgb(conn):
    """
    For all the input layers, will:

    -Fix any invalid geometries
    -Reproject to 3857
    -Convert to FGB.  This is chosen as this will store the entire countries data, so we want
    a compact format

    """

    output_dir = cfg.WORKING_FOLDER / "processed"

    output_dir.mkdir(parents=True, exist_ok=True)

    with open(cfg.CFG_DATA_SOURCE_PATH) as f:
        data_source_cfg = json.load(f)

    # First the admin boundaries
    with open(cfg.CFG_BOUNDARY_PATH) as f:
        admin_cfg = json.load(f)
    with open(cfg.CFG_SETTLEMENT_PATH) as f:
        settlement_cfg = json.load(f)
    with open(cfg.CFG_HEALTH_FACILITY_PATH) as f:
        hf_cfg = json.load(f)

    for layer in admin_cfg + settlement_cfg + hf_cfg:

        data_source = data_source_cfg[layer[KEYS.SOURCE_ID]]

        output_path = (output_dir / layer[KEYS.FILE_STEM]).with_suffix(".fgb")

        if not cfg.CLEAN and output_path.exists():
            log.info(f"{output_path} exists")
            continue

        if cfg.CLEAN and output_path.exists():
            file_utils.remove_file(output_path)

        cmd_parts = [
            "cargo",
            "run",
            "--release",
            "--bin=cmdline_tools",
            '--',
            'fix-geom',
            f'--input-layer="{layer[KEYS.SOURCE_LAYER]}"',
            f'--input-dataset="{data_source[KEYS.DATA_SOURCE]}"',
            f'--proj-epsg=3857',
            '--output-format="FlatGeoBuf"',
            f'--output-dataset="{output_path}"',
            f'--is-point="{data_source.get(KEYS.IS_POINT, False)}"',
        ]

        cmd = ' '.join(cmd_parts)

        run_process_stream_output(cmd, cwd="/rust")


def step_correct_layers_old(conn):
    """
    Downloads all layers
    """

    input_dir = cfg.WORKING_FOLDER / "projected"
    output_dir = cfg.WORKING_FOLDER / "fixed"

    output_dir.mkdir(parents=True, exist_ok=True)

    for f in input_dir.glob("*.fgb"):

        if f.stem in ["hf", "names"]:
            continue

        output_path = (output_dir / f.stem).with_suffix(".fgb")

        if not cfg.CLEAN and output_path.exists():
            log.info(f"{output_path} exists")
            continue

        if cfg.CLEAN and output_path.exists():
            output_path.unlink()


        cmd_parts = [
            "cargo",
            "run",
            "--release",
            "--bin=cmdline_tools",
            '--',
            'fix-geom',
            f'--input-layer="{f.stem}"',
            f'--input-dataset="{f}"',
            f'--output-dataset="{output_path}"',

        ]

        cmd = ' '.join(cmd_parts)

        run_process_stream_output(cmd, cwd="/rust")

def step_copy_admin_layers(conn):
    """
    Copies administration layers
    """

    schema_name = "public"
    table_name = "admin"

    if not cfg.CLEAN and db_utils.table_exists(conn, schema_name, table_name):
        log.info("Table exists")
        return

    db_utils.run_sql(conn, f"""
    
    DROP TABLE IF EXISTS {schema_name}.{table_name};
    
    CREATE TABLE {schema_name}.{table_name} (
        id serial PRIMARY KEY,
        shape Geometry(MultiPolygon, 3857),
        level smallint NOT NULL,
        parent_code text,
        code text NOT NULL, 
        name text NOT NULL 
    );
    
    """)

    for admin_level in range(1,4):

        sql = None
        if admin_level == 1:
            sql = f"SELECT GEOMETRY, 1 as level, state_code as code, state_name as name FROM admin1"
        elif admin_level == 2:
            sql = f"SELECT GEOMETRY, 2 as level, lga_code as code, lga_name as name, state_code as parent_code FROM admin2"
        elif admin_level == 3:
            sql = f"SELECT GEOMETRY, 3 as level, ward_code as code, ward_name as name, lga_code as parent_code FROM admin3"

        cmd_parts = [
            "ogr2ogr",
            "-f PostgreSQL",
            "-update",
            "-append",
            "-progress",
            '-t_srs EPSG:3857',
            '-dialect SQLITE',
            f'-nln "{schema_name}.{table_name}"',
            f'"{db_utils.get_ogr_connection_string(cfg)}"',
            f'"/working/fixed/admin{admin_level}.fgb"'

        ]

        if sql:
            cmd_parts.append(f'-sql "{sql}"')

        cmd = ' '.join(cmd_parts)

        run_process_stream_output(cmd, cwd=f"{cfg.WORKING_FOLDER}")


def step_copy_settlement_layers(conn):
    """
    Copies settlement layers
    """

    schema_name = "public"
    table_name = "settlement"

    if not cfg.CLEAN and db_utils.table_exists(conn, schema_name, table_name):
        log.info("Table exists")
        return

    db_utils.run_sql(conn, f"""

    DROP TABLE IF EXISTS {schema_name}.{table_name};

    CREATE TABLE {schema_name}.{table_name} (
        id serial PRIMARY KEY,
        shape Geometry(MultiPolygon, 3857),
        level smallint NOT NULL,
        admin_code text,
        name text  
    );

    """)

    for settlement_level in range(1, 4):

        sql = None
        if settlement_level == 1:
            sql = f"SELECT GEOMETRY, 1 as level, SettlementName as name FROM settlement1"
        elif settlement_level == 2:
            sql = f"SELECT GEOMETRY, 2 as level, name_calc as name FROM settlement2"
        elif settlement_level == 3:
            sql = f"SELECT GEOMETRY, 3 as level, SettlementName as name FROM settlement3"

        cmd_parts = [
            "ogr2ogr",
            "-f PostgreSQL",
            "-update",
            "-append",
            "-progress",
            '-t_srs EPSG:3857',
            '-dialect SQLITE',
            f'-nln "{schema_name}.{table_name}"',
            f'"{db_utils.get_ogr_connection_string(cfg)}"',
            f'"/working/fixed/settlement{settlement_level}.fgb"'

        ]

        if sql:
            cmd_parts.append(f'-sql "{sql}"')

        cmd = ' '.join(cmd_parts)

        run_process_stream_output(cmd, cwd=f"{cfg.WORKING_FOLDER}")


def step_copy_hf_layer(conn):
    """
    Copies settlement layers
    """

    schema_name = "public"
    table_name = "hf"

    if not cfg.CLEAN and db_utils.table_exists(conn, schema_name, table_name):
        log.info("Table exists")
        return

    db_utils.run_sql(conn, f"""

    DROP TABLE IF EXISTS {schema_name}.{table_name};

    CREATE TABLE {schema_name}.{table_name} (
        --will be set to row_id
        {table_name}_id int ,
        shape Geometry(Point, 3857),        
        category text,
        ownership text,
        admin_code text,
        functional_status text,
        global_id uuid
    );

    """)


    sql = f"SELECT *, row_id as {table_name}_id FROM {table_name}"


    cmd_parts = [
        "ogr2ogr",
        "-f PostgreSQL",
        "-update",
        "-append",
        "-progress",
        '-t_srs EPSG:3857',
        '-dialect SQLITE',
        f'-nln "{schema_name}.{table_name}"',
        f'"{db_utils.get_ogr_connection_string(cfg)}"',
        f'"/working/projected/hf.fgb"'

    ]

    if sql:
        cmd_parts.append(f'-sql "{sql}"')

    cmd = ' '.join(cmd_parts)

    run_process_stream_output(cmd, cwd=f"{cfg.WORKING_FOLDER}")

    db_utils.set_primary_key(conn, schema_name, table_name, f"{table_name}_id")

def create_hf_catchment_polygons(conn):
    """
    Creates polygons out of the raster of hf assignment
    """

    schema_name = "public"
    table_name = "hf_catch"

    if not cfg.CLEAN and db_utils.table_exists(conn, schema_name, table_name):
        log.info("Table exists")
        return

    target_file = cfg.MISC_PATH / "hf_catch.fgb"

    cmd_parts = [
        "gdal_polygonize.py",
        f'"/working/hf_assignment.tif"',
        "-f FlatGeoBuf",
        f'"{target_file}"',
        f'"{target_file.stem}"',
        'hf_id'

    ]

    cmd = ' '.join(cmd_parts)

    run_process_stream_output(cmd, cwd=f"{cfg.WORKING_FOLDER}")

    db_utils.run_sql(conn, f"""

        DROP TABLE IF EXISTS {schema_name}.{table_name};

        CREATE TABLE {schema_name}.{table_name} (
            {table_name}_id serial PRIMARY KEY,
            shape Geometry(Polygon, 3857),        
            hf_id int REFERENCES {schema_name}.hf (hf_id)
        );

        """)

    sql = f"SELECT * FROM {table_name}"

    cmd_parts = [
        "ogr2ogr",
        "-f PostgreSQL",
        "-update",
        "-append",
        "-progress",
        '-t_srs EPSG:3857',
        '-dialect SQLITE',
        f'-nln "{schema_name}.{table_name}"',
        f'"{db_utils.get_ogr_connection_string(cfg)}"',
        f'"{target_file}"'

    ]

    if sql:
        cmd_parts.append(f'-sql "{sql}"')

    cmd = ' '.join(cmd_parts)

    run_process_stream_output(cmd, cwd=f"{cfg.WORKING_FOLDER}")


def step_do_wards():
    """
    Exports stuff for wards
    """
    ward_names = ["alwasa", "felande", "lailaba", "gulma", "sauwa", "zazzagawa", "gwazange", "gunna south", "oporoma 1"]

    all_wards = []
    for ward_name in ward_names:
        ward_code = calculate_extent(ward_name)

        if not ward_code:
            continue

        ward_name_file_path = cfg.WORKING_FOLDER / "processed" / ward_code / "ward_name.txt"
        ward_name_file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(ward_name_file_path, "w") as f:
            f.write(ward_name)

        log.info(f"Ward name {ward_name} ward code {ward_code}")
        layers_to_geojson(ward_code)
        create_pop_raster_3857_extent(ward_code)
        create_friction_raster_3857_extent(ward_code)

        all_wards.append({
            "name": ward_name,
            "code": ward_code,
            "extent": {
                "min_x": cfg.EXTENT.min_x,
                "min_y": cfg.EXTENT.min_y,
                "max_x": cfg.EXTENT.max_x,
                "max_y": cfg.EXTENT.max_y,
            }
        })

    wards_file_path = cfg.WORKING_FOLDER / "processed" / "wards.txt"
    with open(wards_file_path, "w") as f:
        f.write(json.dumps(all_wards, indent=4))

def step_take_screenshots():
    """
    SS
    """
    #http://localhost:8081/?zoom=12.00&x_min=4.243006235000053&y_min=12.651679306000052&x_max=4.519295397000064&y_max=12.820359434000064&admin_code=50311&x_lon=4.3811508160000585&y_lat=12.736019370000065&split_tool=ByTravelTime

    wards_file_path = cfg.WORKING_FOLDER / "processed" / "wards.txt"
    with open(wards_file_path, "r") as f:
        all_admins = json.loads(f.read())

    #
    for admin in all_admins:

        admin_code = admin["code"]
        admin_name = admin["name"]
        x_min = admin["extent"]["min_x"]
        y_min = admin["extent"]["min_y"]
        x_max = admin["extent"]["max_x"]
        y_max = admin["extent"]["max_y"]
        for split_type in ["ByTravelTime", "ByDistance"]:
            screenshot_path = cfg.WORKING_FOLDER / "screenshots" / f"{admin_name}_{admin_code}_{split_type}.png"
            screenshot_path.parent.mkdir(parents=True, exist_ok=True)
            url = f"http://host.docker.internal:8081/?x_min={x_min}&y_min={y_min}&x_max={x_max}&y_max={y_max}&admin_code={admin_code}&split_tool={split_type}"

            cmd_parts = [
                'node',
                'get_ss.js',
                f"'{url}'",
                f"'{screenshot_path}'",
            ]

            cmd = ' '.join(cmd_parts)

            #log.info(cmd)

            run_process_stream_output(cmd, cwd="/shell/url_capture")