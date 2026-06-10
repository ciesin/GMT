# -*- coding: utf-8 -*
import argparse
import logging
import os
import sys
from pathlib import Path


# Load environment variables (Important this be done before the Config class is instantiated)
import yaml

from lib import file_utils, logger_utils
from lib.db_utils import UtilConfig

from importer.constants import YamlConfigConstants

from lib.env_utils import load_env_files
from lib.file_utils import parse_path

# Step definitions

from config import Config as cfg
import steps 
from lib.gdm_utils import run_step, run_gdm


def main():
    """
    Main entry point for the application.  Parses command line arguments and executes them.

    python3.8 /src/gdm/prepare_rasters/main.py --config /config_files/docker_local_db.yml 1 4
    """
    parser = argparse.ArgumentParser(description='Compute zonal stats of settlement parts')

    parser.add_argument('-c', '--config', action='store',
                        dest="config_path",
                        type=parse_path,
                        required=True,
                        help='A file path to the Yaml configuration.  ')

    parser.add_argument('--username', help="Specifies the postgres username to use")

    parser.add_argument('--password', help="Specifies the postgres password to use")

    parser.add_argument('--clean', action='store_true',
                        help='If true, will drop the existing data in the publication schema')

    parser.add_argument("start_step", type=int)
    parser.add_argument("stop_step", type=int, nargs="?")

    args = parser.parse_args()

    if args.clean:
        cfg.CLEAN = True

    with open(args.config_path) as file:
        yaml_config = yaml.load(file, Loader=yaml.FullLoader)

    db_config = yaml_config[YamlConfigConstants.DATABASE]

    # Create a config class containing the database connection info
    util_cfg = UtilConfig(db_config, command_line_args=args)

    if not args.stop_step:
        args.stop_step = args.start_step

    gdm_process(args.start_step, args.stop_step, util_cfg)

def gdm_process(start_step, stop_step, util_cfg):

    current_step_num = 0

    file_utils.mkdir_p(cfg.LogPath.parent)

    print("Saving log to %s" % cfg.LogPath)

    logger = logger_utils.init_log(log_name=None,
                                   console_level=logging.DEBUG,
                                   file_level=logging.DEBUG,
                                   log_path=cfg.LogPath,
                                   log_format_str="%(asctime)s %(filename)s:%(lineno)d %(levelname)s %(name)s ==> %(message)s\n")

    step_list = [

        # Note this script is out of date, we are using 4326 population rasters
        # We are using NGA_population_v2_0_gridded directly, in 4326, renamed to pop_4326.tif

        # Friction rasters are also not currently being used
        steps.step_reproject_pop_raster_3857,

        steps.step_reproject_friction_raster_3857,
        steps.step_reproject_mixed_friction_raster_3857,

        steps.step_copy_to_input

    ]

    for step_fn in step_list:
        current_step_num = run_step(cfg, current_step_num, start_step, stop_step, step_fn, util_cfg)
    return current_step_num


# ------------------------------------------------------------
# Main program
# ------------------------------------------------------------
if __name__ == '__main__':
    main()