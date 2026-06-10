import contextlib
import logging
from typing import Tuple, List

import diskcache
import geoalchemy2
import geopandas
import numpy
import psycopg2
from geoalchemy2 import WKTElement, WKBElement
from matplotlib.colors import ListedColormap
from psycopg2.sql import SQL, Identifier

import importer.plugins.verifications
from importer.constants import DbConstants, YamlConfigConstants, VerificationParams, DirectoryLocations, \
    TILE_XYZ_SERVER_1
from importer.import_config import ImportConfig
from importer.plot_helpers import create_plot, create_plot_image
from importer.util import compare_values, ConfigException, VerificationVars, \
    get_plugins, format_markdown_error
from lib import db_utils, geo_db_utils, file_utils
import psycopg2.errors

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)

def compare_dictionaries(
        dict_existing, dict_updated, key_label=None, value_label=None, key_quote_chars=None,
        value_quote_chars=None,
):
    if value_label is None:
        value_label = "Value"
    if key_label is None:
        key_label = ""
    else:
        # trailing space
        key_label += " "
    if key_quote_chars is None:
        key_quote_chars = ("", "")
    if value_quote_chars is None:
        value_quote_chars = ("", "")

    no_value = f"No {value_label}"
    output = ""
    diff_keys = [k for k in dict_existing if k in dict_updated and not compare_values(dict_existing.get(k, None), dict_updated.get(k, None))]

    def get_value(a_dict, key):

        if (v := a_dict.get(key)) is None:
            return no_value
        else:
            return f"{value_quote_chars[0]}{v}{value_quote_chars[1]}"

    for k in diff_keys:
        output += f"* {value_label} of {key_label}{key_quote_chars[0]}{k}{key_quote_chars[1]} " \
                  f"changed from {get_value(dict_existing, k)} => {get_value(dict_updated, k)}\n"

    existing_keys = set(dict_existing.keys())
    updated_keys = set(dict_updated.keys())

    def unique_key(k, side):
        return f"* {key_label}{key_quote_chars[0]}{k}{key_quote_chars[1]} only on {side}\n"

    # to put the keys in order
    alpha_tuples = []

    for k in existing_keys.difference(updated_keys):
        alpha_tuples.append( (k + "m", unique_key(k, "master")) )
    for k in updated_keys.difference(existing_keys):
        alpha_tuples.append( (k + "s", unique_key(k, "staging")) )

    alpha_tuples.sort()

    for at in alpha_tuples:
        output += at[1]

    return output


def check_schema_is_identical(verif_vars: VerificationVars) -> bool:
    """
    Checks data column types and no extra columns between stage & publication

    @:return markdown output
    """

    verif_vars.output += "## Verify staging and master columns and type match\n"

    target_geom_info = geo_db_utils.get_geometry_column_info(
        verif_vars.conn, verif_vars.schema_name, verif_vars.table_name)
    source_geom_info = geo_db_utils.get_geometry_column_info(
        verif_vars.conn,
        schema_name=verif_vars.staging_schema,
        table_name=verif_vars.table_name)

    assert source_geom_info is not None, f"Cannot find geometry info in {verif_vars.staging_schema}.{verif_vars.table_name}"

    verif_vars.source_geom_info = source_geom_info

    if source_geom_info != target_geom_info:
        diffs = compare_dictionaries(
            dict_existing=target_geom_info,
            dict_updated=source_geom_info,
            key_label="Geometry Column Attribute", key_quote_chars="\"\"")
        verif_vars.output += f"Shape column schema not the same in staging & target schemas.  Differences:\n{diffs}"
        return False

    sql = SQL("""
                            SELECT COUNT(*)
                            FROM {}.{}   
                            """).format(
        Identifier(verif_vars.staging_schema),
        Identifier(verif_vars.table_name)
    )
    row_count = db_utils.get_single_value(verif_vars.conn, sql)

    # if row_count == 0:
    #     output += f"Cannot import an empty table.  0 rows found in staging table"
    #     return False, output

    source_column_info = db_utils.get_column_types_as_dict(
        verif_vars.conn, verif_vars.staging_schema, verif_vars.table_name)

    source_column_info.pop(DbConstants.COLUMN_NAME_ROW_INDEX, None)

    target_column_info = db_utils.get_column_types_as_dict(
        verif_vars.conn, verif_vars.schema_name, verif_vars.table_name)

    target_column_info.pop(DbConstants.COLUMN_NAME_VERSION_ID, None)
    target_column_info.pop(DbConstants.COLUMN_NAME_IS_DELETED, None)

    if source_column_info != target_column_info:
        diffs = compare_dictionaries(
            dict_updated=source_column_info, dict_existing=target_column_info,
                                     key_label="Column Name",
                                     value_label="Column Type",
                                     key_quote_chars="\"\"",
                                     value_quote_chars="\'\'")
        verif_vars.output += format_markdown_error("Column names and/or types are not identical between stage and master.") + \
                             f"  Differences:\n{diffs}"
        return False

    verif_vars.output += "All column names match and have the same column type\n"

    return True


def check_user_verifications(stage_vars: VerificationVars) -> bool:

    user_verifications = stage_vars.layer_config.get(YamlConfigConstants.USER_VERIFICATIONS, [])

    plugin_verifications = get_plugins(importer.plugins.verifications)

    ok = True

    for v in user_verifications:

        stage_vars.test_config = v

        test_name = v[VerificationParams.TEST_NAME]

        # run all verifications even if we already failed to see all failures
        if test_name.lower() in plugin_verifications:
            ok = plugin_verifications[test_name.lower()].do_verification(
                stage_vars
            ) and ok
        else:
            raise ConfigException(f"Unrecognized verification: {test_name}")

    return ok


def output_failed_rows(stage_vars, rows):
    """

    :param stage_vars:
    :param rows: Expects index in first column, and possibily the invalid value in the second
    :return:
    """
    label_template = stage_vars.layer_config.get(
        YamlConfigConstants.LABEL_TEMPLATE, YamlConfigConstants.DEFAULT_LABEL_TEMPLATE)

    index_column_name = stage_vars.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                    YamlConfigConstants.INDEX_COLUMN_DEFAULT)
    for r in rows:
        index_value = r[0]
        if not isinstance(r[0], int):
            raise ConfigException(f"Expected index value to be an integer: {index_value}")

        if len(r) > 1:
            invalid_value = r[1]
        else:
            invalid_value = None

        # TODO get label from database row
        # label = get_feature_label(stage_vars.source_gdf,
        #                           label_template,
        #                           index_value, index_column_name, index_value)
        label = str(index_value)
        stage_vars.output += f"1. " + format_markdown_error(label)

        if invalid_value:
            stage_vars.output += f" Invalid value: `[{invalid_value}]`"

        stage_vars.output += "\n"


def output_failed_rows_with_shape(stage_vars, rows, geometry_column_name=None):
    """

    :param stage_vars:
    :param rows: Expects index in first column
    """
    label_template = stage_vars.layer_config.get(
        YamlConfigConstants.LABEL_TEMPLATE, YamlConfigConstants.DEFAULT_LABEL_TEMPLATE)

    index_column_name = stage_vars.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                    YamlConfigConstants.INDEX_COLUMN_DEFAULT)

    tile_server = TILE_XYZ_SERVER_1
    if stage_vars.layer_config.get(YamlConfigConstants.SKIP_BASEMAPS, False) is True:
        tile_server = None

    for r in rows:
        index_value = r[0]
        if not isinstance(index_value, int):
            raise ConfigException(f"Expected index value to be an integer: {index_value}")

        # Note this may be 'stale' because db transformations occured before, but it should be fine since the db
        # transforms would rarerly / if even affect the label
        label = get_feature_label(stage_vars.source_gdf,
                                  label_template,
                                  row_index=index_value,
                                  id_column=index_column_name,
                                  id_value=index_value)

        #
        if geometry_column_name is not None:
            shape = stage_vars.source_gdf.iloc[index_value][geometry_column_name]
        else:
            shape = stage_vars.source_gdf.iloc[index_value][stage_vars.source_gdf.geometry.name]

        # shape is a geo alchemy WKTelement, but we want a shapely object now
        if isinstance(shape, (WKBElement, WKTElement)):
            #stage_vars.output += f"1. " + format_markdown_error(label) + f"\n    Shape is not a WKT/WKB Element.  Type({type(shape)}\n\n"
            #continue
            shape = geoalchemy2.shape.to_shape(shape)

        fill_alpha = 0.5
        diff_color_map_arr = numpy.array([
            [0, 1, 0, fill_alpha],
            [1, 0, 0, fill_alpha],
            [0, 0, 1, fill_alpha]])

        diff_color_map = ListedColormap(diff_color_map_arr)

        shapes = (shape, )

        stage_vars.output += f"1. " + format_markdown_error(label) + "\n"
        try:
            if not shape.is_empty:
                plot_vars = create_plot(1, shapes, stage_vars.cache, tile_server)

                temp_gdf = geopandas.GeoDataFrame(
                    ['Geometry'],
                    geometry=list(shapes))

                temp_gdf.plot(ax=plot_vars.axes[0], legend=True, cmap=diff_color_map, column=0)

                path_output_images = DirectoryLocations.STAGE_OUTPUT_DIR / "images"
                file_utils.mkdir_p(path_output_images)
                image_markdown = create_plot_image(
                    plot_vars, path_output_images, index_value,
                                                   DirectoryLocations.STAGE_OUTPUT_DIR)

                stage_vars.output += "\n    " + image_markdown + "\n\n"
            else:
                stage_vars.output += "\n    Empty shape, cannot compare to boundary! " + "\n\n"
        except Exception:
            log.exception(f"Exception in plot -- {shapes[0]} ")




def run_verifications(import_config: ImportConfig, layer, table_name) -> Tuple[bool, str]:
    """
    verifications are run in the staging schema

    1.  st_isvalid
    2.  columns match

    Ideas --


    3.  Check projection
    4.  Check country extent
    5.  Check internal overlap
    6.  uniqueness
    7.  Check parent admin layer attribute matches geospatial
    8.  Check doesn't spill over parent admin layer
    9.  For admin layers only -- check coverage, no  gaps

    @:return A string, markdown format, of any warnings or errors
    """

    ok = True

    try:
        with contextlib.closing(db_utils.create_db_connection(import_config.util_cfg)) as conn:

            verification_vars = VerificationVars(conn=conn,
                                                 schema_name=layer[YamlConfigConstants.TARGET_DB_SCHEMA],
                                                 table_name=table_name,
                                                 import_config=import_config, layer_config=layer,

                                                 staging_schema= import_config.util_cfg.STAGING_SCHEMA)

            verification_vars.cache = diskcache.Cache("/disk_cache")

            staging_schema = import_config.util_cfg.STAGING_SCHEMA

            verification_vars.output += f"# Verification\n\nVerifications (both built-in and configured) for {staging_schema}.{table_name}\n\n"
            row_count = db_utils.get_row_count(conn, verification_vars.staging_schema, verification_vars.table_name, 0)
            verification_vars.output += f"{row_count} rows found originally in staging table \"{verification_vars.table_name}\"\n\n"

            tests = [check_schema_is_identical,
                     add_system_not_null_constraint,
                     add_global_id_unique_constraint,
                     check_staging_rows_match_db_filter,
                     check_user_verifications]

            for t in tests:
                ok = t(verification_vars) and ok

            if ok:
                verification_vars.output += "\n# All checks passed\n\n"

            return ok, verification_vars.output
    except Exception as ex:
        # traceback.print_tb(ex.__traceback__)
        log.exception("Exception", exc_info=ex)
        type_name = type(ex).__name__
        return False, format_markdown_error(f"Exception in verifications: {ex}.  Exception type: {type_name}")


def add_not_null_constraint(stage_vars: VerificationVars, column_name) -> bool:
    """
    Adds a NOT NULL constraint to staging
    :param column_name: if None, will check global_id (technically the defined id column)

    """
    stage_vars.output += f"## Adding NOT NULL constraint to {column_name} to " \
                         f"ensure all staging rows contain a value for this column.\n"

    stage_schema = stage_vars.import_config.util_cfg.STAGING_SCHEMA

    try:
        db_utils.set_columns_to_not_null(stage_vars.conn, schema_name=stage_schema,
                                         table_name=stage_vars.table_name,
                                         not_null_columns=[column_name])
    except psycopg2.errors.UndefinedColumn:
        stage_vars.output += format_markdown_error(f"The column \"{column_name}\" was not found in the staging table") + "\n"
        return False
    except psycopg2.errors.NotNullViolation:

        stage_vars.output += format_markdown_error(f"The following rows have no value for {column_name}:") + "\n"

        index_column_name = stage_vars.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                    YamlConfigConstants.INDEX_COLUMN_DEFAULT)
        failed_rows_sql = SQL("SELECT {} FROM {}.{} WHERE {} IS NULL").format(
            Identifier(index_column_name),
            Identifier(stage_schema),
            Identifier(stage_vars.table_name),
            Identifier(column_name)
        )

        failed_rows = db_utils.get_results(stage_vars.conn, failed_rows_sql)
        output_failed_rows(stage_vars, failed_rows)

        return False

    return True


def add_global_id_unique_constraint(stage_vars: VerificationVars) -> bool:
    """
    Adds a UNIQUE constraint to staging

    """
    column_name = DbConstants.COLUMN_NAME_GLOBAL_ID

    stage_vars.output += f"## Adding UNIQUE constraint to {column_name} to " \
                         f"ensure all staging rows contain a unique global_id.\n"

    stage_schema = stage_vars.import_config.util_cfg.STAGING_SCHEMA

    try:
        db_utils.add_unique_constraint(stage_vars.conn, schema_name=stage_schema,
                                         table_name=stage_vars.table_name,
                                       column_name=column_name,
                                       check_if_constraint_exists=True)
    except psycopg2.errors.UndefinedColumn:
        stage_vars.output += format_markdown_error(f"The column \"{column_name}\" was not found in the staging table") + "\n"
        return False
    except psycopg2.errors.UniqueViolation as ex:

        stage_vars.conn.rollback()

        stage_vars.output += format_markdown_error(f"The following rows have a duplicate value for {column_name}: {ex}") + "\n"

        index_column_name = stage_vars.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                    YamlConfigConstants.INDEX_COLUMN_DEFAULT)
        failed_rows_sql = SQL("""
        WITH dups AS (
        SELECT {cn} FROM {sn}.{tn} 
        GROUP BY {cn}
        HAVING count(*) > 1
        )
        SELECT {} 
        FROM {sn}.{tn}
        WHERE {cn} IN (SELECT dups.{cn} FROM dups)
        """).format(
            Identifier(index_column_name),
            sn=Identifier(stage_schema),
            tn=Identifier(stage_vars.table_name),
            cn=Identifier(column_name),
        )

        failed_rows = db_utils.get_results(stage_vars.conn, failed_rows_sql)
        output_failed_rows(stage_vars, failed_rows)

        return False

    return True


def add_system_not_null_constraint(stage_vars: VerificationVars) -> bool:

    ok = True

    id_column = stage_vars.layer_config.get(YamlConfigConstants.ID_COLUMN, YamlConfigConstants.ID_COLUMN_DEFAULT)

    ok = add_not_null_constraint(stage_vars, id_column) and ok
    # ok = add_not_null_constraint(stage_vars, "state_code") and ok

    return ok


def check_staging_rows_match_db_filter(verification_vars: VerificationVars) -> bool:
    """
    Makes sure that the data we are replacing in master corresponds to the db_filter

    Note the db_filter is what defines what subset of the layer data we are updating.

    """
    ok = True

    verification_vars.output += "## Verify staging and master columns and type match\n"

    index_column_name = verification_vars.layer_config.get(YamlConfigConstants.INDEX_COLUMN,
                                                           YamlConfigConstants.INDEX_COLUMN_DEFAULT)

    from importer.main import get_db_filter
    db_filter = get_db_filter(verification_vars.conn, verification_vars.layer_config, verification_vars.staging_schema)

    stage_schema = verification_vars.import_config.util_cfg.STAGING_SCHEMA

    outside_db_filter_sql = SQL("SELECT {} FROM {}.{} WHERE NOT ({})").format(
        Identifier(index_column_name),
        Identifier(stage_schema),
        Identifier(verification_vars.table_name),
        SQL(db_filter))

    try:
        failed_rows = db_utils.get_results(verification_vars.conn, outside_db_filter_sql)

        if failed_rows is not None and len(failed_rows) > 0:

            verification_vars.output += format_markdown_error(f"Not all staging rows match db_filter: {db_filter}") + f"\n\nRecall the db_filter defines what " \
                                 f"subset of the layer {verification_vars.table_name} we are updating.\n\n"
            output_failed_rows(verification_vars, failed_rows)

            ok = False
        else:
            verification_vars.output += f"All staging rows match db_filter: {db_filter}\n\n"
            ok = True
    except psycopg2.errors.UndefinedColumn as ex:
        verification_vars.output += format_markdown_error(
            f"A column was not found in the staging table: {ex}") + "\n"
        ok = False
    return ok


def get_invalid_columns_error_message(conn, latest_view:str, column_names_to_check: List[str]) -> str:
    """
    :return: An error message if something is missing, otherwise None if all is OK
    """
    assert latest_view.endswith(DbConstants.LATEST_VIEW_SUFFIX)

    missing_columns = []
    actual_column_names = db_utils.get_column_names(conn, schema_name=DbConstants.SCHEMA_MASTER, table_name=latest_view)

    if isinstance(column_names_to_check, str):
        column_names_to_check = [column_names_to_check]

    assert len(column_names_to_check) > 0

    for c in column_names_to_check:
        if c not in actual_column_names:
            missing_columns.append(c)

    if len(missing_columns) > 0:
        actual_column_names_str = ", ".join(actual_column_names)
        missing_columns_str = ", ".join(missing_columns)
        err_msg = ""
        if len(missing_columns) == 1:
            err_msg += "A column is missing"
        else:
            err_msg += f"The following columns are missing"

        err_msg += f": {missing_columns_str}.  Columns found in {latest_view[:-len(DbConstants.LATEST_VIEW_SUFFIX)]}: {actual_column_names_str}"
        return err_msg
    else:
        return None
