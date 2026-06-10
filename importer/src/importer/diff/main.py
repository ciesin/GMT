import contextlib
import logging
from datetime import datetime
from functools import partial
from typing import List, Dict

import diskcache
import numpy as np
import yaml
from importer.util import convert_markdown_to_html_and_pdf
from matplotlib.colors import ListedColormap
from psycopg2.extras import execute_values
from psycopg2.sql import SQL, Identifier

from importer.constants import DbConstants, GisFormats, \
    EXISTING_SET_INDEX, UPDATED_SET_INDEX, DirectoryLocations, YamlConfigConstants, TILE_XYZ_SERVER_1
from importer.diff.config import DiffConfig
from importer.diff.data import DiffData
from importer.diff.result import DiffResult
from importer.diff.worker import process_diff
from importer.import_config import ImportConfig
from importer.tests.util import DummyCommandLineArguments
from lib import db_utils, file_utils
# Ignore CSR warnings as pyproj is more recent than geopandas
from lib.thread_utils import InlineExector

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def process_layers_diff(import_config: ImportConfig, specific_table_names: List[str], args):
    """
    Top level method to process diffs.

    Note this also updates the staging schema with the is_new / is_updated / is_deleted columns

    """
    log.info("Producing diff report for all layers")
    from importer.main import layers_iterator

    # Import layers one by one to the staging schema
    for layer in layers_iterator(import_config.yaml_config, specific_table_names):

        # load target
        postgres_table_name = layer[YamlConfigConstants.TARGET_DB_TABLE_NAME]
        postgres_schema_name = layer[YamlConfigConstants.TARGET_DB_SCHEMA]

        log.debug(f"Diffing {postgres_table_name}")

        # create the diff config object
        diff_config = convert_import_config_to_diff_config(layer, import_config)

        diff_results = generate_diff_from_config(diff_config, postgres_table_name, args)

        log.info("Diffs completed, now updating metadata")

        stage_columns = ensure_staging_schema_has_diff_columns(import_config, postgres_table_name)

        update_staging_table_with_diff_results(import_config, postgres_table_name, postgres_schema_name, diff_results, stage_columns)


def convert_import_config_to_diff_config(layer: Dict, import_config: ImportConfig) -> Dict:
    """
    The diff config can compare 2 arbitrary layers.

    This command converts the YAML for the import into the deserialized YAML for a diff
    :return:
    """
    id_column = layer.get(YamlConfigConstants.ID_COLUMN, YamlConfigConstants.ID_COLUMN_DEFAULT)
    label_template = layer.get(YamlConfigConstants.LABEL_TEMPLATE, YamlConfigConstants.DEFAULT_LABEL_TEMPLATE)
    output_dir = DirectoryLocations.STAGE_OUTPUT_DIR
    postgres_table_name = layer[YamlConfigConstants.TARGET_DB_TABLE_NAME]
    postgres_schema_name = layer[YamlConfigConstants.TARGET_DB_SCHEMA]

    tile_server = layer.get(YamlConfigConstants.TILE_SERVER, TILE_XYZ_SERVER_1)
    if layer.get(YamlConfigConstants.SKIP_BASEMAPS, False) is True:
        tile_server = None

    from importer.main import get_db_filter

    with contextlib.closing(db_utils.create_db_connection(import_config.util_cfg)) as conn:
        db_filter = get_db_filter(conn, layer, staging_schema= import_config.util_cfg.STAGING_SCHEMA)

    log.info(f"Using db filter {db_filter.strip()} to select what staging will be updating")

    diff_config = {
        YamlConfigConstants.DIFF_REPORT: {
            YamlConfigConstants.OUTPUT_DIRECTORY: output_dir,
            YamlConfigConstants.SKIP_DIFF_MAPS: layer.get(YamlConfigConstants.SKIP_DIFF_MAPS, False),
            YamlConfigConstants.TILE_SERVER: tile_server,
            YamlConfigConstants.EXISTING: {
                YamlConfigConstants.ID_COLUMN: id_column,
                YamlConfigConstants.TYPE: GisFormats.POSTGIS,
                YamlConfigConstants.CONNECTION_STRING: db_utils.get_ogr_connection_string(
                    import_config.util_cfg),
                YamlConfigConstants.LAYER_NAME: f"{postgres_schema_name}."
                                                f"{postgres_table_name}{DbConstants.LATEST_VIEW_SUFFIX}",
                YamlConfigConstants.LABEL_TEMPLATE: label_template,
                YamlConfigConstants.DB_FILTER: db_filter
            },
            YamlConfigConstants.UPDATED: {
                YamlConfigConstants.ID_COLUMN: id_column,
                YamlConfigConstants.TYPE: GisFormats.POSTGIS,
                YamlConfigConstants.CONNECTION_STRING: db_utils.get_ogr_connection_string(
                    import_config.util_cfg),
                YamlConfigConstants.LAYER_NAME: f"{import_config.util_cfg.STAGING_SCHEMA}.{postgres_table_name}",
                YamlConfigConstants.LABEL_TEMPLATE: label_template
            }
        }
    }

    return diff_config


def ensure_staging_schema_has_diff_columns(import_config: ImportConfig, postgis_table_name) -> List[str]:
    """
    Make sure that the staging schema has the is_deleted / is_new / is_updated columns

    :return list of staging columns
    """
    with contextlib.closing(db_utils.create_db_connection(import_config.util_cfg)) as conn:

        stage_columns = db_utils.get_column_names(conn, import_config.util_cfg.STAGING_SCHEMA, postgis_table_name)

        for column_to_add in [DbConstants.COLUMN_NAME_IS_DELETED, DbConstants.COLUMN_NAME_IS_NEW,
                              DbConstants.COLUMN_NAME_IS_UPDATED]:
            if column_to_add not in stage_columns:
                sql = SQL("""
            ALTER TABLE {}.{}
            ADD COLUMN {} BOOL 
                    """).format(
                    Identifier(import_config.util_cfg.STAGING_SCHEMA),
                    Identifier(postgis_table_name),
                    Identifier(column_to_add)
                )
                db_utils.run_sql(conn, sql)

        return stage_columns


def update_staging_table_with_diff_results(
    import_config: ImportConfig,
    postgres_table_name: str,
    postgres_schema_name: str,
    diff_results: List[DiffResult],
    stage_columns: List[str]
):
    """
    Updates the staging table is_new/is_updated/is_deleted columns.

    Note deleted rows are added to the staging table

    :param import_config:
    :param postgres_table_name:
    :param diff_results:
    :param stage_columns:
    :return:
    """

    values_list = []

    for dr in diff_results:
        is_deleted = dr.is_deleted or False
        is_new = dr.is_new or False
        is_updated = dr.attributes_equal is False or dr.shape_equal is False

        values_list.append((dr.id, is_new, is_deleted, is_updated))

    temp_table_name = postgres_table_name + "_updates"

    sql1 = SQL("""
    DROP TABLE IF EXISTS {ss}.{tt};
    
    CREATE TABLE {ss}.{tt} (
        global_id uuid PRIMARY KEY, 
        is_new boolean, 
        is_deleted boolean, 
        is_updated boolean); 

    """).format(
        tt=Identifier(temp_table_name),
        ss=Identifier(import_config.util_cfg.STAGING_SCHEMA)
    )

    sql2 = SQL("""
    
        INSERT INTO {ss}.{tt} (global_id, is_new, is_deleted, is_updated) VALUES %s;

        """).format(
        tt=Identifier(temp_table_name),
        ss=Identifier(import_config.util_cfg.STAGING_SCHEMA)
    )

    sql3 = SQL("""

    UPDATE {ss}.{} AS to_update
    SET is_deleted = tt.is_deleted, is_new = tt.is_new, is_updated = tt.is_updated
    FROM {ss}.{tt}  tt               
                    WHERE to_update.global_id = tt.global_id;

    --DROP TABLE {tt}; -- else it is dropped at end of session automatically


                            """).format(
        Identifier(postgres_table_name),
        ss=Identifier(import_config.util_cfg.STAGING_SCHEMA),
        tt=Identifier(temp_table_name)
    )
    with contextlib.closing(db_utils.create_db_connection(import_config.util_cfg)) as conn:

        db_utils.run_sql(conn, sql1)

        log.debug(f"Loading diff values for {postgres_table_name}")
        cur = conn.cursor()
        execute_values(cur, sql2, values_list, page_size=1000)

        log.debug(f"Update staging diff values for {postgres_table_name}")
        db_utils.run_sql(conn, sql3)

        for c in [DbConstants.COLUMN_NAME_IS_DELETED, DbConstants.COLUMN_NAME_IS_NEW,
                  DbConstants.COLUMN_NAME_IS_UPDATED,
                  DbConstants.COLUMN_NAME_ROW_INDEX]:
            if c not in stage_columns:
                continue

            stage_columns.remove(c)

        # Insert staging rows for all things that are soft deleted
        sql = SQL("INSERT INTO {}.{} (").format(
            Identifier(import_config.util_cfg.STAGING_SCHEMA),
            Identifier(postgres_table_name))

        sql += SQL(", ").join([Identifier(c) for c in stage_columns])
        sql += SQL(", {})\n").format(Identifier(DbConstants.COLUMN_NAME_IS_DELETED))

        sql += SQL("SELECT ") + SQL(", ").join([SQL("layer.{}").format(Identifier(c)) for c in stage_columns])

        sql += SQL(""", True FROM {}.{} layer
        INNER JOIN {ss}.{tt} tt on tt.global_id = layer.global_id
        AND tt.is_deleted IS TRUE; 

        """).format(
            Identifier(postgres_schema_name),
            Identifier(postgres_table_name + "_latest"),
            ss=Identifier(import_config.util_cfg.STAGING_SCHEMA),
            tt=Identifier(temp_table_name)
        )

        log.info(f"Insert soft deleted rows into {postgres_table_name}")
        db_utils.run_sql(conn, sql)


def generate_diff(config_file_path, postgis_table_name) -> List[DiffResult]:
    with open(config_file_path) as file:
        yc = yaml.load(file, Loader=yaml.FullLoader)

        return generate_diff_from_config(yc, postgis_table_name, parsed_cmd_line_args=DummyCommandLineArguments)


def generate_diff_from_config(config_obj, postgis_table_name, parsed_cmd_line_args) -> List[DiffResult]:
    """
    Diffs a single layer
    :param config_obj: Deserialized configuration
    """
    trace_log.debug("Initializing disk cache")
    cache = diskcache.Cache("/disk_cache", size_limit=int(4e9))

    trace_log.debug("Loading & verifying configuration")
    diff_config = DiffConfig(config_obj)

    # skip_maps = diff_config.diff_cfg.get(YamlConfigConstants.SKIP_DIFF_MAPS, False)

    file_utils.mkdir_p(diff_config.output_dir)
    path_markdown_output = diff_config.output_dir / f"diff_{postgis_table_name}.md"

    diff_config.verify()

    # Load the data into GeoPandas dataframes, encapsulated in a DiffData object
    # Important these are sorted by global id
    diff_data = DiffData(diff_config)

    fill_alpha = 0.5
    diff_color_map_arr = np.array([
        [0, 1, 0, fill_alpha],
        [1, 0, 0, fill_alpha],
        [0, 0, 1, fill_alpha]])

    diff_color_map = ListedColormap(diff_color_map_arr)

    path_output_images = diff_config.output_dir / "diff_images"

    file_utils.mkdir_p(path_output_images)

    # sjer_aoi.to_crs({'init': 'epsg:4269'})
    markdown_file = open(path_markdown_output, "w")

    # Contains index, 0 based of each set
    indexes = [0, 0]
    # print(df_left.head())
    # print("right")
    # print(df_right.head())
    counter = 0
    num_diffs = 0

    trace_log.debug(f"len left {len(diff_data.df_existing)} len right {len(diff_data.df_updated)}")

    # a list of the arguments to pass to the workers
    f_args = []

    while indexes[EXISTING_SET_INDEX] <= len(diff_data.df_existing) and indexes[UPDATED_SET_INDEX] <= len(diff_data.df_updated):

        counter += 1

        ids = [None, None]

        if indexes[EXISTING_SET_INDEX] < len(diff_data.df_existing):
            ids[EXISTING_SET_INDEX] = diff_data.get_id_from_index(indexes[EXISTING_SET_INDEX], EXISTING_SET_INDEX)

        if indexes[UPDATED_SET_INDEX] < len(diff_data.df_updated):
            ids[UPDATED_SET_INDEX] = diff_data.get_id_from_index(indexes[UPDATED_SET_INDEX], UPDATED_SET_INDEX)

        both_not_none = ids[0] is not None and ids[1] is not None

        # process the lowest id
        if ids[0] is None and ids[1] is None:
            # we are done
            break
        elif ids[1] is None or (both_not_none and ids[0] < ids[1]):
            # we are removing a record (yes EXISTING but no UPDATED)
            args = ( (indexes[0], None), [ids[0], None], counter)
            indexes[0] += 1
        elif ids[0] is None or (both_not_none and ids[0] > ids[1]):
            # Adding a record (no EXISTING but yes UPDATED)
            args = ( (None,  indexes[1]), [None, ids[1]], counter)
            indexes[1] += 1
        elif both_not_none and ids[0] == ids[1]:
            # Modify existing (or unchanged)
            args = (tuple(indexes), ids, counter)
            indexes[0] += 1
            indexes[1] += 1
        else:
            raise Exception("Unexpected")

        #trace_log.debug(f"Debug arg {args}")
        f_args.append(args)

    # trace_log.debug(f"Diff arguments -- {f_args}")

    # with concurrent.futures.ProcessPoolExecutor(max_workers=10) as executor:
    # Inline is much faster, perhaps because pandas/geopandas is already multithreaded
    with InlineExector() as executor:
        f = partial(process_diff, diff_data, diff_config, path_output_images, diff_color_map, cache)

        diff_results: List[DiffResult] = list(executor.map(f, f_args))

    changed_shapes = [d for d in diff_results if d.shape_equal is False]
    num_shapes_changed = sum(1 for d in changed_shapes)

    changed_attributes = [d for d in diff_results if d.attributes_equal is False]
    num_attributes_changed = sum(1 for d in changed_attributes)

    new_records = [d for d in diff_results if d.is_new is True]
    deleted_records = [d for d in diff_results if d.is_deleted is True]

    num_unchanged_records = len([d for d in diff_results if d.attributes_equal is True and d.shape_equal is True])
    num_changed_records = len([d for d in diff_results if d.attributes_equal is False or d.shape_equal is False])

    markdown_file.write(f"""
# Summary '{datetime.now():%Y-%m-%d %H:%M:%S%z}'

| | Path | Table Name | Total # of Rows 
|:--- |:--- |:--- |:--- |
| Existing (db_filter applied) | {diff_config.existing.get(YamlConfigConstants.PATH)} | {diff_config.existing[YamlConfigConstants.LAYER_NAME]} | {len(diff_data.df_existing)} |
| Updated set | {diff_config.updated.get(YamlConfigConstants.PATH)} | {diff_config.updated[YamlConfigConstants.LAYER_NAME]} |  {len(diff_data.df_updated)} |

| | | 
|:--- |:--- |
| # of new records | {len(new_records)} |
| # of deleted records | {len(deleted_records)} |
| # of unchanged records | {num_unchanged_records} |
| # of changed records | {num_changed_records} | 

| # shapes changed | # attributes changed |
|:--- |:--- |
| {num_shapes_changed} | {num_attributes_changed} |
""")

    if not parsed_cmd_line_args.diff_summary_only:
        if len(changed_shapes) > 0:
            markdown_file.write("\n## Changed Shapes\n")
            for idx, d in enumerate(changed_shapes):
                markdown_file.write(f"* [{d.feature_label}](#{d.shape_anchor})\n")

        if len(changed_attributes) > 0:
            markdown_file.write("\n## Changed Attributes\n")
            for idx, d in enumerate(changed_attributes):
                markdown_file.write(f"* [{d.feature_label}](#{d.attributes_anchor})\n")

        # Rarely useful to see these details in the report
        # if len(new_records) > 0:
        #     markdown_file.write("\n## New Records\n")
        #     for idx, d in enumerate(new_records):
        #         markdown_file.write(f"* [{d.feature_label}](#{d.new_anchor})\n")
        #
        # if len(deleted_records) > 0:
        #     markdown_file.write("\n## Deleted Records\n")
        #     for idx, d in enumerate(deleted_records):
        #         markdown_file.write(f"* [{d.feature_label}](#{d.deleted_anchor})\n")

        for dr in diff_results:
            markdown_file.write(dr.output)

    markdown_file.close()

    # can just use a markdown viewer
    # log.info(f"Converting diff report")
    # try:
    #     convert_markdown_to_html_and_pdf(path_markdown_output, diff_config.output_dir, skip_pdf=parsed_cmd_line_args.skip_pdf)
    # except Exception as ex:
    #     log.error(f"Exception converting diff report, perhaps too large to convert to pdf.  Exception: {ex}")

    log.info(f"Diff report created in {diff_config.output_dir}")

    return diff_results
