import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Tuple, Optional, List

import contextily as ctx
import diskcache
import matplotlib
import matplotlib.axes
import matplotlib.figure
import matplotlib.pyplot as plt
import numpy
import requests
from matplotlib.ticker import FormatStrFormatter
from pyproj import Proj, transform
from shapely.geometry.base import BaseGeometry

from importer.diff.shapes import ShapeBounds

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)

@dataclass
class PlotVars:
    """
    Class to capture variables related to a plot
    """
    fig: matplotlib.figure.Figure
    axes: List[matplotlib.axes.Axes]
    img: object
    bounds: ShapeBounds

    # the basemap is sized to the tiles returned
    basemap_extent: Tuple[float, ...]


def create_plot(num_cols, shapes: Tuple[Optional[BaseGeometry], Optional[BaseGeometry]],
                cache: diskcache.Cache,
                tile_server_url: str) -> PlotVars:
    """
    Initializes a plot
    :param num_cols: how many columns in the plot
    :param shapes:
    :param cache: disk cache
    :param tile_server_url: XYZ tile url
    :return:
    """
    fig, axes = plt.subplots(nrows=1, ncols=num_cols, figsize=(16, 10))

    if isinstance(axes, matplotlib.axes.SubplotBase):
        axes = (axes,)

    for ax in axes:
        ax.tick_params(axis='x', which='major', labelsize=8)

        bounds = ShapeBounds(shapes)

    ratio_check = (bounds.wesn[3] - bounds.wesn[2]) / (bounds.wesn[1] - bounds.wesn[0])

    if ratio_check > 10 or ratio_check < 0.1:
        raise Exception(
            f"Bounds is off, very thin / wide.  West/East/South/North: {bounds.wesn}  Ratio: {ratio_check}")

    if not tile_server_url:
        trace_log.debug(f"Tile server url is blank, skipping basemap")
        img, ext = (None, None)
    elif (img_ext := cache.get(bounds.wsen)) is None or not isinstance(img_ext, tuple):

        trace_log.debug(f"Fetching basemap with url {tile_server_url}")
        try:
            img, ext = ctx.bounds2img(*bounds.wsen, ll=True,  # zoom=14,
                                      source=tile_server_url
                                      # url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
                                      )

            # convert the extent to 4326
            in_proj = Proj(init='epsg:3857')
            out_proj = Proj(init='epsg:4326')

            w, s = transform(in_proj, out_proj, ext[0], ext[2])
            e, n = transform(in_proj, out_proj, ext[1], ext[3])

            ext = (w, e, s, n)
            cache.set(bounds.wsen, (img, ext))

            #check = cache.get(bounds.wsen)
            #assert isinstance(check, tuple)
            #log.info(f"Type {type(img)}  {type(check)} {type(check[0])}")
            #assert numpy.array_equal(check[0], img)
            #assert check[1] == ext

        except requests.HTTPError as ex:
            log.exception(f"Exception while fetching basemap {ex}")
            img, ext = (None, None)
    else:
        trace_log.debug(f"Basemap fetched from (cache) for {bounds.wsen}")
        img, ext = img_ext

    return PlotVars(fig, axes, img, bounds, ext)


def create_plot_image(plot_vars: PlotVars, path_output_images: Path, counter: int, output_dir: Path) -> str:
    """
Finalizes the plot, adds the basemap, and saves it to a png.

    :param output_dir: where the markdown will be saved
    :param plot_vars:
    :param path_output_images: Where to save the image
    :param counter: used to create the image name, should be unique

    :return: Markdown with link to image
    """
    for ax_idx, ax in enumerate(plot_vars.axes):
        # axes[0].ticklabel_format(useOffset=False)
        ax.xaxis.set_major_formatter(FormatStrFormatter('%.3f'))
        ax.yaxis.set_major_formatter(FormatStrFormatter('%.3f'))

        if plot_vars.img is not None:
            ax.imshow(plot_vars.img, extent=plot_vars.basemap_extent)
        else:
            trace_log.debug("No basemap image")

    image_path = path_output_images / f'{counter}.png'
    plot_vars.fig.savefig(image_path, bbox_inches="tight")

    matplotlib.pyplot.close(plot_vars.fig)
    matplotlib.pyplot.close('all')

    return f"""
    ![image_{counter}]({image_path.relative_to(output_dir)} "image_{counter}")
    """.strip()
