# In the code, the existing & updated sets are often stored in a tuple or list of len 2
from enum import StrEnum
from pathlib import Path

EXISTING_SET_INDEX = 0
UPDATED_SET_INDEX = 1

TILE_XYZ_SERVER_1 = "http://www.google.cn/maps/vt?lyrs=s@189&gl=cn&x={x}&y={y}&z={z}"


class DirectoryLocations(object):
    DATA_DIR = Path("/data")

    EXPORTS_DIR = DATA_DIR / "exports"

    STAGE_OUTPUT_DIR = DATA_DIR / "stage_output"

    STAGE_REPORT_PATH = STAGE_OUTPUT_DIR / "stage_report.md"

    DOC_BASE_DIR = DATA_DIR / "docs"

    PUBLISH_DUMP_PATH = DATA_DIR / "publication"

    MIGRATION_DIR = DATA_DIR / "db_migrations"


class DbConstants(object):
    SCHEMA_MASTER = "master"

    SCHEMA_TEMP_PUBLICATION = "publication"

    ROLE_NAME_PUBLISHER = "publisher_role"
    ROLE_NAME_GIS_EDITOR = "gis_editor_role"
    ROLE_NAME_GATEKEEPER = "gatekeeper_role"
    ROLE_NAME_DB_SYNC = "db_sync_role"

    SCHEMA_PORTAL_GEOSERVER = "grid_data_updated"

    TABLE_NAME_VERSIONS = "commits"
    TABLE_NAME_MIGRATIONS = "migrations"
    COLUMN_NAME_GEOMETRY = "geom"
    COLUMN_NAME_JSON_PROPERTIES = "properties"

    LATEST_VIEW_SUFFIX = "_latest"

    COLUMN_NAME_ROW_INDEX = "row_index"
    COLUMN_NAME_VERSION_ID = "version_id"
    COLUMN_NAME_STATE_CODE = "state_code"
    COLUMN_NAME_GLOBAL_ID = "global_id"
    COLUMN_NAME_IS_DELETED = "is_deleted"
    COLUMN_NAME_IS_NEW = "is_new"
    COLUMN_NAME_IS_UPDATED = "is_updated"

    IN_STAGING_EXTENT = "IN_STAGING_EXTENT"

    TEMP_EXPORT_VIEW = "temp_export"

    NEW_DB_SUFFIX = "_new"


class FuzzyMatchers(object):
    DISTANCE_WITHIN = "dist_within"
    INTERSECTS = "intersects"
    LEVENSHTEIN = "leven"
    EQUALS = "equals"
    ONLY_REPLACE_NULLS = "only_replace_null"


class FuzzyMatcherParams(object):
    METERS = "meters"
    MAX_LEVENSHTEIN_DISTANCE = "max_dist"
    DEFAULT_MAX_LEVENSHTEIN_DISTANCE = 3


class YamlConfigConstants(object):
    SOURCE = "source"
    TYPE = "type"
    LAYER_NAME = "layer"
    COMMON_CONFIG = "common_layer_config"
    LAYERS_TO_IMPORT = "layers_to_import"
    PARENT = "parent"

    DATABASE = "database"

    DB_FILTER = "db_filter"
    INPUT_DB_FILTER = "input_db_filter"
    ROW_LIMIT = "row_limit"
    DEFAULT_DB_FILTER = "1=1"

    SKIP_DIFF_MAPS = "skip_diff_maps"
    SKIP_BASEMAPS = "skip_basemaps"

    OGR2OGR_COLUMN_TYPES = "ogr2ogr_column_types"
    EXTRA_OGR2OGR_ARGS = "extra_ogr2ogr_args"
    # the key is also stored as an attribute for convenience
    LAYER_KEY = "layer_key"
    TARGET_DB_TABLE_NAME = "target_postgres_table"
    TARGET_DB_SCHEMA = "target_postgres_schema"
    PATH = "path"

    GEOM_COLUMN = "geom_column"

    ID_COLUMN = "id_column"
    ID_COLUMN_DEFAULT = "global_id"

    # an integer where the row index will be stored, unused in publication as the serial column is used and the
    # staging value ignored
    INDEX_COLUMN = "index_column"
    INDEX_COLUMN_DEFAULT = DbConstants.COLUMN_NAME_ROW_INDEX

    LABEL_TEMPLATE = "label"
    DEFAULT_LABEL_TEMPLATE = "Feature \\#${index} ${id_column}==${id}"

    EXISTING = "existing"
    UPDATED = "updated"
    DIFF_REPORT = "diff_report"
    SHOW_SHAPES_FOR_NEW_RECORDS = "show_new_shapes"

    OUTPUT_DIRECTORY = "out_dir"

    EXTENT = "extent"
    XMIN = "lon_min"
    XMAX = "lon_max"
    YMIN = "lat_min"
    YMAX = "lat_max"

    TILE_SERVER = "tile_server_xyz_url"

    CONNECTION_STRING = "db_uri"

    DATA_TYPES = "data_types"

    TRANSFORMATIONS = "transforms"

    DB_TRANSFORMATIONS = "db_transforms"

    USER_VERIFICATIONS = "verifications"


class Transformations:
    """
    Transforms that operate on GeoPandas dataframes,
    done before staging
    """

    DROP_COLUMNS = "drop_columns"
    RENAME_COLUMNS = "rename_columns"
    STRING_TO_DATE = "string_to_date"
    STRING_TO_BOOL = "string_to_boolean"
    INT_TO_BOOL = "integer_to_boolean"
    ADD_COLUMN = "add_column"
    SET_VALUES = "set_values"
    SQL_UPDATE = "sql_update"
    TO_MULTI_GEOMETRY = "geom_to_multi"
    TO_2D_GEOMETRY = "geom_to_2d"
    TO_NON_MULTI_GEOMETRY = "geom_to_non_multi"
    SET_NULL_VALUES = "set_null_values"

    DROP_UNUSED_COLUMNS = "drop_unused_columns"
    LATLON_TO_POINT = "latlon_to_point"
    ADD_MISSING_TARGET_COLUMNS = "add_missing_target_columns"

    STRIP_WHITESPACE = "strip_whitespace"
    TRIM_TO_NULL = "trim_to_null"

    STRING_REPLACE = "string_replace"


class DbTransformations:
    """
    Names of transformations done after data is staged to the
    database
    """

    SET_COLUMN_GEOSPATIALLY = "set_column_geospatially"

    SET_INVALID_WARDCODES_TO_NULL = "set_invalid_wardcodes_to_null"

    SET_COLUMN_BY_JOIN = "set_column_by_join"

    EXTRA_COLUMNS_TO_JSON = "extra_columns_to_json"

    WARD_TO_STATE_CODE = "ward_to_state_code"

    STRIP_ALL_WHITESPACE = "strip_all_whitespace"

    EMPTY_STRING_TO_NULL = "empty_string_to_null"

    # DROP_COLUMN = Transformations.DROP_COLUMN

    SET_NULL_VALUES = Transformations.SET_NULL_VALUES

    SET_DUPLICATE_OUT_OF_SCOPE_GLOBAL_IDS_TO_NULL = (
        "set_duplicate_out_of_scope_globalids_to_null"
    )

    STRING_REPLACE = "string_replace"

    BUFFERIZE = "bufferize"

    SET_DUPLICATES_TO_NULL = "set_duplicates_to_null"

    MAKE_VALID = "make_geom_valid"

    FUZZY_MATCH = "fuzzy_match"

    INSERT_FROM_MASTER = "insert_from_master"

    DELETE_ROWS = "delete_rows"

    TO_TEXT_COLUMN = "to_text_column"

    GMT_NAMES = "gmt_names"

    REPROJECT = "reproject"


class TransformationParams:
    DATE_FORMAT = "date_format"
    COLUMN_NAME = "column_name"
    COLUMN_TYPE = "column_type"
    COMMENTS = "comments"
    COLUMN_NAMES = "column_names"

    LAT_COLUMN_NAME = "lat_column_name"
    LON_COLUMN_NAME = "lon_column_name"
    SRID = "srid"

    JOIN_COLUMN = "join_column"

    TO = "to"
    MAPPING = "mapping"

    COLUMN_VALUE = "value"
    COLUMN_VALUE_GENERATOR = "value_generator"
    TRANSFORM_NAME = "name"

    MATCHERS = "matchers"

    ORDER = "order"

    TARGET_TABLE = "target_table"
    TARGET_SCHEMA = "target_schema"
    TARGET_COLUMN = "target_column"
    SOURCE_COLUMN = "source_column"

    FILTER = "filter"

    METHOD = "method"
    CENTROID_COVERS = "centroid_covers"
    SHAPE_INTERSECTS = "shape_intersects"
    SHAPE_COVERS = "shape_covers"

    TARGET_JOIN_COLUMN = "target_join_column"
    SOURCE_JOIN_COLUMN = "source_join_column"

    LOOKUP_TABLE = "lookup_table"

    EXTRACT_MULTIPOLYGON = "extract_multipolygon"

    STRICT = "strict"

    CASE_SENSITIVE = "case_sensitive"

    REPLACEMENTS = "replacements"

    WHOLE_STRING = "match_whole_string"
    IS_REGEX = "is_regex"

    WHERE_CLAUSE = "where_clause"

    BUFFER_SIZE = "buffer_size"


class AddColumnValueGenerators:
    """
    When adding a column, what to use for the new values
    """

    NEW_GUID = "new_guid"
    EXISTING_COLUMN = "other_col"
    DATE_NOW = "date_now"
    INTERPOLATED = "interp"


# ogr2ogr --formats
class GisFormats(StrEnum):
    SQLITE = "SQLite"
    SHAPEFILE = "ESRI Shapefile"
    FGDB = "FileGDB"
    POSTGIS = "PostgreSQL"
    UNSPECIFIED = "Not Specified"


class Verifications(object):
    CHECK_NOT_NULL = "check_not_null"
    CHECK_PARENT = "check_parent"

    CHECK_ST_ISVALID = "check_st_isvalid"
    CHECK_NON_EMPTY_GEOM = "check_non_empty_geom"

    CHECK_EXTENT = "check_extent"
    CHECK_IN_VALUES = "check_in_values"

    CHECK_REGEX = "check_regex"

    CHECK_STRING_LENGTH = "check_string_length"

    CHECK_MULTIPART_COUNT = "check_multipart_count"

    CHECK_SELF_INTERSECTION = "check_self_intersection"

    CHECK_MULTIPART_DISTANCE = "check_multipart_distance"


class VerificationParams:
    COLUMN_NAMES = TransformationParams.COLUMN_NAMES

    TEST_NAME = "name"

    PARENT_JOIN_COLUMN = "parent_join_column"
    JOIN_COLUMN = "join_column"

    EXTENT = "extent"
    VALUES = "values"

    REGEX = "regex"

    INVERT_MATCH = "invert_match"

    MAX_LENGTH = "max_length"

    SHOW_AS_WARNINGS = "show_as_warnings"

    MAX_COUNT = "max_count"
    MAX_DISTANCE_M = "max_dist_m"
