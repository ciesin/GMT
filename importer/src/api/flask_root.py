import logging
import math
import os
import pprint
import tempfile
from pathlib import Path
import uuid
from typing import Tuple, TypedDict, List, cast, Optional

from flask import Flask, request, jsonify, send_from_directory, Response
import sys

from werkzeug.datastructures import MultiDict

from lib.raster_stats import RasterStats
from lib.thread_utils import run_process_stream_output
from modules.db_checks.checks import run_data_check
from modules.excel_exporter.excel_export import (
    run_excel_export,
    run_excel_export_per_boundary,
)
from modules.excel_exporter.excel_export_rew import run_excel_export_rew
from modules.excel_exporter.excel_export_debug_main import debug_main
from modules.exporter import data_exporter
from modules.exporter_api.api_export import run_state_export
from modules.exporter_shared.zip_export import create_export_zip
from modules.params.flask_root_params import (
    GeometryExportParams,
    StateExportParams,
    BoundaryToExport,
    DataCheckParams,
    ExportExcelParams,
    RewExportExcelParams,
    ServerSideExportParams,
)
from modules.params.gmt_credentials import GmtDbCredentials

log = logging.getLogger(__name__)

app = Flask(__name__)


#
@app.before_first_request
def init_logging() -> None:
    print("INIT LOGGING", flush=True)

    log_level = logging.DEBUG
    log_format = (
        "  %(asctime)-15s %(levelname)-8s %(name)-25s %(lineno)-5d | %(message)s"
    )

    logging.root.setLevel(log_level)

    stream = logging.StreamHandler(stream=sys.stdout)
    stream.setLevel(log_level)

    formatter = logging.Formatter(log_format)
    stream.setFormatter(formatter)

    logging.root.handlers = []
    logging.root.addHandler(stream)

    logging.getLogger("fiona").setLevel(logging.CRITICAL)
    logging.getLogger("matplotlib").setLevel(logging.CRITICAL)
    logging.getLogger("urllib3").setLevel(logging.CRITICAL)
    logging.getLogger("chardet").setLevel(logging.CRITICAL)
    logging.getLogger("trace").setLevel(logging.CRITICAL)


@app.route("/read_pop_raster", methods=["GET"])
def read_pop_raster() -> Response:
    if request.args.get("is_gva", False):
        raster_path = Path("/data/rasters/input/europe/eu_pop_4326.tif")
    else:
        raster_path = Path("/data/rasters/input/pop_4326.tif")

    return read_raster(raster_path, request.args)


@app.route("/read_friction_raster", methods=["GET"])
def read_friction_raster() -> Response:
    is_walking = request.args.get("is_walking") == "true"

    # TODO use 4326
    if is_walking:
        raster_path = Path("/data/rasters/input/friction_walk_proj_3857.tif")
    else:
        raster_path = Path("/data/rasters/input/friction_mixed_proj_3857.tif")

    return read_raster(raster_path, request.args)


def read_raster(raster_path: Path, request_args: MultiDict[str, str]) -> Response:
    from osgeo import gdal  # type: ignore[import-untyped]

    # get a temp file
    with tempfile.TemporaryDirectory() as tmpdirname:
        subset = Path(tmpdirname) / f"{raster_path.stem}_extent.tif"

        subset.parent.mkdir(parents=True, exist_ok=True)

        min_x_str = request_args.get("min_x")
        min_y_str = request_args.get("min_y")
        max_x_str = request_args.get("max_x")
        max_y_str = request_args.get("max_y")

        if not min_x_str or not min_y_str or not max_x_str or not max_y_str:
            raise ValueError(
                "All bounding box coordinates (min_x, min_y, max_x, max_y) must be provided"
            )

        min_x = float(min_x_str)
        min_y = float(min_y_str)
        max_x = float(max_x_str)
        max_y = float(max_y_str)

        dataset = gdal.Open(str(raster_path), gdal.GA_ReadOnly)

        rs: RasterStats = RasterStats.from_gdal_dataset(dataset)

        x_col_left = math.floor(rs.get_col_as_float(min_x))
        x_col_right = math.ceil(rs.get_col_as_float(max_x))
        y_row_top = math.floor(rs.get_row_as_float(max_y))
        y_row_bottom = math.ceil(rs.get_row_as_float(min_y))

        # log.info(f"Subset {x_col_left} {x_col_right} rows {y_row_top} {y_row_bottom}")

        # print(f"Subset {x_col_left} {x_col_right} rows {y_row_top} {y_row_bottom}")

        cmd_parts = [
            "gdal_translate",
            '-co "COMPRESS=LZW"',
            f'"{raster_path}"',
            f'"{subset}"',
            f"-srcwin {x_col_left} {y_row_top} {x_col_right - x_col_left + 1} {y_row_bottom - y_row_top + 1}",
        ]

        cmd = " ".join(cmd_parts)

        run_process_stream_output(cmd, cwd="/data/rasters/input")

        # shutil.copyfile(subset, "/data/rasters/last.tif")

        return send_from_directory(
            subset.parent, subset.name, mimetype="application/x-geotiff"
        )


class UpdateCatchmentRequest(TypedDict):
    jobId: str
    reqId: str
    boundaryGuidList: List[str]


@app.route("/update_catchments", methods=["POST"])
def update_catchments() -> Tuple[Response, int]:
    job_id = None
    req_id = None
    try:
        job_request: UpdateCatchmentRequest = cast(UpdateCatchmentRequest, request.json)
        job_id = job_request["jobId"]
        req_id = job_request["reqId"]
        boundary_guid_list = job_request["boundaryGuidList"]
        util_cfg = _get_gmt_db_info()
        raster_input_dir = Path("/data/rasters/input")
        pop_raster_4326 = raster_input_dir / "pop_4326.tif"
        # eu_pop_raster_4326 = raster_input_dir / "europe" / "eu_pop_4326.tif"

        # This is compiled in the image so no need to use cargo run (which may recompile)
        rust_cmd_parts = [
            "./calc_boundary_data",
            '--log-level "debug"',
            "calc-boundary-data",
            "--gmt-database-pg-conn",
            f'"{util_cfg.get_sql_alchemy_connection_string()}"',
            "--pop-raster",
            f'"{pop_raster_4326}"',
            # "--pop-raster",
            # f'"{eu_pop_raster_4326}"',
        ]

        for boundaryGuid in boundary_guid_list:
            rust_cmd_parts.append("--boundary-guid")
            rust_cmd_parts.append(f'"{boundaryGuid}"')

        rust_cmd = " ".join(rust_cmd_parts)

        run_process_stream_output(rust_cmd, cwd="/rust/target/release")
        log.info(f"update_catchments {rust_cmd} for JobId: {job_id}, reqId: {req_id}")

        logging.root.handlers[0].flush()

    except Exception as ex:
        print(
            f"update_catchments An exception for jobId: {job_id}, reqId: {req_id}!",
            flush=True,
        )
        print(ex, flush=True)
        return jsonify({"response": f"Error {ex}"}), 500

    return jsonify({"response": "update_catchments successful"}), 200


class ExportRequest(TypedDict):
    boundaryIds: List[str]
    gdb: bool
    excel: bool
    rew: bool
    boundariesSingle: bool


class TriggerExportRequest(TypedDict):
    jobId: str
    reqId: str
    request: ExportRequest
    filename: str
    userId: str  # Note: camelCase to match your JSON keys


@app.route("/trigger_export", methods=["POST"])
def trigger_export() -> Tuple[Response, int]:
    """
    This is the GDB export

    @param job_id - for tracking from where export was triggered
    @param req_id - for tracking from where export was triggered
    @param boundaryIds - for which boundaries export should be generated
    @param filename - where output should be saved (we use datetime and unique string in {userId} dir)
    @param userId

    From client=>node via submitDataExportRequest
    from node=>bull via handleTriggerDataExport
    From bull=>importer via dataExportProcess

    """
    job_id = ""
    req_id = ""
    try:
        # ids are cleaned in nodejs - this should have cleaning if importer would have open api
        # ['0b8e1f11-70dc-4d07-9e56-a3151064449d', '2f22a992-c134-41c9-8f46-0a17ac551384']
        job_request: TriggerExportRequest = cast(TriggerExportRequest, request.json)
        job_id = job_request["jobId"]
        req_id = job_request["reqId"]
        request_param = job_request["request"]
        boundary_guid_list = request_param["boundaryIds"]
        # should not have zip extention, is sub dir under export/[user id]/[export name]
        export_name = job_request["filename"]
        user_id = job_request["userId"]
        log.info("boundary_guid_list:" + ",".join(boundary_guid_list))
        log.info(f" filename: {export_name} user_id: {user_id}")

        # we want the gdb to have the same step as the zip
        if request_param["gdb"]:
            data_exporter.run_data_export(
                GeometryExportParams(
                    gmt_db=_get_gmt_db_info(),
                    boundary_guid_list=[uuid.UUID(b) for b in boundary_guid_list],
                    user_id=user_id,
                    export_name=export_name,
                )
            )
            log.debug(
                f"GDB Export is finished for jobId: {job_id}, reqId: {req_id}, filename: {export_name}"
            )
        if request_param["excel"]:
            # to not have 2 code paths, if we want 1 file per boundary, we do that here

            excel_params = ExportExcelParams(
                gmt_db=_get_gmt_db_info(),
                boundary_guid_list=[uuid.UUID(b) for b in boundary_guid_list],
                user_id=user_id,
                export_name=export_name,
                output_sub_path=None,
            )
            if request_param["boundariesSingle"]:
                run_excel_export_per_boundary(excel_params)
            else:
                run_excel_export(excel_params)

        if request_param["rew"]:
            run_excel_export_rew(
                RewExportExcelParams(
                    gmt_db=_get_gmt_db_info(),
                    boundary_guid_list=[uuid.UUID(b) for b in boundary_guid_list],
                    export_name=export_name,
                    user_id=user_id,
                )
            )

        create_export_zip(
            ServerSideExportParams(user_id=user_id, export_name=export_name)
        )

        return jsonify({"response": "trigger_export successful"}), 200
        # logging.root.handlers[0].flush()
    except Exception as ex:
        print(f"request.json {request.json}")
        return _handle_error("trigger_export", ex, job_id, req_id)


class StateExportRequest(TypedDict):
    jobId: str
    reqId: str
    stateCode: str
    stateGuid: str


@app.route("/run_state_export", methods=["POST"])
def call_run_state_export() -> Tuple[Response, int]:
    """ """
    job_id = ""
    req_id = ""

    try:
        job_request: StateExportRequest = cast(StateExportRequest, request.json)

        job_id = job_request["jobId"]
        req_id = job_request["reqId"]
        state_code = job_request["stateCode"]
        state_guid = job_request["stateGuid"]

        log.info(f"Generating state export for {state_code}")

        run_state_export(
            StateExportParams(
                gmt_db=_get_gmt_db_info(),
                state=BoundaryToExport(
                    global_id=uuid.UUID(state_guid), code=state_code
                ),
            )
        )
        log.debug(
            f"State Export is finished for jobId: {job_id}, reqId: {req_id}, state: {state_code}"
        )
        return jsonify({"response": "call_run_state_export successful"}), 200

    except Exception as ex:
        print(f"request.json {request.json}")
        return _handle_error("call_run_state_export", ex, job_id, req_id)


class DataCheckRequest(TypedDict):
    jobId: str
    reqId: str
    boundaryIds: List[str]


@app.route("/run_data_check", methods=["POST"])
def call_run_data_check() -> Tuple[Response, int]:
    """ """
    job_id = ""
    req_id = ""

    try:
        job_request = cast(DataCheckRequest, request.json)

        job_id = job_request["jobId"]
        req_id = job_request["reqId"]
        boundary_guid_list: List[str] = job_request["boundaryIds"]

        log.info(f"Running data checks on boundaries {boundary_guid_list}")

        status = run_data_check(
            DataCheckParams(
                gmt_db=_get_gmt_db_info(),
                boundary_guid_list=[
                    uuid.UUID(boundary_guid) for boundary_guid in boundary_guid_list
                ],
                # The front end sends all the parents, which we don't want to consider here
                # as that checks far too much
                limit_boundary_to_level=True,
            )
        )
        log.debug(
            f"Data check is finished for jobId: {job_id}, reqId: {req_id}, boundaries {boundary_guid_list}"
        )
        resp = {"status": status.model_dump(mode="json")}
        log.debug(pprint.pformat(resp))
        return jsonify(resp), 200

    except Exception as ex:
        print(f"request.json {request.json}")
        return _handle_error("call_run_data_check", ex, job_id, req_id)


def _get_gmt_db_info() -> GmtDbCredentials:
    return GmtDbCredentials(
        username=os.environ["DB_USER"],
        password_key="DB_PWD",
        port=int(os.environ["DB_PORT"]),
        hostname=os.environ["DB_HOST"],
        db_name=os.environ["DB_NAME"],
        pgpass_path_key="PGPASS_PATH",
    )


def _handle_error(
    method_name: str,
    ex: Exception,
    job_id: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Tuple[Response, int]:
    log.exception(f"{method_name} An exception!: {ex}")
    print(f"{method_name} An exception!", flush=True)
    print(ex, flush=True)
    return jsonify({"response": f"Error {ex}, jobId: {job_id}, reqId: {req_id}"}), 500


def produce_csv():
    import re
    import json
    import pandas as pd

    # Replace this with your actual raw string input
    raw_log_string = """
    ["Remove offline data [cf42a760-176b-4d65-ae14-65e575e7541e] start Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T08:14:00.756Z] App version: [2e378012]", "Remove offline data [cf42a760-176b-4d65-ae14-65e575e7541e] stop success Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T08:14:03.778Z] App version: [2e378012]", "User needs to choose primary name Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T08:58:51.425Z] App version: [2e378012]", "Merge clicked in choose primary name step in set. merge -- true -- 8245e0c3-b889-4fe2-b123-186682c49791 Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T08:58:52.128Z] App version: [2e378012]", "Split/merge wizard - finish merging chosen name [8245e0c3-b889-4fe2-b123-186682c49791] set part ids: 2d86e5c6-23b1-4683-8020-58ff9c32ad81, 77dc615e-2765-40cc-83ab-11c96d11f88f Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T08:58:53.705Z] App version: [2e378012]", "Split/merge wizard - Finish succeeded Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T08:58:58.265Z] App version: [2e378012]", "excludeSettlement clicked on Totsa with id 9f890fd1-eabf-4968-b5bc-0488c987025c Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T09:01:37.366Z] App version: [2e378012]", "excludeSettlement clicked on Jabar Takanawa with id 1ea33dad-d9dd-47eb-9ad8-e98e1b11746a Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T09:03:34.135Z] App version: [2e378012]", "excludeSettlement clicked on Dandalama Cikin Gari with id a87a133c-7db9-4252-8dff-e6cdff6a686e Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T09:04:00.775Z] App version: [2e378012]", "excludeSettlement clicked on Daurawa with id 53d6a6c9-0217-4477-8060-c64ae9677d76 Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T09:04:27.151Z] App version: [2e378012]", "Adding new settlement, opening settlement wizard Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T09:07:27.456Z] App version: [2e378012]", "Adding settlement point Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T09:07:41.537Z] App version: [2e378012]", "Location selected [8.4830394517134,12.155508530768174] Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T09:07:50.335Z] App version: [2e378012]", "save new settlement with an intersecting part, voronai parent is a626b071-4939-48fa-ba84-3e23d2315bbe Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T09:08:04.632Z] App version: [2e378012]", "Settlement wizard saving stop success Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T09:08:10.253Z] App version: [2e378012]", "User sync successful Username: [sabiusaleh894@gmail.com] Date: [2025-08-01T09:18:02.993Z] App version: [2e378012]"]
    """

    log_entries = json.loads(raw_log_string)
    parsed_data = []

    # Step 2: Extract fields from each log entry
    parsed_logs = []
    for loge in log_entries:
        action = re.match(r"^(.*?) Username:", loge)
        username = re.search(r"Username: \[(.*?)\]", loge)
        date = re.search(r"Date: \[(.*?)\]", loge)
        version = re.search(r"App version: \[(.*?)\]", loge)

        parsed_data.append({
            "Action": action.group(1),
            "Username": username.group(1),
            "Date": date.group(1),
            "App Version": version.group(1),
        })

        log.debug(f"Action? [{action.group(1)}] @ [{date.group(1)}]")

    # Convert to DataFrame and save as CSV
    df = pd.DataFrame(parsed_data)
    df.to_csv("/data/parsed_logs_2247.csv", index=False)

    print("CSV file 'parsed_logs.csv' created successfully.")



if True and __name__ == "__main__":
    """
    ./dev/eg/exec_importer.sh 
    python /src/api/flask_root.py 
    """
    debug_main()
