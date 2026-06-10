# -*- coding: utf-8 -*
import argparse
import logging

# Load environment variables (Important this be done before the Config class is instantiated)
import yaml

from lib import logger_utils, file_utils
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

    python3.8 /src/gdm/partitions/main.py --config /config_files/docker_local_db.yml 1 7 --clean

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

    parser.add_argument("--log-level", type=str, default="warn",
                        help="Error/Warn/Info/Debug/Trace")

    args = parser.parse_args()

    cfg.LOG_LEVEL = args.log_level
    cfg.CLEAN = args.clean

    with open(args.config_path) as file:
        yaml_config = yaml.load(file, Loader=yaml.FullLoader)

    db_config = yaml_config[YamlConfigConstants.DATABASE]

    # Create a config class containing the database connection info
    util_cfg = UtilConfig(db_config, command_line_args=args)

    if not args.stop_step:
        args.stop_step = args.start_step

    cfg.util_cfg = util_cfg

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
        steps.step_partition,
        steps.step_partition_settlement_parts,
        steps.step_partition_settlement_names,

        steps.step_partition_hf,
        steps.step_partition_ri,

        steps.step_aggregrate_settlements,

        # 8. optional since we do this on checkout
        steps.step_calculate_catchments,

        #steps.step_clean_db,



        # Checks for empty partitions
        # steps.step_debug_sp,
    ]

    for step_fn in step_list:
        current_step_num = run_step(cfg, current_step_num, start_step, stop_step, step_fn, util_cfg)
    return current_step_num


# ------------------------------------------------------------
# Main program; error in b1e3d79e-23b1-4170-9adf-15f3102dff3d
# ------------------------------------------------------------
if __name__ == '__main__':
    main()