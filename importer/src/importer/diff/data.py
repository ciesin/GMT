"""
File concerned with loading the data needed to compare 2 layers
"""
import logging
import uuid
from typing import List, Union, Tuple, Dict

import geopandas
import geopandas as gpd
import psycopg2
from osgeo import ogr
from psycopg2.sql import SQL, Identifier, Literal
from shapely import wkb
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry

from importer.constants import YamlConfigConstants, GisFormats, DbConstants, EXISTING_SET_INDEX, UPDATED_SET_INDEX
from importer.util import ConfigException, CaseInsensitively, apply_env_variables
from lib import db_utils
from .config import DiffConfig

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def load_geopandas_from_postgis(config_node, db_conn, ignore_db_filter=False):

    conn_str = apply_env_variables(config_node[YamlConfigConstants.CONNECTION_STRING])
    layer_name = config_node[YamlConfigConstants.LAYER_NAME]
    filter = config_node.get(YamlConfigConstants.DB_FILTER, YamlConfigConstants.DEFAULT_DB_FILTER)
    input_filter = config_node.get(YamlConfigConstants.INPUT_DB_FILTER, None)

    if ignore_db_filter:
        filter = YamlConfigConstants.DEFAULT_DB_FILTER

    if input_filter:
        filter = input_filter

    with psycopg2.connect(conn_str) as conn:
        schema_name, table_name = layer_name.split(".")
        # geom_info = geo_db_utils.get_geometry_column_info(conn, schema_name, table_name)
        #
        # if geom_info is None:
        #     raise ConfigException(f"Geometry column not found in {schema_name}.{table_name}")

        #geometry_column_name = geom_info['column_name']

        log.info(f"Fetching incoming PostGIS data with filter: {filter}")

        row_limit = config_node.get(YamlConfigConstants.ROW_LIMIT, None)

        # SQL Injection does not apply since the config file is from a trusted user who already has access to the machine
        sql = f"SELECT * FROM \"{schema_name}\".\"{table_name}\" WHERE {filter}"

        if row_limit is not None:
            sql += f" LIMIT {row_limit}"

        gdf = gpd.GeoDataFrame.from_postgis(sql, conn, geom_col="geom")

    return gdf


def get_shapely_object_for_state(db_conn, state_code):
    sql = SQL("""
                   SELECT {} FROM {}.boundary_states_latest
                       WHERE state_code = {}                
                           """).format(
        Identifier(DbConstants.COLUMN_NAME_GEOMETRY),
        Identifier(DbConstants.SCHEMA_MASTER),
        Literal(state_code)
    )
    rows = db_utils.get_results(db_conn, sql)
    if len(rows) == 0:
        raise ConfigException(f"Cannot find extent for state: '{state_code}'")
    first_row = rows[0]

    return wkb.loads(first_row[0], hex=True)



def load_staging_column_names_types(config_node):
    """
    Loads staging column names
    :return:
    """
    format_type = config_node.get(YamlConfigConstants.TYPE, GisFormats.UNSPECIFIED)
    format_type_i = CaseInsensitively(format_type)

    if format_type_i == GisFormats.POSTGIS:
        return []
    else:
        ret = []

        path = config_node[YamlConfigConstants.PATH]

        layer_name = config_node[YamlConfigConstants.LAYER_NAME]

        reader = ogr.Open(path)
        layer = reader.GetLayer(layer_name)

        defn = layer.GetLayerDefn()
        for n in range(defn.GetFieldCount()):
            fd = defn.GetFieldDefn(n)
            type = fd.GetType()
            ret.append( (fd.GetName().lower(), fd.GetFieldTypeName(type)) )

        crs = layer.GetSpatialRef()
        #https://gis.stackexchange.com/questions/20298/is-it-possible-to-get-the-epsg-value-from-an-osr-spatialreference-class-using-th
        ret.append( (DbConstants.COLUMN_NAME_GEOMETRY, f"Geometry({ogr.GeometryTypeToName(defn.GetGeomType())}, {get_srid(crs)})" ))

        ret.sort()
        return ret


def get_srid(srs):

    if srs is None:
        log.warning("Srs is NONE, defaulting to lat/lon 4326")
        # default to lat/lon
        return 4326
    #srs.ExportToProj4()

    srs.AutoIdentifyEPSG()

    # https://gis.stackexchange.com/questions/7608/shapefile-prj-to-postgis-srid-lookup-table/7615#7615
    ret = srs.GetAuthorityCode(None)

    return ret


def load_geopandas(
        config_node,
        all_cfg,
        target_column_names = None,
        db_conn = None,
        ignore_db_filter=False,
        ) -> (geopandas.GeoDataFrame, str):
    """

    :param config_node: Deserialized YAML configuration (left or right node)
    :return: The GeoPandas dataframe and markdown output for the staging report
    """
    format_type = config_node.get(YamlConfigConstants.TYPE, GisFormats.UNSPECIFIED)
    format_type_i = CaseInsensitively(format_type)

    markdown_output = ""
    # Trying to remove geopandas so for now we only support postgis.  Eventually
    # the diff needs to work directly in postgis
    if format_type_i == GisFormats.POSTGIS:
        ret = load_geopandas_from_postgis(config_node, db_conn=db_conn, ignore_db_filter=ignore_db_filter)

    else:
        raise Exception(f"Type not recognized: [{format_type}]")

    markdown_output += f"Loaded {len(ret)} rows.\n\n"

    # Even for points, this is OK since it is an empty geometry
    ret.geometry = ret.geometry.fillna(value=Polygon())

    # If no CRS set in input data then default to 4326
    if not ret.crs:
        markdown_output += "Defaulting to 4326 as no CRS was set on input data\n\n"
        ret.crs = 4326

    # need it in lat/lon for readability, basemap, and to use same projection during the diff images
    ret.to_crs(crs="epsg:4326", epsg=4326, inplace=True)

    if (db_filter := all_cfg.get(YamlConfigConstants.DB_FILTER)) is not None:
        if (extent := db_filter.get(YamlConfigConstants.EXTENT)) is not None:
            xmin = float(extent[YamlConfigConstants.XMIN])
            ymin = float(extent[YamlConfigConstants.YMIN])
            xmax = float(extent[YamlConfigConstants.XMAX])
            ymax = float(extent[YamlConfigConstants.YMAX])

            ret = ret.cx[xmin:xmax, ymin:ymax]

            markdown_output += f"Filtered by extent, row count is now {len(ret)}\n\n"

    # make all columns lower case
    ret.columns = [x.lower().strip() for x in ret.columns]

    markdown_output += f"Columns in geopandas dataframe: {', '.join(ret.columns)}\n\n"

    return ret, markdown_output



class DiffData:
    """
    Loads the GIS data into GeoPandas dataframes
    """

    def __init__(self, config_diff: DiffConfig):
        self.df_existing, _ = load_geopandas(config_diff.existing, config_diff.diff_cfg)
        self.df_updated, _ = load_geopandas(config_diff.updated, config_diff.diff_cfg)

        self.dfs = (self.df_existing, self.df_updated)

        # assume both datasets have the same id column
        id_column_names =(
                config_diff.existing.get(YamlConfigConstants.ID_COLUMN, YamlConfigConstants.ID_COLUMN_DEFAULT),
                config_diff.updated.get(YamlConfigConstants.ID_COLUMN, YamlConfigConstants.ID_COLUMN_DEFAULT)
        )

        self.label_templates = (
            config_diff.existing.get(YamlConfigConstants.LABEL_TEMPLATE, YamlConfigConstants.DEFAULT_LABEL_TEMPLATE),
            config_diff.updated.get(YamlConfigConstants.LABEL_TEMPLATE, YamlConfigConstants.DEFAULT_LABEL_TEMPLATE),
        )

        self._id_column_indexes = []

        for df_idx, df in enumerate(self.dfs):
            df.sort_values(by=[id_column_names[df_idx]], inplace=True)

            # The position of the id column, 0 based
            self._id_column_indexes.append( df.columns.get_loc(id_column_names[df_idx]) )

            if (row_limit := config_diff.diff_cfg.get("row_limit", None)) is not None:
                #print(f"Row limit is {row_limit}")
                row_limit = int(row_limit)
                # print(f"Cropping to row limit of {row_limit}")
                df.drop(df.tail( max(0,len(df) - row_limit)).index, inplace=True)

    def get_ids(self, row_indices: List[int]) -> List[Union[str, uuid.UUID, int]]:
        """
        :param row_indices: Row Indexes in to the dataframes
        :return: the values of the id column for the existing & updated datasets
        at the given indices
        """

        # no existing records, so just return the updated index
        if len(self.df_existing) == 0 or row_indices[EXISTING_SET_INDEX] is None:
            return [None, self.get_id_from_index(row_indices[UPDATED_SET_INDEX], UPDATED_SET_INDEX)]

        return [self.get_id_from_index(row_indices[df_index], df_index)
                for df_index in range(0, 2)]

    def get_id_from_index(self, row_index: int, df_index: int) -> Union[str, uuid.UUID, int]:
        return self.dfs[df_index].iat[row_index, self._id_column_indexes[df_index]]

    def get_feature_label(self, df_index:int, row_index:int, id_column: str, id_value):
        """
        :param df_index Data frame index.  0 for existing, 1 for updated
        :param row_index: row #
        :param id_column: label for the id
        :param id_value: unique identifying value of feature
        :return: A label used in the reports for a particular feature
        """

        # TODO get label from database
        return str(id_value)
        # return get_feature_label(df=self.dfs[df_index],
        #                          label_template=self.label_templates[df_index],
        #                          row_index=row_index,
        #                          id_column=id_column,
        #                          id_value=id_value)

    def get_shapes(self, row_indices) -> Tuple[Union[BaseGeometry]]:
        """
        :param row_indices: Row Indexes in to the dataframes
        :return: the shapes (Shapely) for the left & right datasets
        at the given indices
        """
        lst: List[BaseGeometry] = [self.get_shape(df_index, row_indices[df_index])
                for df_index, df in enumerate(self.dfs)]
        return tuple(lst)

    def get_shape(self, df_index, row_index) -> BaseGeometry:

        return self.dfs[df_index].iloc[row_index][self.dfs[df_index].geometry.name]

    def get_attributes(self, row_indices) -> Tuple[Dict, Dict]:
        """
        :param row_indices: Row Indexes in to the dataframes
        :return: the shapes (Shapely) for the left & right datasets
        at the given indices
        """

        dicts = ( {}, {} )

        for idx, df in enumerate(self.dfs):
            #cn.remove(self.dfs[idx].geometry_name)
            df = self.dfs[idx]
            row = df.iloc[row_indices[idx]]

            for column_name in df.columns:
                if column_name in [df.geometry.name, DbConstants.COLUMN_NAME_ROW_INDEX, DbConstants.COLUMN_NAME_VERSION_ID]:
                    continue

                dicts[idx][column_name] = row[column_name]

        return dicts
