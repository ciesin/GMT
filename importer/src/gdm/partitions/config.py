import os
from pathlib import Path
import logging

from lib import file_utils

log = logging.getLogger(__name__)

class Config(object):
    MODULE_NAME = "partitions"
    SCHEMA_NAME = MODULE_NAME

    TABLE_BOUNDARY_ID = "boundary_id"

    TABLE_SETTLEMENT_PART = "settlement_part"
    TABLE_SETTLEMENT_NAME = "settlement_name"
    TABLE_HEALTH_FACILITY_POINT = "health_facility_point"
    TABLE_RI_CATCHMENT_ITEM = "ri_catchment_item"

    PARTITION_SCHEMA_SETTLEMENT_PART = "partitions_settlement_part"
    PARTITION_SCHEMA_SETTLEMENT_NAME = "partitions_settlement_name"
    PARTITION_SCHEMA_HEALTH_FACILITY_POINT = "partitions_health_facility_point"
    PARTITION_SCHEMA_RI_CATCHMENT_ITEM = "partitions_ri_catchment_item"


    WORKING_FOLDER = Path("/data/working") / MODULE_NAME

    # set during startup
    util_cfg = None


    LogPath = WORKING_FOLDER / "logs" / MODULE_NAME

    CLEAN = False
    LOG_LEVEL = "Warn"

    POP_RASTER_4326 = Path("/data/rasters/input/pop_4326.tif")

    BOUNDARY_OPERATING_LEVEL = int(os.environ["OPERATIONAL_BOUNDARY_LEVEL"])


def check_clean_work_dir(cfg, folder_path: Path):
    if cfg.CLEAN:
        file_utils.remove_dir(folder_path, cfg.WORKING_FOLDER)

    if folder_path.exists():
        log.info(f"{folder_path} exists, no need to perform step")
        return True

    folder_path.mkdir(parents=True, exist_ok=True)

    return False

def check_clean_work_file(cfg, file_path: Path):
    if cfg.CLEAN:
        file_utils.remove_file(file_path)
        file_utils.remove_dir(file_path, cfg.WORKING_FOLDER)

    if file_path.exists():
        log.info(f"{file_path} exists, no need to perform step...")
        return True

    file_path.parent.mkdir(parents=True, exist_ok=True)

    return False