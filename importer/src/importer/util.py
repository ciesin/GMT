import argparse
import datetime
import importlib
import logging
import math
import os
import pkgutil
import re
import shutil
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List

import diskcache
import geopandas
import pandas
from psycopg2._psycopg import connection

from importer.constants import YamlConfigConstants, TransformationParams
from lib import thread_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


class ConfigException(Exception):
    pass



def init_logging(is_verbose: bool):
    """
    Initializes logger.

    Disables non grid3 related logs

    :param is_verbose: False will disable all loggers beloging to trace
    """

    log_level = logging.DEBUG
    log_format = "  %(asctime)-15s %(levelname)-8s %(name)-25s %(lineno)-5d | %(message)s"

    logging.root.setLevel(log_level)

    stream = logging.StreamHandler()
    stream.setLevel(log_level)

    formatter = logging.Formatter(log_format)
    stream.setFormatter(formatter)

    logging.root.handlers = []
    logging.root.addHandler(stream)

    logging.getLogger("fiona").setLevel(logging.CRITICAL)
    logging.getLogger("matplotlib").setLevel(logging.CRITICAL)
    logging.getLogger("urllib3").setLevel(logging.CRITICAL)
    logging.getLogger("chardet").setLevel(logging.CRITICAL)
    logging.getLogger("PIL.Image").setLevel(logging.CRITICAL)

    if not is_verbose:
        logging.getLogger("trace").setLevel(logging.CRITICAL)

    # we want our logs to stdout, and this can cause open file handle issues
    # if log_base_dir is not None:
    #     output_file_handler = logging.FileHandler(log_base_dir / "script_output.log")
    #     output_file_handler.setFormatter(formatter)
    #     logging.root.addHandler(output_file_handler)




# https://stackoverflow.com/questions/7204805/dictionaries-of-dictionaries-merge/7205107#7205107
def merge_dictionaries(a: Dict, b: Dict, path=None):
    """
    merges b into a

    Lists are extended, b dictionary values overwrite a dictionary values of same key

    :param a:
    :param b:
    :param path:
    :return:
    """
    if path is None: path = []

    if b is None:
        return a
        #raise ConfigException(f"Cannot merge dictionaries.  b is None.  a: {a}")

    for key in b:
        b_val = b[key]

        if b_val is None:
            # nothing to merge
            continue

        if key in a:
            a_val = a[key]

            if a_val is None:
                # use b's value directly
                a[key] = b_val
            elif isinstance(a_val, dict) and isinstance(b_val, dict):
                merge_dictionaries(a[key], b[key], path + [str(key)])
            elif isinstance(a_val, list) and isinstance(b_val, list):
                a[key].extend(b_val)
            elif type(a_val) == type(b_val):
                # overwrite a value with another value
                a[key] = b_val
            elif a_val == b_val:
                pass  # same leaf value
            else:
                path = '.'.join(path + [str(key)])
                raise Exception(f'Conflict at {path}.  {type(a_val)} vs {type(b_val)} {a} and {b}' )
        else:
            a[key] = b_val
    return a



def convert_markdown_to_html_and_pdf(path_markdown_output: Path, output_dir: Path, title: str = "Diff Report", skip_pdf=False):
    report_assets_dir = Path(__file__).parent / "assets" / "reports"

    css_path = report_assets_dir / "pandoc.css"

    shutil.copy(css_path, output_dir)

    html_output_path = output_dir / path_markdown_output.with_suffix(".html").name
    pdf_output_path = output_dir / path_markdown_output.with_suffix(".pdf").name

    # +RTS -K1024M -RTS is to address stack size issues for larger diff reports
    thread_utils.run_process(
        cmd_line=fr"""pandoc --from gfm --to html --standalone --output "{html_output_path}" --css "{css_path.name}" --metadata pagetitle="{title}" +RTS -K1024M -RTS "{path_markdown_output}" """,
        cwd=output_dir
    )

    if not skip_pdf:
        thread_utils.run_process(
            fr"""pandoc --from gfm  --standalone --output "{pdf_output_path}"  "{path_markdown_output}" """,
            cwd=output_dir
        )


def is_null(val) -> bool:
    if val is None:
        return True

    if isinstance(val, float) and math.isnan(val):
        return True

    if isinstance(val, type(pandas.NaT)) and pandas.isnull(val):
        return True

    return False


def compare_values(val_1, val_2) -> bool:

    if is_null(val_1) and is_null(val_2):
        return True

    return val_1 == val_2


def layers_iterator(yaml_config, specific_table_names: List[str], node_name=YamlConfigConstants.LAYERS_TO_IMPORT):
    """
    Yields the layer objects, applying the common configuration

    :param yaml_config: the deserialized yaml configuration
    :param specific_table_names: if defined, will only process layer entries targeting this table
    """
    yielded_count = 0
    configured_export_layers = []

    all_layers_dict = yaml_config[node_name]
    for import_key in all_layers_dict:

        layer = all_layers_dict[import_key]

        # for convenience, the key is also copied to the target
        layer[YamlConfigConstants.LAYER_KEY] = import_key

        configured_export_layers.append(import_key)

        #table_schema = layer[YamlConfigConstants.TARGET_DB_SCHEMA]
        #table_name = layer[YamlConfigConstants.TARGET_DB_TABLE_NAME]
        #table = f"{table_schema}.{table_name}"

        if specific_table_names is not None and CaseInsensitively(import_key) not in specific_table_names:
            continue

        yielded_count += 1
        yield layer

    if len(yaml_config[node_name]) == 0:
        raise ConfigException(f"No layers configured in {node_name} section")
    elif specific_table_names is not None and len(specific_table_names) > yielded_count:
        table_names = ", ".join([f"\"{t}\"" for t in specific_table_names])
        export_table_names = ",\n".join(sorted(configured_export_layers))
        raise ConfigException(f"Not all selected table names {table_names} "
                              f"exist in configured layers:\n{export_table_names}")



# https://stackoverflow.com/questions/3627784/case-insensitive-in-python
class CaseInsensitively(object):
    def __init__(self, s):
        self.__s = s.lower()
    def __hash__(self):
        return hash(self.__s)
    def __eq__(self, other):
        # ensure proper comparison between instances of this class
        try:
           other = other.__s
        except (TypeError, AttributeError):
          try:
             other = other.lower()
          except:
             pass
        return self.__s == other


_RE_ONLY_ONE_DASH = re.compile(r"\-+")
_RE_PERIOD_ONE_SPACE = re.compile(r"\.\s")


def sanitize_id(s: str) -> str:
    """
    To convert a label into a markdown anchor
    :param s: a string/label
    :return: anchor
    """

    # This check is because the double spaces can be changed to a single space in the html
    #if "  " in s:
    #    raise Exception(f"Double space in {s}")

    s = s.strip()
    s = _RE_PERIOD_ONE_SPACE.sub("-", s)

    s = s.replace(" ", "-").lower()

    for c in [":", "#", "=", "[", "]", "\\", "/", ".", ",", "(", ")", "'", "!", ".", "*", "\"",]:
        s = s.replace(c, "")

    return s
    #return _RE_ONLY_ONE_DASH.sub("-", s)


def format_markdown_error(s: str) -> str:
    return f"<span style=\"color:red\">{s}</span>"


def format_missing_columns_msg(gdf, target_column) -> str:
    existing_cols = ", ".join([f"\"{c}\"" for c in gdf.columns])
    return f"Column \"{target_column}\" not found.  Columns found: {existing_cols}"


def format_missing_columns_msg_db(columns: List[str], target_column:str) -> str:
    existing_cols = ", ".join([f"\"{c}\"" for c in columns])
    return f"Column \"{target_column}\" not found.  Columns found: {existing_cols}"


def apply_env_variables(s: str) -> str:
    #
    in_dollar = False
    env_var_name = ""
    str_to_copy = ""

    ret_str_parts = []
    for ch in s:
        if ch == '$':
            if in_dollar:
                raise ConfigException("embedded $")
            in_dollar = True

            if len(str_to_copy) > 0:
                ret_str_parts.append(f"{str_to_copy}")
                str_to_copy = ""
            continue

        if ch == '{' and in_dollar:
            continue

        if ch == '}' and in_dollar:
            ret_str_parts.append(os.environ[env_var_name])
            in_dollar = False
            env_var_name = ""
            continue

        if in_dollar:
            env_var_name += ch
            continue

        str_to_copy += ch

    if len(str_to_copy) > 0:
        ret_str_parts.append(f"{str_to_copy}")

    return "".join(ret_str_parts)

def interp_string(s: str) -> str:
    #
    in_dollar = False
    col_name = ""
    str_to_quote = ""

    ret_str_parts = []
    for ch in s:
        if ch == '$':
            if in_dollar:
                raise ConfigException("embedded $")
            in_dollar = True

            if len(str_to_quote) > 0:
                ret_str_parts.append(f"\"{str_to_quote}\"")
                str_to_quote = ""
            continue

        if ch == '{' and in_dollar:
            continue

        if ch == '}' and in_dollar:
            ret_str_parts.append( f"gdf['{col_name}']" )
            in_dollar = False
            col_name = ""
            continue

        if in_dollar:
            col_name += ch
            continue

        str_to_quote += ch

    if len(str_to_quote) > 0:
        ret_str_parts.append( f"\"{str_to_quote}\"" )

    return " + ".join(ret_str_parts)


def interp_callable(s: str) -> str:
    #
    in_dollar = False
    col_name = ""
    str_to_quote = ""

    ret_str_parts = []
    is_var = []

    for ch in s:
        if ch == '$':
            if in_dollar:
                raise ConfigException("embedded $")
            in_dollar = True

            if len(str_to_quote) > 0:
                ret_str_parts.append(str_to_quote)
                str_to_quote = ""
                is_var.append(False)
            continue

        if ch == '{' and in_dollar:
            continue

        if ch == '}' and in_dollar:
            if col_name == "idx":

                ret_str_parts.append("$idx")
                is_var.append(True)
            else:
                ret_str_parts.append( col_name )
                is_var.append(True)
            in_dollar = False
            col_name = ""
            continue

        if in_dollar:
            col_name += ch
            continue

        str_to_quote += ch

    if len(str_to_quote) > 0:
        ret_str_parts.append( str_to_quote )
        is_var.append(False)

    def do_replacements(row):
        ret = ""
        for i in range(0, len(is_var)):
            if is_var[i]:
                if ret_str_parts[i] == "$idx":
                    # keep $idx, will be replaced later
                    ret += ret_str_parts[i]
                else:
                    ret += row[ret_str_parts[i]]
            else:
                ret += ret_str_parts[i]
        return ret

    return do_replacements


def parse_path(arg: str) -> Path:
    """
    :param arg: command line argument passed by the user
    :return: parsed path
    """
    p = Path(arg)
    if not p.exists() or not p.is_file():
        raise argparse.ArgumentTypeError(f"[{arg}] is not a valid file")

    return p


def parse_date(arg: str) -> datetime:
    return datetime.datetime.strptime(arg, '%Y-%m-%d')



@dataclass
class ParamDocItem:
    name: str
    desc: str

@dataclass
class DocItem:
    section: str
    name: str
    desc: str

    param_docs: List[ParamDocItem] = field(default_factory=list)
    params: List[str] = field(default_factory=list)

    explicit_yaml_examples: List[Dict] = field(default_factory=list)

    extended_desc: str = ""

    def set_name_on_examples(self):
        old_ex = self.explicit_yaml_examples

        self.explicit_yaml_examples = []
        for ex in old_ex:
            new_ex = OrderedDict()
            new_ex[TransformationParams.TRANSFORM_NAME] = self.name
            new_ex.update(ex)
            self.explicit_yaml_examples.append(new_ex)

    def infer_params_from_examples(self):
        """
        Infers which parameters this transform accepts by iterating through the examples
        """
        params = set()
        for ex in self.explicit_yaml_examples:
            for p in ex:
                params.add(p)

        self.params = list(params)


def get_plugins(ns_pkg) -> Dict[str, object]:
    plugin_db_tranforms = {}

    discovered_plugins = [
        importlib.import_module(name)
        for finder, name, ispkg
        in pkgutil.iter_modules(ns_pkg.__path__, ns_pkg.__name__ + ".")
    ]

    for m in discovered_plugins:
        trace_log.debug(f"Found plugin {m.__name__}")
        if not hasattr(m, 'doc'):
            trace_log.debug(f"{m.__name__} has no doc function defined")
            continue
        else:
            util_doc_item = m.doc()
            plugin_db_tranforms[util_doc_item.name] = m

    return plugin_db_tranforms


def confirm(message):
    return input(message + " (y/n): ").lower()[0] == "y"

@dataclass
class TransformArguments:
    """
    Data transfer object to pass to dynamic transform modules
    """
    # This contains the deserialized YAML of the transform command itself
    gdf: geopandas.GeoDataFrame

    # This contains the deserialized YAML of the transform command itself
    transform_config: Dict

    # Contains the list of columns in the master table
    target_columns: List[str]

    # contains the deserialized YAML for the entire layer
    layer_config: Dict


@dataclass
class DbTransformArguments:
    """
    Data Transfer object to pass to dynamic DB transform modules
    """

    # psycopy2 connection
    conn: connection

    # The name of the table in both the master & staging schemas
    postgis_table_name: str

    # Contains the deserialized YAML of the transform itself
    transform_config: Dict

    # Contains the deserialized YAML of the entire layer
    layer_config: Dict

    # Name of the staging schema for the current postgresql user
    staging_schema: str

@dataclass
class VerificationVars:
    """
    DTO to pass to dynamic DB verification modules
    """
    conn: object
    table_name: str
    schema_name: str
    # to prevent circular refs
    import_config: object # ImportConfig
    layer_config: Dict
    staging_schema: str

    output: str = ""
    source_geom_info: Dict = None
    cache: diskcache.Cache = None
    test_config: Dict = None



