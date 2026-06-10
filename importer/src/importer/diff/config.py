import logging
from pathlib import Path

from osgeo import ogr
import yaml

from importer.constants import GisFormats, YamlConfigConstants, TILE_XYZ_SERVER_1
from importer.util import CaseInsensitively, ConfigException, apply_env_variables

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)

def get_full_path(layer_config) -> Path:
    """
    For non database inputs, returns the full path to the geometry
    """
    path = layer_config[YamlConfigConstants.PATH].strip()

    # Assume paths are relative
    assert not path.startswith(".")

    return Path(path)


class DiffConfig:
    """
    Parses the YAML configuration of a single diff between 2 layers
    """

    def __init__(self, config_obj):

        self.yc = config_obj

        # root node
        self.diff_cfg = self.yc[YamlConfigConstants.DIFF_REPORT]

        self.existing = self.diff_cfg[YamlConfigConstants.EXISTING]
        self.updated = self.diff_cfg[YamlConfigConstants.UPDATED]

        self.config_nodes = [self.existing, self.updated]

        self.id_column_names = [
            node.get(YamlConfigConstants.ID_COLUMN, YamlConfigConstants.ID_COLUMN_DEFAULT)
            for node in self.config_nodes
        ]

        self.output_dir = Path(self.diff_cfg[YamlConfigConstants.OUTPUT_DIRECTORY])

    def verify(self):
        """
        Verifies the configuration, throws an execption if there is a problem
        """

        self.check_layer(self.existing)
        self.check_layer(self.updated)

    def get_tile_server(self):
        return self.diff_cfg.get(
            YamlConfigConstants.TILE_SERVER,
            TILE_XYZ_SERVER_1
        )

    @staticmethod
    def check_layer(config_node):
        """
        Makes sure the layer exists

        For shapefiles will set layer name to shp file stem

        :param config_node:

        Throws ConfigException if there is a problem
        """

        type = config_node.get(YamlConfigConstants.TYPE, GisFormats.UNSPECIFIED)

        cfg_layer_name = config_node.get(YamlConfigConstants.LAYER_NAME, None)

        if type == GisFormats.POSTGIS:
            full_path = "Database"
            conn_string = "PG: "  + apply_env_variables(config_node[YamlConfigConstants.CONNECTION_STRING])
            conn = ogr.Open(conn_string)

            if conn is None:
                raise ConfigException(f"Could not open a PostgreSQL database connection")
        else:

            try:
                full_path = get_full_path(config_node)
            except KeyError:
                raise ConfigException(f"Make sure path is defined for layer \"{cfg_layer_name}\" with type \"{type}\"")

            log.info(f"Opening to check layers: \"{full_path}\"")
            conn = ogr.Open(str(full_path))

            if conn is None:
                raise Exception(f"Could not open \"{full_path}\"")

            path_obj = Path(full_path)

            # Special case for shape files & geojson/json, the layer name is always the name of the shapefile
            if path_obj.suffix.lower() in [".shp", ".csv"]:
                cfg_layer_name = path_obj.stem
                # always force
                config_node[YamlConfigConstants.LAYER_NAME] = cfg_layer_name
            elif path_obj.suffix.lower() in [".json", ".geojson"] and not cfg_layer_name:
                cfg_layer_name = path_obj.stem
                config_node[YamlConfigConstants.LAYER_NAME] = cfg_layer_name

        try:
            layer_list = []
            for i in conn:
                layer_name = i.GetName()
                # print(layer_name)
                layer_list.append(layer_name)

            layer_list.sort()

            if cfg_layer_name is None:
                raise ConfigException(f"Must provide an input layer name: {YamlConfigConstants.LAYER_NAME}.  Add a layer: <name in the imported shapefile> to the YML file")

            if CaseInsensitively(cfg_layer_name) not in layer_list:
                layer_list = ", ".join(layer_list)
                raise ConfigException(f"""Layer [{cfg_layer_name}] not found in [{full_path}].  Layers detected: {layer_list})""")

            layer = conn.GetLayer(cfg_layer_name)
            layer_def = layer.GetLayerDefn()

            # OGR will leave out primary keys

        finally:
            conn.Destroy()