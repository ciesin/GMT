import gdal
import timeit
from statistics import mean
from osgeo import gdal_array
from pathlib import Path
import numpy as np


# Rasters
raster_small = str(Path(__file__).parent / './raster.tif')
raster_large = str(Path(__file__).parent / './raster_large.tif')

# Get GDAL rasters


def read_as_array():
    gdal_raster_small = gdal.Open(raster_small).ReadAsArray()

    # Get OSGEO raster
    osgeo_raster_small = gdal_array.LoadFile(raster_small)

    print(type(gdal_raster_small))
    print(type(osgeo_raster_small))


def get_loading_time(repeat):
    print('_____SMALL______')
    print('- GDAL', mean(timeit.repeat(f'gdal.Open("{raster_small}").ReadAsArray()', setup='import gdal', number=1, repeat=repeat)))
    print('- OSGEO', mean(timeit.repeat(f'gdal_array.LoadFile("{raster_small}")', setup='from osgeo import gdal_array', number=1, repeat=repeat)))
    print('_____LARGE______')
    print('- GDAL', mean(timeit.repeat(f'gdal.Open("{raster_large}").ReadAsArray()', setup='import gdal', number=1, repeat=repeat)))
    print('- OSGEO', mean(timeit.repeat(f'gdal_array.LoadFile("{raster_large}")', setup='from osgeo import gdal_array', number=1, repeat=repeat)))


def operate_on_array():
    raster = gdal.Open(f"{raster_large}")
    array = raster.ReadAsArray()
    band = raster.GetRasterBand(1)
    print(band.GetNoDataValue())
    np.ma.masked_equal(array, band.GetNoDataValue())
    print(array.min())


# Try opening with rasterio
# https://rasterio.readthedocs.io/en/latest/topics/profiles.html


operate_on_array()

# Try rio-much for procesing

# Try threadpool https://gist.github.com/sgillies/b90a79917d7ec5ca0c074b5f6f4857e3#file-cfrw-py


# Test zonal stats with geopandas
