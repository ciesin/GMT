import asyncio
import logging
import shlex
import shutil
from typing import List

from pydantic import BaseModel

from importer.constants import GisFormats
from lib.async_utils import run_command
from modules.params.export_schema import SCHEMA_EXPORT, SCHEMA_PREFIX
from modules.params.flask_root_params import GeometryExportParams

from .data_prep import (
    Boundary,
    data_prep_main,
)

# This is the class that makes the GDB export from the UI
# not to be confused with the pilot pre/post GDB export done in
# importer/src/scripts/export_module/db_export.py

log = logging.getLogger(__name__)


class LayerExportInfo(BaseModel):
    src_schema: str
    src_table: str
    layer_name: str
    geometry_type: str


def run_data_export(params: GeometryExportParams) -> None:
    return asyncio.run(data_export(params))


async def data_export(params: GeometryExportParams) -> None:
    """
    Main entry point

    1. first query db and find out what layers with what filters have to be exported
    2. close db connection and run ogr commands
    3. use a directory unique to the user but outside the directory being zipped because of the issue
    4. not deleting the raw files because for full NGA the zip file failed so this would be helpful in this
    """

    if params.gdb_path.exists():
        shutil.rmtree(params.gdb_path)

    params.gdb_path.parent.mkdir(exist_ok=True, parents=True)

    log.info(f"output_file_path: {params.gdb_path}")

    boundaries = await data_prep_main(params)

    log.info(f"Exporting {len(boundaries)} boundaries {boundaries[0]}")

    # 1. first query db and find out what layers with what filters have to be exported
    # export_layers_info = _get_export_layers_list()

    # 2. close db connection and run ogr commands
    await _run_data_export(params, boundaries)

    # because of https://github.com/novelt/GMT/issues/2666
    # we'll output to a zip in another location then rename

    # make_archive adds the suffix zip
    # use a directory unique to the user but outside the directory being zipped because of the issue

    # not deleting the raw files because for full NGA the zip file failed so this would be helpful in this
    # scenario - also we allow 1 export per user so there shouldn't be too much data until we are in the
    # national scale
    # shutil.rmtree(str(output_file_path))


async def _run_data_export(
    params: GeometryExportParams, boundaries: List[Boundary]
) -> None:
    """
    Form ogr command to append file after each layer export
    """

    for i, boundary in enumerate(boundaries):
        # ogr needs this command to append instead of override data in multiple boundaries case
        additional_command_params = []
        if i > 0:
            additional_command_params.append("-append")

        export_list: List[LayerExportInfo] = [
            LayerExportInfo(
                src_schema=SCHEMA_EXPORT,
                src_table=boundary.partition_name(
                    SCHEMA_PREFIX.EXPORT_SN, False, False
                ),
                layer_name="Settlement_Name",
                geometry_type="POINT",
            ),
            LayerExportInfo(
                src_schema=SCHEMA_EXPORT,
                src_table=boundary.partition_name(
                    SCHEMA_PREFIX.EXPORT_SN_MOBILE, False, False
                ),
                layer_name="Settlements_Mobile_Strategy",
                geometry_type="POINT",
            ),
            LayerExportInfo(
                src_schema=SCHEMA_EXPORT,
                src_table=boundary.partition_name(
                    SCHEMA_PREFIX.EXPORT_SP, False, False
                ),
                layer_name="Settlement_Extent",
                geometry_type="MULTIPOLYGON",
            ),
            LayerExportInfo(
                src_schema=SCHEMA_EXPORT,
                src_table=boundary.partition_name(
                    SCHEMA_PREFIX.EXPORT_FIXED_POST, False, False
                ),
                layer_name="Fixed_Post",
                geometry_type="POINT",
            ),
            LayerExportInfo(
                src_schema=SCHEMA_EXPORT,
                src_table=boundary.partition_name(
                    SCHEMA_PREFIX.EXPORT_OUTREACH, False, False
                ),
                layer_name="Outreach",
                geometry_type="POINT",
            ),
            LayerExportInfo(
                src_schema=SCHEMA_EXPORT,
                src_table=boundary.partition_name(
                    SCHEMA_PREFIX.EXPORT_B3_EDITED, False, False
                ),
                layer_name="Edited_Ward",
                geometry_type="MULTIPOLYGON",
            ),
            LayerExportInfo(
                src_schema=SCHEMA_EXPORT,
                src_table=boundary.partition_name(
                    SCHEMA_PREFIX.EXPORT_B3, False, False
                ),
                layer_name="Ward",
                geometry_type="MULTIPOLYGON",
            ),
            LayerExportInfo(
                src_schema=SCHEMA_EXPORT,
                src_table=boundary.partition_name(
                    SCHEMA_PREFIX.EXPORT_FP_CATCH, False, False
                ),
                layer_name="Fixed_Post_Catchment",
                geometry_type="MULTIPOLYGON",
            ),
            LayerExportInfo(
                src_schema=SCHEMA_EXPORT,
                src_table=boundary.partition_name(
                    SCHEMA_PREFIX.EXPORT_OUT_CATCH, False, False
                ),
                layer_name="Outreach_Catchment",
                geometry_type="MULTIPOLYGON",
            ),
        ]

        if i == 0:
            export_list.append(
                LayerExportInfo(
                    src_schema=SCHEMA_EXPORT,
                    src_table=boundary.partition_name(
                        SCHEMA_PREFIX.EXPORT_B2, False, False
                    ),
                    layer_name="LGA",
                    geometry_type="MULTIPOLYGON",
                )
            )
            export_list.append(
                LayerExportInfo(
                    src_schema=SCHEMA_EXPORT,
                    src_table=boundary.partition_name(
                        SCHEMA_PREFIX.EXPORT_B1, False, False
                    ),
                    layer_name="State",
                    geometry_type="MULTIPOLYGON",
                ),
            )

        for layerInfo in export_list:
            await _export_layers(
                params=params,
                export_layer_info=layerInfo,
                additional_command_params=additional_command_params,
            )


async def _export_layers(
    params: GeometryExportParams,
    export_layer_info: LayerExportInfo,
    additional_command_params: List[str],
) -> None:
    """
    For ogr2ogr command to export layers - all comments that are not deleted are from
    GeoPode and could be useful if this module will grow in the future
    """
    # //If append is not supported for file type, we create a seperate file per layer that will be merged later
    # if (!exportInfo.ExportFormat.IsSingleFile)
    #    outputPath = Path.Combine(outputPath, outputLayerName + exportInfo.ExportFormat.FileExtension);
    # else
    #   outputPath = Path.Combine(outputPath, exportInfo.OutputFilename);

    cmd_line_parts = []

    if params.export_format == GisFormats.FGDB:
        cmd_line_parts.extend(
            [
                "--config FGDB_BULK_LOAD YES",
                # (mpt sure if that is gdb specific...) when several wards are exported separatelly one may contain fields that other does not have or ogr2 may ser nullable field as not nullable
                "-forceNullable",
                f"-f {GisFormats.FGDB}",
                # Integer64 is not supported at least now by this format (conversion is only to supress warning message)
                "-mapFieldType Integer64=Real,StringList=String,RealList=String",
            ]
        )
    else:
        # in case other file formats support Integer64
        cmd_line_parts.append("-mapFieldType StringList=String")

    # logic from geopode for easier future
    # elif export_format == EXPORT_FORMAT_CSV:
    #     cmd_line_parts.extend([
    #         '-lco WRITE_BOM=YES',
    #     ])
    # -f
    # for multilayer export (file is deleted in the beginning and exists only if one layer was already exported)
    if params.gdb_path.exists():
        log.info("File already exists updating layer")
        cmd_line_parts.extend(["-update"])

    if additional_command_params:
        cmd_line_parts.extend(additional_command_params)

    cmd_line_parts.extend(
        [
            "-gt 66536",  # how many features per transaction
            "-sql",
            shlex.quote(
                f"Select * from {export_layer_info.src_schema}.{export_layer_info.src_table}"
            ),
            shlex.quote(str(params.gdb_path)),
            # already quoted
            params.gmt_db.gdal_conn_str,
        ]
    )
    cmd_line_parts.append(f'-nln "{export_layer_info.layer_name}"')

    # none also has to be set
    cmd_line_parts.append(f'-nlt "{export_layer_info.geometry_type}"')

    if export_layer_info.geometry_type is not None:
        reproject_to_srid = 4326
        if reproject_to_srid is not None:
            cmd_line_parts.append("-a_srs EPSG:%s" % (str(reproject_to_srid).strip()))

    cmd_line_parts.extend(["-progress"])

    ogr_cmd = " ".join(cmd_line_parts)
    log.info(f"ogrCmd: {ogr_cmd}")
    # my_env = {}
    # my_env["GDAL_DATA"] = Config.GDAL_DATA
    # my_env["PGCLIENTENCODING"] = db_encoding # Set to fix some name imports

    pg_passfile = params.gmt_db.write_pg_pass()

    return_code = await run_command(
        "ogr2ogr",
        cmd_line_parts,
        {
            "PGPASSFILE": f"{pg_passfile}",
        },
    )

    if return_code != 0:
        raise Exception(f"ogr2ogr failed with return code {return_code}")
