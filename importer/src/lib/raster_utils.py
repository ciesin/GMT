import math
import numpy as np
from osgeo import gdal
import logging
import timeit
import rasterio
from rasterio._io import DatasetReaderBase
from rasterio.windows import Window
from affine import Affine
from decimal import Decimal
from pathlib import Path
from typing import List, Tuple, Union, Dict
from shapely.geometry import Point, mapping
import pandas as pd
from fiona import collection
from fiona.crs import from_epsg
from lib.db_utils import get_results
from lib.file_utils import remove_file
from dataclasses import dataclass

log = logging.getLogger(__name__)

# Surpress rasterio verbosity
from rasterio import log as rasterio_log
rasterio_log.setLevel(logging.ERROR)

@dataclass
class RasterStats:
    """
    Stats helper using gdal directly
    """
    pixel_width: float = None
    pixel_height: float = None
    num_cols: int = None
    num_rows: int = None
    origin_x: float = None
    origin_y: float = None

    @staticmethod
    def from_gdal_dataset(dataset):
        geotransform = dataset.GetGeoTransform()

        return RasterStats(
            num_cols=dataset.RasterXSize,
            num_rows = dataset.RasterYSize,
            origin_x=geotransform[0],
            origin_y=geotransform[3],
            pixel_width = geotransform[1],
            pixel_height = geotransform[5],
        )

    def get_col_as_float(self, x):
        return (x - self.origin_x) / self.pixel_width

    def get_x_for_col(self, col):
        # left of the square
        return self.origin_x + col * self.pixel_width

    def right_x(self):
        return self.get_x_for_col(self.num_cols)

    def get_row_as_float(self, y):
        assert self.pixel_height < 0
        return (y - self.origin_y) / self.pixel_height

    def get_y_for_row(self, row):
        # top of the square
        assert self.pixel_height < 0
        return self.origin_y + row * self.pixel_height

    def bottom_y(self):
        return self.get_y_for_row(self.num_rows)


def create_raster(
        origin: Union[List, Tuple, Point] = None,
        pixel_width: float = None,
        pixel_height: float = None,
        width: int = None,
        height: int = None,
        affine: Affine = None,
        value: Union[int, float, np.ndarray] = None,
        nodata: Union[int, float] = None,
        srid: int = 4326,
        dtype: str = None,
        raster_out: Union[str, Path] = None
    ) -> Union[Path, rasterio.MemoryFile]:
    """
    Creates a raster for testing purposes. Raster characteristics can
    be individually specified or provided by a numpy array and / or a
    rasterio affine. The output raster can be written to a file or to memory,
    if the target raster is not specified.
    """

    # Check and update parameters
    if not isinstance(origin, Geometry):
        origin = Geometry(origin, srid=srid)
    origin = origin.transform(srid)
    if isinstance(value, np.ndarray):

        if height is not None:
            assert height == value.shape[0]
        if width is not None:
            assert width == value.shape[1]

        height, width = value.shape
    else:
        value = np.full((height, width), fill_value=value, dtype=dtype or 'int16' if isinstance(value, int) else 'float32')
    if dtype is None:
        dtype = value.dtype
    if not isinstance(value, Affine):
        affine = Affine(pixel_width, 0.0, origin.x, 0.0, -pixel_height, origin.y)

    # Create raster profile
    profile = dict(
        driver='GTiff',
        interleave='band',
        tiled=True,
        blockxsize=256,
        blockysize=256,
        compress='lzw',
        # allow None for no data
        nodata=nodata,
        dtype=dtype,
        width=width,
        height=height,
        count=1,
        transform=affine,
        crs=rasterio.crs.CRS.from_epsg(int(srid))
    )

    log.info(f"Creating a raster with {affine}, width {width}, height {height}")

    # Write and return raster
    if raster_out is None:
        raster_out = rasterio.MemoryFile()
        with raster_out.open(**profile) as target:
            target.write(value.astype(dtype), 1)
    else:
        with rasterio.open(raster_out, 'w', **profile) as target:
            target.write(value.astype(dtype), 1)
    return Path(raster_out) if isinstance(raster_out, str) else raster_out



def resize_raster_by_pixel(
        raster_source: Union[str, Path, rasterio.MemoryFile],
        raster_out: Union[str, Path],
        value: Union[int, float] = None,
        pixel: int = 0
    ):
    """
    Creates a resized copy of a raster which is x pixels smaller or larger the source.
    Negative pixel will shrink, positive pixel will extend the raster.
    If no value is provided, additionally added area will be filled by the source's NODATA.
    """
    try:
        with rasterio.open(raster_source, 'r') as source:
            profile = get_raster_profile(source)
            read_window = rasterio.windows.Window(
                col_off=-pixel if pixel < 0 else 0,
                row_off=-pixel if pixel < 0 else 0,
                width=source.width + 2 * pixel if pixel < 0 else source.width,
                height=source.height + 2 * pixel if pixel < 0 else source.height,
            )
            write_window = rasterio.windows.Window(
                col_off=pixel if pixel > 0 else 0,
                row_off=pixel if pixel > 0 else 0,
                width=source.width + 2 * pixel if pixel < 0 else source.width,
                height=source.height + 2 * pixel if pixel < 0 else source.height,
            )
            resized_window = rasterio.windows.Window(
                col_off=-pixel,
                row_off=-pixel,
                width=source.width + 2 * pixel,
                height=source.height + 2 * pixel,
            )
            if pixel and abs(pixel) * 2 > min(source.width, source.height):
                raise Exception(f'Cannot shrink raster by more than {math.floor(min(source.width, source.height)/2)} pixel')
            profile['transform'] = source.window_transform(resized_window)
            profile['width'] = source.width + 2 * pixel
            profile['height'] = source.height + 2 * pixel
            with rasterio.open(raster_out, 'w', **profile) as target:
                for band in range(profile['count']):
                    band += 1
                    if value:
                        target.write(np.full([profile['width'], profile['height']], value, dtype=profile['dtype']), band)
                    target.write(source.read(band, window=read_window), band, window=write_window)
    except Exception as e:
        raise Exception(f'Cannot resize raster by {pixel} pixel ({e})')


def resize_raster_by_percent(
        raster_source: Union[str, Path, rasterio.MemoryFile],
        raster_out: Union[str, Path],
        value: Union[int, float] = None,
        scalar: float = 1.0
    ):
    """
    Creates a scaled copy of a raster which is x percent smaller or larger than the source.
    A scalar between 0-1 will shrink, and >1 will extend the raster.
    If no value is provided, additionally added area will be filled by the source's NODATA.
    """
    try:
        scalar = float(scalar)
        if scalar <= 0:
            raise Exception(f'Cannot shrink raster by negative or zero %')
        with rasterio.open(raster_source, 'r') as source:
            pixel_x = round((scalar * source.width - source.width) / 2)
            pixel_y = round((scalar * source.height - source.height) / 2)

            profile = get_raster_profile(source)
            read_window = rasterio.windows.Window(
                col_off=-pixel_x if pixel_x < 0 else 0,
                row_off=-pixel_y if pixel_y < 0 else 0,
                width=source.width + 2 * pixel_x if pixel_x < 0 else source.width,
                height=source.height + 2 * pixel_y if pixel_y < 0 else source.height,
            )
            write_window = rasterio.windows.Window(
                col_off=pixel_x if pixel_x > 0 else 0,
                row_off=pixel_y if pixel_y > 0 else 0,
                width=source.width + 2 * pixel_x if pixel_x < 0 else source.width,
                height=source.height + 2 * pixel_y if pixel_y < 0 else source.height,
            )
            resized_window = rasterio.windows.Window(
                col_off=-pixel_x,
                row_off=-pixel_y,
                width=source.width + 2 * pixel_x,
                height=source.height + 2 * pixel_y,
            )
            if abs(pixel_x) * 2 > source.width or abs(pixel_y) * 2 > source.height:
                raise Exception(f'Cannot shrink raster by more than {round((source.width - math.floor(source.width / 2)) / source.width, 2) * 100} %')
            profile['transform'] = source.window_transform(resized_window)
            profile['width'] = source.width + 2 * pixel_x
            profile['height'] = source.height + 2 * pixel_y
            with rasterio.open(raster_out, 'w', **profile) as target:
                for band in range(profile['count']):
                    band += 1
                    if value:
                        target.write(np.full([profile['width'], profile['height']], value, dtype=profile['dtype']), band)
                    target.write(source.read(band, window=read_window), band, window=write_window)
    except Exception as e:
        raise Exception(f'Cannot resize raster by {scalar*100}% ({e})')


def create_csv_from_raster(
        raster_source: Union[Path, str, rasterio.MemoryFile],
        csv_out: Union[Path, str],
        band: int = 1,
        nodata: Union[int, float, str] = 0,
        ignore_nodata: bool = True,
        field_name: str = 'value'
    ):
    """
    Creates a CSV file from a raster file with point coordinates where each point
    represents the centroid of a pixel. Each point gets the pixel value assigned.
    """

    # Create CSV file
    with open(csv_out, 'w') as csv_file:

        # Write header
        csv_file.write('x,y,population\n')

        # Add to CSV blockwise point coordinates and value
        with rasterio.open(raster_source, 'r') as raster:
            lng_start = raster.transform.xoff
            lat_start = raster.transform.yoff
            lng_shift = raster.transform.a
            lat_shift = raster.transform.e
            raster_nodata = raster.profile["nodata"]
            raster_pixels = raster.width * raster.height
            raster_block_pixels = raster.block_shapes[0][0] * raster.block_shapes[0][1]
            raster_block_count = int(raster_pixels / raster_block_pixels)
            block_steps = max(1, int(1000000 / raster_block_pixels))

            print(f'Around raster ~{raster_block_count} blocks to process in ~{int(raster_block_count / block_steps)} write steps')

            block_count = 0
            block_points = []
            block_time = []
            write_time = []

            for block in raster.block_windows(band):

                start = timeit.default_timer()

                x_off = block[1].col_off
                y_off = block[1].row_off

                block_width = block[1].width
                block_height = block[1].height

                lng_block_start = lng_start + x_off * lng_shift
                lat_block_start = lat_start + y_off * lat_shift

                block_data = raster.read(1, window=block[1])

                for x in range(0, block_width):
                    for y in range(0, block_height):
                        lng_point = lng_block_start + (x + 0.5) * lng_shift
                        lat_point = lat_block_start + (y + 0.5) * lat_shift
                        value = block_data[y][x]
                        if np.isnan(value) or value == raster_nodata:
                            if ignore_nodata:
                                continue
                            else:
                                value = nodata
                        block_points.append(f'{lng_point},{lat_point},{value}\n')

                # Write results every nth block & measure time
                block_count += 1
                block_time.append(timeit.default_timer() - start)
                if block_count % block_steps == 0:
                    average_block_time = sum(block_time) / block_steps
                    block_time = []
                    print('  writing', len(block_points), f'points ({block_steps} blocks) ...')
                    write_start = timeit.default_timer()
                    csv_file.writelines(block_points)
                    block_points = []
                    write_time.append(timeit.default_timer() - write_start)
                    average_write_time = sum(write_time) / len(write_time)
                    remaining_time = (raster_block_count - block_count) * average_block_time + (
                                raster_block_count - block_count) / block_steps * average_write_time
                    print(
                        f'  ... remaining time (for {raster_block_count - block_count} blocks)',
                        f'{round(remaining_time / 60, 2)} minutes' if remaining_time < 3600 else f'{round(remaining_time / 3600, 2)} hours',
                        f'(Read: ~{round(average_block_time, 4)} seconds per block | Write operation: ~{round(average_write_time, 4)} seconds)'
                    )


def create_shapefile_from_raster(
        raster_source: Union[Path, str, rasterio.MemoryFile],
        shape_out: Union[Path, str],
        band: int = 1,
        nodata: Union[int, float, str] = 0,
        ignore_nodata: bool = True,
        field_name: str = 'value'
):
    """
    Creates a Shapefile (Point) from a raster file where each point represents
    the centroid of a pixel. Each point gets the pixel value assigned.
    """

    # TODO: Writing shapefile with a lot of points is very slow (https://fiona.readthedocs.io/en/latest/manual.html#writing-vector-data)

    point_count = 0

    # Open raster
    with rasterio.open(raster_source, 'r') as raster:
        lng_start = raster.transform.xoff
        lat_start = raster.transform.yoff
        lng_shift = raster.transform.a
        lat_shift = raster.transform.e
        raster_nodata = raster.profile["nodata"]
        raster_pixels = raster.width * raster.height
        raster_block_pixels = raster.block_shapes[0][0] * raster.block_shapes[0][1]
        raster_block_count = int(raster_pixels / raster_block_pixels)
        block_steps = max(1, int(1000000 / raster_block_pixels))

        print(f'Around raster ~{raster_block_count} blocks to process in ~{int(raster_block_count / block_steps)} write steps')

        # Create Shapefile file
        type_conversion = float if 'float' in raster.profile.get('dtype') else int
        with collection(
            str(shape_out),
            mode='w',
            driver='ESRI Shapefile',
            crs=from_epsg(raster.crs.to_epsg()),
            schema={
                'geometry': 'Point',
                'properties': {field_name: 'float' if 'float' in raster.profile.get('dtype') else 'int'},
            }
        ) as shape_file:

            block_count = 0
            block_points = []
            block_time = []
            write_time = []

            # Iterate through raster blockwise
            for block in raster.block_windows(band):

                start = timeit.default_timer()

                x_off = block[1].col_off
                y_off = block[1].row_off

                block_width = block[1].width
                block_height = block[1].height

                lng_block_start = lng_start + x_off * lng_shift
                lat_block_start = lat_start + y_off * lat_shift

                block_data = raster.read(1, window=block[1])

                for x in range(0, block_width):
                    for y in range(0, block_height):
                        lng_point = lng_block_start + (x + 0.5) * lng_shift
                        lat_point = lat_block_start + (y + 0.5) * lat_shift
                        value = block_data[y][x]
                        # Nodata values can be imprecise, so we also manually exclude very small or very large numbers
                        if np.isnan(value) or value == raster_nodata or value < -1e30 or value > 1e30:
                            if ignore_nodata:
                                continue
                            else:
                                value = nodata
                        point_count += 1
                        block_points.append({
                            'properties': {field_name: type_conversion(value)},
                            'geometry': mapping(Point(lng_point, lat_point))
                        })

                # Write results every nth block & measure time
                block_count += 1
                block_time.append(timeit.default_timer() - start)
                if block_count % block_steps == 0:
                    average_block_time = sum(block_time) / block_steps
                    block_time = []
                    print('  writing', len(block_points), f'points ({block_steps} blocks) ...')
                    write_start = timeit.default_timer()
                    shape_file.writerecords(block_points)
                    shape_file.flush()
                    block_points = []
                    write_time.append(timeit.default_timer() - write_start)
                    average_write_time = sum(write_time) / len(write_time)
                    remaining_time = (raster_block_count - block_count) * average_block_time + (raster_block_count - block_count) / block_steps * average_write_time
                    log.debug(
                        f'  ... remaining time (for {raster_block_count - block_count} blocks)',
                    )
                    log.debug(f'{round(remaining_time / 60, 2)} minutes' if remaining_time < 3600 else f'{round(remaining_time / 3600, 2)} hours')
                    log.debug(f'(Read: ~{round(average_block_time, 4)} seconds per block | Write operation: ~{round(average_write_time, 4)} seconds)')
                    log.debug(f"Point count is {point_count}")


def get_raster_profile(raster: Union[Path, str, DatasetReaderBase]) -> Dict:
    """
    Returns a rasterio profile from a raster file or raster file handler
    """
    try:
        if isinstance(raster, DatasetReaderBase):
            return raster.profile
        else:
            with rasterio.open(raster) as rh:
                return rh.profile
    except Exception as e:
        raise Exception(f'Failed to read raster profile from "{raster}" ({e})')



def build_raster_dimensions_aligned(proj_min, proj_max, tile_size):
    """
    Intention to build a raster that is consistent for the tile size.

    AS such, returns raster start coord as well
    :param proj_min:
    :param proj_max:
    :param tile_size:
    :return: raster start coord, raster_stop coord, raster num tiles
    """

    start_index = math.floor(proj_min / tile_size)
    start = start_index * tile_size

    stop_index = math.ceil(proj_max / tile_size)
    stop = stop_index * tile_size

    return start, stop, stop_index-start_index


def get_raster_square_size(conn, sql_get_shape, tile_size_m, srid=4326):
    """
    Given sql to get the shape of the size of a raster, returns how big to make the raster square
    
    Does an average of the distances between the corners.
    
    sql should return 1 row with 1 column called shape in 4326 srid

    @:return raster_tile_size_x, raster_tile_size_y, x_min, x_max, y_min, y_max.  Note the height is generally 'stable' but the width will increase as you go towards
    the poles since to get to a tile_size you need more projected coordinates (for spherical projections)

    """

    # We use worldpops covariant size


    sql = f"""
SELECT 

  --top
  (x_max-x_min) / ( ST_Distance(top_left, top_right) / {tile_size_m}  ),

  --bottom
  (x_max-x_min) / ( ST_Distance(bot_left, bot_right) /{tile_size_m}  ),

  --left side
  (y_max-y_min) / ( ST_Distance(top_left, bot_left) /{tile_size_m}  ),

  --top side
  (y_max-y_min) / ( ST_Distance(top_right, bot_right) /{tile_size_m}  ),
  
  x_min, x_max, y_min, y_max

FROM
(
    SELECT 
        ST_Transform( ST_SetSrid( ST_MakePoint(x_min, y_min),{srid}), 4326)::geography as top_left, 
        ST_Transform( ST_SetSrid( ST_MakePoint(x_min, y_max),{srid}), 4326)::geography as bot_left, 
        ST_Transform( ST_SetSrid( ST_MakePoint(x_max, y_min),{srid}), 4326)::geography as top_right, 
        ST_Transform( ST_SetSrid( ST_MakePoint(x_max, y_max),{srid}), 4326)::geography as bot_right ,
        x_min, x_max, y_min, y_max
    FROM
    (
        SELECT 
            ST_XMin(shape) as x_min, 
            ST_XMax(shape) as x_max, 
            ST_YMin(shape) as y_min, 
            ST_YMax(shape) as y_max 
        FROM (
            {sql_get_shape}
        ) sq1 
  ) sq2
) sq3  
    """

    values = get_results(conn, sql)

    values=values[0]

    return ( values[0] + values[1] ) / 2, ( values[2] + values[3] ) / 2, values[4], values[5], values[6], values[7]


def get_raster_sum(raster_path):
    ds = gdal.Open(str(raster_path))
    raster_data = np.array(ds.GetRasterBand(1).ReadAsArray())

    no_data_value = ds.GetRasterBand(1).GetNoDataValue()

    log.info(f"No data value {no_data_value}.  {no_data_value-1}")

    # for overflow
    if no_data_value > 1:
        raster_data[ raster_data >= (no_data_value-1) ] = np.nan
    elif no_data_value < 0:
        # since we are dealing with population, anything negative is invalid 
        raster_data[ raster_data < 0 ] = np.nan
    else:
        raster_data[raster_data <= (no_data_value + 1)] = np.nan

    return np.nansum(raster_data)

