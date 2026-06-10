import logging
from collections import OrderedDict

import geopandas as gpd
import numpy as np
import psycopg2
from matplotlib.colors import ListedColormap
from psycopg2.sql import SQL, Identifier
from shapely import wkb

from importer.constants import DbConstants, YamlConfigConstants, TransformationParams, Verifications, \
    TILE_XYZ_SERVER_1, DirectoryLocations
from importer.plot_helpers import create_plot, create_plot_image
from importer.util import ConfigException, DocItem, \
    VerificationVars, format_markdown_error
from importer.verifications import get_invalid_columns_error_message
from lib import db_utils, geo_db_utils, file_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def doc():
    d = DocItem(
        name=Verifications.CHECK_PARENT,
        desc="Checks a parent geometry matches geospatially and by attribute",
        extended_desc=f"Checks the parent boundary layer fully geospatially covers the geometry according to the boundary matched via the given join column.  Note this ignores NULL and Empty geometries in the staged table.  To verify non empty, use {Verifications.CHECK_NON_EMPTY_GEOM}",
        explicit_yaml_examples=[
            OrderedDict(
                {
                    TransformationParams.JOIN_COLUMN: "ward_code",
                    TransformationParams.TARGET_TABLE: "boundary_wards",
                    TransformationParams.METHOD: TransformationParams.SHAPE_INTERSECTS
                 }),
            OrderedDict(
                {
                    TransformationParams.JOIN_COLUMN: "lga_code",
                    TransformationParams.TARGET_TABLE: "boundary_wards",
                    TransformationParams.METHOD: TransformationParams.SHAPE_COVERS
                }),
            OrderedDict(
                {
                    TransformationParams.JOIN_COLUMN: "settlement_global_id",
                    TransformationParams.TARGET_TABLE: "bua"
                }),
        ],
        section=YamlConfigConstants.TRANSFORMATIONS,
    )

    d.infer_params_from_examples()
    d.set_name_on_examples()

    return d


def do_verification(v_args: VerificationVars) -> bool:

    test_config = v_args.test_config
    ok = True

    join_column = test_config.get(TransformationParams.JOIN_COLUMN, None)

    target_join_column = test_config.get(TransformationParams.TARGET_JOIN_COLUMN, join_column)
    source_join_column = test_config.get(TransformationParams.SOURCE_JOIN_COLUMN, join_column)

    is_strict = test_config.get(TransformationParams.STRICT, True)

    if not target_join_column or not source_join_column:
        raise ConfigException(
            f"Must either define {TransformationParams.JOIN_COLUMN}"
            f" or both {TransformationParams.TARGET_JOIN_COLUMN} and {TransformationParams.SOURCE_JOIN_COLUMN}")

    parent_layer = test_config[TransformationParams.TARGET_TABLE] + DbConstants.LATEST_VIEW_SUFFIX

    if error_msg := get_invalid_columns_error_message(v_args.conn, parent_layer, target_join_column):
        raise ConfigException(error_msg)
    if error_msg := get_invalid_columns_error_message(v_args.conn, v_args.table_name + DbConstants.LATEST_VIEW_SUFFIX, source_join_column):
        raise ConfigException(error_msg)

    method = test_config.get(TransformationParams.METHOD, TransformationParams.SHAPE_COVERS)

    method_desc = "fully geospatially contains"

    if method == TransformationParams.SHAPE_INTERSECTS:
        method_desc = "geospatially intersects"

    index_column_name = v_args.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                    YamlConfigConstants.INDEX_COLUMN_DEFAULT)


    # First check that we have a parent entry for each child row
    sql = SQL("""
        SELECT {}
        FROM {}.{} child WHERE NOT EXISTS (
            SELECT 1 FROM {}.{} parent
            WHERE parent.{} = child.{} )
        """).format(
        Identifier(index_column_name),
        Identifier(v_args.staging_schema),
        Identifier(v_args.table_name),
        Identifier(DbConstants.SCHEMA_MASTER),
        Identifier(parent_layer),
        Identifier(target_join_column),
        Identifier(source_join_column)
    )

    v_args.output += f"## Parent check for {v_args.staging_schema}.{v_args.table_name}\n"
    v_args.output += f"Checks that the parent layer __\"{parent_layer}\"__ {method_desc} each entry, " \
                         f"according to the matching row given by the attribute __\"{join_column}\"__\n\n"

    try:
        rows = db_utils.get_results(v_args.conn, sql)
    except psycopg2.errors.UndefinedColumn as ex:
        v_args.output += format_markdown_error(
            f"A column was not found in the staging table: {ex}") + "\n"
        if is_strict:
            return False
        else:
            return True

    len_rows = len(rows)

    if len_rows > 0:
        v_args.output += f"Found {len_rows} where no parent entry was found\n"

        from importer.verifications import output_failed_rows
        output_failed_rows(v_args, rows)

        ok = False

    target_geom_info = geo_db_utils.get_geometry_column_info(v_args.conn,
                                                             schema_name=DbConstants.SCHEMA_MASTER,
                                                             table_name=v_args.table_name)
    target_geom_name = target_geom_info['column_name']
    index_column_name = v_args.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                    YamlConfigConstants.INDEX_COLUMN_DEFAULT)

    if method == TransformationParams.SHAPE_COVERS:
        method_sql = SQL("ST_COVERS")
    elif method == TransformationParams.SHAPE_INTERSECTS:
        method_sql = SQL("ST_INTERSECTS")
    else:
        raise ConfigException(f"Unsupported method {method}")

    # Now we do the geospatial check; note we ignore empty & null geometries as those are covered by other checks
    sql = SQL("""
           SELECT child.{id}, child.{gc}, parent.{gc}
           FROM {}.{} child INNER JOIN  {}.{} parent
               ON parent.{target_join_column} = child.{} 
           WHERE
                child.{gc} IS NOT NULL AND 
                NOT ST_IsEmpty(child.{gc}) AND  
                NOT {method_sql}(parent.{gc}, child.{gc}) 
                
           ORDER BY child.{id}
           """).format(
        Identifier(v_args.staging_schema),
        Identifier(v_args.table_name),
        Identifier(DbConstants.SCHEMA_MASTER),
        Identifier(parent_layer),
        Identifier(source_join_column),
        target_join_column = Identifier(target_join_column),
        method_sql=method_sql,
        id=Identifier(index_column_name),
        gc = Identifier(target_geom_name)
    )

    try:
        rows = db_utils.get_results(v_args.conn, sql)
    except psycopg2.errors.InternalError_ as ex:

        ex_text = str(ex)

        # we want to handle only Topology exceptions
        if "Topology" not in ex_text:
            raise ex

        v_args.output += format_markdown_error(
            f"Encounted a Topology Exception.  Make sure the input geometries are valid.  You can also use make_geom_valid db transformation.  Exception: {ex}") + "\n"
        if is_strict:
            return False
        else:
            return True

    len_rows = len(rows)

    if len_rows > 0:

        v_args.output += f"\nFound {len_rows} where parent entry did not cover child entry\n"

        label_template = v_args.layer_config.get(
            YamlConfigConstants.LABEL_TEMPLATE, YamlConfigConstants.DEFAULT_LABEL_TEMPLATE)

        index_column_name = v_args.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                        YamlConfigConstants.INDEX_COLUMN_DEFAULT)

        for r in rows:
            id = r[0]
            # these are shapely objects loaded directly from the hex ewkt format postgis uses
            child_shape = wkb.loads(r[1], hex=True)
            parent_shape = wkb.loads(r[2], hex=True)

            # Note this may be 'stale' because db transformations occurred before, but it should be fine since the db
            # transforms would rarely / if even affect the label
            # label = get_feature_label(v_args.source_gdf,
            #                           label_template,
            #                           id, index_column_name, id)
            label = id


            v_args.output += f"1. " + format_markdown_error(label) + "\n"

            fill_alpha = 0.5
            diff_color_map_arr = np.array([
                [0, 1, 0, fill_alpha],
                [1, 0, 0, fill_alpha],
                [0, 0, 1, fill_alpha]])

            diff_color_map = ListedColormap(diff_color_map_arr)

            shapes = (parent_shape, child_shape)
            try:
                if not child_shape.is_empty:
                    plot_vars = create_plot(1, shapes, v_args.cache, v_args.layer_config.get(YamlConfigConstants.TILE_SERVER, TILE_XYZ_SERVER_1))

                    temp_gdf = gpd.GeoDataFrame(
                        ['parent', 'child'],
                        geometry=list(shapes))

                    temp_gdf.plot(ax=plot_vars.axes[0], legend=True, cmap=diff_color_map, column=0)

                    path_output_images = DirectoryLocations.STAGE_OUTPUT_DIR / "images"
                    file_utils.mkdir_p(path_output_images)
                    image_markdown = create_plot_image(plot_vars, path_output_images, id,
                                                       DirectoryLocations.STAGE_OUTPUT_DIR)

                    v_args.output += "\n    " + image_markdown + "\n\n"
                else:
                    v_args.output += "\n    Empty shape, cannot compare to boundary! " + "\n\n"
            except Exception:
                log.exception(f"Exception in plot -- {shapes[0]} {shapes[1]}")

        ok = False

    if ok:
        v_args.output += f"All rows passed\n\n"

    if not is_strict:
        return True
    else:
        return ok