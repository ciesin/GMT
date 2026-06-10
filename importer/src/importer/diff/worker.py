import logging
import math
import os
import traceback
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Union

import diskcache
import geopandas as gpd
import pyproj
import shapely

from importer.util import compare_values, ConfigException, sanitize_id, format_markdown_error
from shapely import ops
from shapely.geometry.base import BaseGeometry

from importer.constants import UPDATED_SET_INDEX, EXISTING_SET_INDEX, YamlConfigConstants
from importer.diff.config import DiffConfig
from importer.diff.data import DiffData
from importer.plot_helpers import create_plot, create_plot_image
from importer.verifications import compare_dictionaries
from .result import DiffResult

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def area_m2(geom: BaseGeometry) -> Union[float, None]:
    """

    :param geom: A shape
    :return: A float of area of given shape in square meters
    """
    if geom is None:
        return None

    bounds = geom.bounds
    if not bounds or len(bounds) != 4:
        trace_log.debug(f"Bounds is not valid: {bounds} for {geom}")
        return None

    geom_area = ops.transform(
        partial(
            pyproj.transform,
            pyproj.Proj('EPSG:4326'),
            pyproj.Proj(
                proj='aea',
                lat_1=geom.bounds[1],
                lat_2=geom.bounds[3])),
        geom)

    return geom_area.area


def compare_features(diff_data: DiffData,
                     diff_config: DiffConfig,
                     path_output_images: Path,
                     diff_color_map,
                     cache: diskcache.Cache,
                     indexes, feature_label_existing, counter, ids, **kwargs) -> DiffResult:
    """
    Helper function for process_diff.  Handles the comparison of 2 features (whose id values are the same)
    :param diff_data:
    :param diff_config:
    :param path_output_images:
    :param diff_color_map:
    :param cache:
    :param indexes:
    :param feature_label_existing:
    :param counter:
    :return:
    """

    trace_log.debug(f"Comparing features of {ids}")
    output = ""
    shapes = diff_data.get_shapes(indexes)

    attributes = diff_data.get_attributes(indexes)

    is_attributes_equal = True

    show_shape = diff_config.diff_cfg.get(YamlConfigConstants.SKIP_DIFF_MAPS, False) is False

    trace_log.debug(f"Compare features [show map = {show_shape}] for new/added feature vs existing one -- {ids}")

    keys_1 = set(attributes[EXISTING_SET_INDEX].keys())
    keys_2 = set(attributes[UPDATED_SET_INDEX].keys())

    if keys_1 != keys_2:
        is_attributes_equal = False
    else:
        for k in attributes[EXISTING_SET_INDEX]:
            val = attributes[EXISTING_SET_INDEX][k]
            val_2 = attributes[UPDATED_SET_INDEX][k]

            if not compare_values(val, val_2):
                is_attributes_equal = False
                break

    attribute_anchor = None
    shape_anchor = None

    if is_attributes_equal:
        # output += f"## {feature_label_existing} Attributes Unchanged\n"
        pass
    else:
        attribute_label = f"{feature_label_existing} Attributes Changed"
        output += f"## {attribute_label}\n"
        attribute_anchor = sanitize_id(attribute_label)
        output += compare_dictionaries(attributes[0], dict_updated=attributes[1],
                                       key_label="Column",
                                       value_quote_chars="``")

    is_points = shapes[0].geom_type == "Point"

    shape_is_none = [s is None or s.is_empty for s in shapes]

    if shape_is_none[0] != shape_is_none[1]:
        shape_label = f"## {feature_label_existing} Shape Changed\n"
        output += f"## {shape_label}\n"
        shape_anchor = sanitize_id(shape_label)
        output += f"Existing is NULL/Empty: {shape_is_none[0]}.\nUpdated is NULL/Empty: {shape_is_none[1]} \n"
        return DiffResult(
            output,
            shape_equal=False,
            attributes_equal=is_attributes_equal,
            id=ids[0],
            feature_label=feature_label_existing,
            shape_anchor=shape_anchor
        )

    is_shape_equal = shapes[0].equals_exact(shapes[1], tolerance=1e-4) or (shapes[0].is_empty and shapes[1].is_empty)

    if not is_shape_equal:

        # print(f"Comparing {ids[0]}, Is Equal? {is_equal} {shapes[0]} {shapes[1]}")

        shape_label = f"{feature_label_existing} Shape Changed"
        output += f"## {shape_label}\n"
        shape_anchor = sanitize_id(shape_label)

        if show_shape:
            plot_vars = create_plot(2 if is_points else 3,
                                    shapes, cache, diff_config.get_tile_server())

            diff_data.df_existing[indexes[0]:indexes[0] + 1].plot(
                ax=plot_vars.axes[0], legend=True,
                color=(0, 0, 0, 0.5),
                linewidth=3,
                edgecolor=(0, 0, 0, 1))
            plot_vars.axes[0].set_title("Existing Shape")

            if is_points:
                points = gpd.GeoDataFrame(['added', 'removed'], geometry=[
                    shapes[1],
                    shapes[0]
                ])

                points.crs = diff_data.df_existing.crs

                plot_vars.axes[1].set_title("Comparison")

                # print(diffs.head())

                points.plot(ax=plot_vars.axes[1], legend=True, cmap=diff_color_map, column=0)

            else:
                diff_data.df_updated[indexes[1]:indexes[1] + 1].plot(
                    ax=plot_vars.axes[1], legend=True,
                    color=(0, 0, 0, 0.5),
                    linewidth=3,
                    edgecolor=(0, 0, 0, 1))

                plot_vars.axes[1].set_title("Updated Shape")

                if plot_vars.img is not None:
                    plot_vars.axes[1].imshow(plot_vars.img, extent=plot_vars.bounds.wesn)

                try:
                    geoms = [
                        shapes[0].difference(shapes[1]),
                        shapes[1].difference(shapes[0]),
                        shapes[0].intersection(shapes[1])
                    ]

                    labels = ['removed', 'added', 'same']
                    areas = [area_m2(g) for g in geoms]

                    output += f"""
### Area table    
| Name | Area |
|:--- |:--- |
        """.strip() + "\n"

                    for idx, (label, area) in enumerate(zip(labels, areas)):
                        if area is None:
                            output += f"| {label} | Empty |\n"
                            # don't plot an empty polygon, causes an exception
                            geoms[idx] = None
                        else:
                            output += f"| {label} | {area:,.2f} m² |\n"

                    output += "\n\n"

                    diffs = gpd.GeoDataFrame(labels, geometry=geoms)

                    diffs.crs = diff_data.df_existing.crs

                    plot_vars.axes[2].set_title("Comparison")

                    diffs.plot(ax=plot_vars.axes[2], legend=True, cmap=diff_color_map, column=0)

                except shapely.errors.TopologicalError as ex:

                    output += format_markdown_error (f"Stage or Master shape is not valid: {ex}\n\n")

            image_markdown = create_plot_image(plot_vars, path_output_images, counter, diff_config.output_dir)

            output += image_markdown + "\n\n"

        # newlines after shape (if it was added)
        output += "\n\n"

    else:
        pass
        # output += f"## {feature_label_existing} Shape Unchanged\n"

    return DiffResult(
        output,
        shape_equal=is_shape_equal,
        attributes_equal=is_attributes_equal,
        shape_anchor=shape_anchor,
        attributes_anchor=attribute_anchor,
        id=ids[0],
        feature_label=feature_label_existing
    )


def plot_new_shape():
    pass


def process_diff(
        diff_data: DiffData,
        diff_config: DiffConfig,
        path_output_images: Path,
        diff_color_map,
        cache: diskcache.Cache,
        args) -> DiffResult:
    """
    Processes diff of 1 feature
    """
    dr = process_diff_real(diff_data, diff_config, path_output_images, diff_color_map, cache, args)

    assert dr.id is not None
    assert dr.feature_label is not None and len(dr.feature_label) >= 1

    return dr


def process_diff_real(
        diff_data: DiffData,
        diff_config: DiffConfig,
        path_output_images: Path,
        diff_color_map,
        cache: diskcache.Cache,
        args) -> DiffResult:
    """
    process worker
    creates markdown string output for a particular data point

    args passed like that to work with the multiprocess pool syntax

    args should be:

    (
      tuple of 2 indexes (0 based in order of diff),
      tuple of 2 ids (the unique identifying value of the 2 shapes being compared)
      counter (which job #)


    """

    indexes, ids, counter = args

    try:

        trace_log.debug(f"Processing diff #{counter} in process #{os.getpid()} indexes={indexes} ids={ids}")
        feature_label_existing = diff_data.get_feature_label(
            EXISTING_SET_INDEX, indexes[EXISTING_SET_INDEX],
            diff_config.id_column_names[EXISTING_SET_INDEX], ids[EXISTING_SET_INDEX])

        if ids[UPDATED_SET_INDEX] is None and ids[EXISTING_SET_INDEX] is None:
            raise ConfigException(f"Id column {diff_config.id_column_names[UPDATED_SET_INDEX]} is blank")

        if ids[EXISTING_SET_INDEX] == ids[UPDATED_SET_INDEX]:
            return compare_features(**locals())

        elif ids[UPDATED_SET_INDEX] is None:
            label = f"{feature_label_existing} Deleted"

            return DiffResult(
                #output=f"## {label}\n",
                # no output for deleted
                output = "",
                feature_label=feature_label_existing,
                is_deleted=True,
                deleted_anchor=sanitize_id(label),
                id=ids[EXISTING_SET_INDEX]
            )

        elif ids[EXISTING_SET_INDEX] is None:

            feature_label_updated = diff_data.get_feature_label(
                UPDATED_SET_INDEX, indexes[UPDATED_SET_INDEX],
                diff_config.id_column_names[UPDATED_SET_INDEX], ids[UPDATED_SET_INDEX])

            label = f"{feature_label_updated} New/Added"

            show_shape = diff_config.diff_cfg.get(YamlConfigConstants.SHOW_SHAPES_FOR_NEW_RECORDS, False) and \
                diff_config.diff_cfg.get(YamlConfigConstants.SKIP_DIFF_MAPS, True) is False

            trace_log.debug(f"Show shape is {show_shape} for new/added feature -- {feature_label_updated}")

            if show_shape:
                shapes = (
                    None,
                    diff_data.get_shape(UPDATED_SET_INDEX, indexes[UPDATED_SET_INDEX])
                )
                plot_vars = create_plot(1, shapes, cache, diff_config.get_tile_server())
                diff_data.df_updated[indexes[UPDATED_SET_INDEX]:indexes[UPDATED_SET_INDEX] + 1].plot(
                    ax=plot_vars.axes[0], legend=True,
                    color=(0, 0, 0, 0.5),
                    linewidth=3,
                    edgecolor=(0, 0, 0, 1)
                )
                plot_vars.axes[0].set_title("New Shape")

                image_markdown = create_plot_image(plot_vars, path_output_images, counter,
                                                   diff_config.output_dir) + "\n"
            else:
                image_markdown = ""

            attribute_table = f"""
Attributes

| Name | Value |
|:--- |:--- |
"""

            row = diff_data.df_updated.iloc[indexes[UPDATED_SET_INDEX]]

            for c in diff_data.df_updated.columns:
                if c == diff_data.df_updated.geometry.name:
                    continue

                attribute_table += f"{c} | {row[c]}\n"

            output = f"## {label}\n{image_markdown}{attribute_table}\n"

            return DiffResult(
                output=output,
                feature_label=feature_label_updated,
                new_anchor=sanitize_id(label),
                is_new=True,
                id=ids[UPDATED_SET_INDEX]
            )
    except Exception as ex:
        raise ex
        trace = traceback.format_exception(etype=None, value=ex, tb=ex.__traceback__)
        return DiffResult(
            output=f"Exception with indexes={indexes} id={ids} counter={counter}.  Ex: {ex} Trace: {trace}",
            is_error=True)
