import copy
from collections import OrderedDict
from os import PathLike
from pathlib import Path
from typing import List, Dict

import yaml
import yamlloader

from importer.constants import YamlConfigConstants
from importer.util import merge_dictionaries, ConfigException
from lib.db_utils import UtilConfig

class ImportConfig:
    """
    Parses the YAML configuration of an import
    """
    def __init__(self, file_paths: List[Path], command_line_arguments):

        # deserialized configuration
        self.yaml_config = {}

        # load one by one, last one wins
        for config_file_path in file_paths:

            # noinspection PyTypeChecker
            with open(config_file_path) as file:
                yc = yaml.load(file, Loader=yamlloader.ordereddict.CLoader)

                if yc is None:
                    raise ConfigException(f"yc is None for {config_file_path}")

                common_config = yc.get(YamlConfigConstants.COMMON_CONFIG, {})

                if common_config is None:
                    common_config = {}

                new_layers = OrderedDict()
                all_layers_dict = yc.get(YamlConfigConstants.LAYERS_TO_IMPORT, {})
                for import_key in all_layers_dict:
                    layer_yaml = all_layers_dict[import_key]

                    # starting point is a deep copy of the common configuration
                    layer = copy.deepcopy(common_config)

                    # do we have a parent
                    parent_config_key = layer_yaml.get(YamlConfigConstants.PARENT, None)

                    if parent_config_key:
                        parent_config = yc.get(parent_config_key)
                        parent_config = copy.deepcopy(parent_config)
                        layer = merge_dictionaries(layer, parent_config)

                    layer = merge_dictionaries(layer, layer_yaml)

                    new_layers[import_key] = layer

                yc[YamlConfigConstants.LAYERS_TO_IMPORT] = new_layers

                self.yaml_config = merge_dictionaries(self.yaml_config, yc)

        db_config = self.yaml_config[YamlConfigConstants.DATABASE]

        # Create a config class containing the database connection info
        self.util_cfg = UtilConfig(db_config, command_line_arguments)


