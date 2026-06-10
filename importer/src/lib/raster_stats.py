from dataclasses import dataclass
from typing import Self, Union

from osgeo.gdal import Dataset


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
    def from_gdal_dataset(dataset: Dataset) -> Self:
        geotransform = dataset.GetGeoTransform()

        return RasterStats(
            num_cols=dataset.RasterXSize,
            num_rows = dataset.RasterYSize,
            origin_x=geotransform[0],
            origin_y=geotransform[3],
            pixel_width = geotransform[1],
            pixel_height = geotransform[5],
        )

    def get_col_as_float(self, x:Union[int,float])->float:
        return (x - self.origin_x) / self.pixel_width

    def get_x_for_col(self, col):
        # left of the square
        return self.origin_x + col * self.pixel_width

    def right_x(self):
        return self.get_x_for_col(self.num_cols)

    def get_row_as_float(self, y:Union[int,float])->float:
        assert self.pixel_height < 0
        return (y - self.origin_y) / self.pixel_height

    def get_y_for_row(self, row):
        # top of the square
        assert self.pixel_height < 0
        return self.origin_y + row * self.pixel_height

    def bottom_y(self):
        return self.get_y_for_row(self.num_rows)
