# params used in flask_root.py which is called by the node js server to delegate tasks to the importer container
# such as catchment calculation, creating gdb exports, and updating the csv/shapefile state zip exposed by the natview api

from functools import cached_property
from pathlib import Path
from typing import List, Optional
import uuid
from pydantic import BaseModel, Field

from importer.constants import GisFormats
from modules.params.gmt_credentials import GmtDbCredentials


class ServerSideExportBaseParams(BaseModel):
    export_base_path: Path = Field(
        description="base export dir", default=Path("/data/export")
    )

    user_id: str = Field(description="User id, used in output path for a unique one")

    export_name: str = Field(
        description="Used as sub directory under user_id, also will be name of the zip"
    )

    @cached_property
    def output_dir(self) -> Path:
        return self.export_base_path / self.user_id / self.export_name


class ServerSideExportParams(ServerSideExportBaseParams):
    @cached_property
    def temp_zip_path(self) -> Path:
        return (
            self.export_base_path / "tmp" / self.user_id / self.export_name
        ).with_suffix(".zip")

    @cached_property
    def zip_path(self) -> Path:
        return self.output_dir.with_suffix(".zip")


class GeometryExportParams(ServerSideExportBaseParams):
    gmt_db: GmtDbCredentials = Field(
        description="db connection params, generally will be the one currently used by the app"
    )

    boundary_guid_list: List[uuid.UUID] = Field(
        description="Which boundaries to include in the gdb; note these are operating level boundaries, eg. wards in NGA"
    )

    # description="Filename in the export, does not include path  /data/export/[userId]/[gdb_filename]"

    # stored in output dir
    @cached_property
    def gdb_path(self) -> Path:
        return self.output_dir / "Microplan.gdb"

    export_format: GisFormats = Field(
        description="Export format", default=GisFormats.FGDB
    )


class BoundaryToExport(BaseModel):
    """
    Can be any level
    Used to fetch the operating level of boundaries
    """

    global_id: uuid.UUID = Field(description="Guid")
    code: str = Field(description="Boundary code")  # , pattern=r"^[A-Z]{2}$")


class StateExportParams(BaseModel):
    gmt_db: GmtDbCredentials = Field(
        description="db connection params, generally will be the one currently used by the app"
    )

    export_base_path: Path = Field(
        description="base export dir", default=Path("/data/state_export")
    )

    staging_export_base_path: Path = Field(
        description="base export dir", default=Path("/data/state_export/staging")
    )

    csv_subdir: str = Field(default="csv")
    geom_subdir: str = Field(default="geom")

    @cached_property
    def csv_filename(self) -> str:
        return f"GMT_{self.state.code}_CSV.zip"

    @cached_property
    def geom_filename(self) -> str:
        return f"GMT_{self.state.code}_GEOM.zip"

    state: BoundaryToExport = Field(description="State to export")

    @cached_property
    def state_base_dir(self) -> Path:
        return self.export_base_path / self.state.code

    @cached_property
    def status_json_path(self) -> Path:
        return self.state_base_dir / "status.json"

    @cached_property
    def staging_base_dir(self) -> Path:
        return self.staging_export_base_path / self.state.code


class DataCheckParams(BaseModel):
    gmt_db: GmtDbCredentials = Field(
        description="db connection params, generally will be the one currently used by the app"
    )

    boundary_guid_list: List[uuid.UUID] = Field(
        description="Which boundaries to check.  Can be any level, will check surrounding area too"
    )

    limit_boundary_to_level: bool = Field(
        description="If true, will limit the boundary guid list to the operating level, meaning non level 3 boundaries in boundary_guid_list are effectively ignored"
    )

    sql_fixes_dir: Optional[Path] = Field(
        description="If defined, will produce an sql files in this directory that can be used to apply the fixes"
    )


class ExportExcelParams(ServerSideExportBaseParams):
    gmt_db: GmtDbCredentials = Field(
        description="db connection params, generally will be the one currently used by the app"
    )

    boundary_guid_list: List[uuid.UUID] = Field(
        description="Which boundaries to export.  Can be any level"
    )

    output_sub_path: Optional[Path] = Field(
        description=(
            "Partial sub dir to append to output dir.  e.g. <lga name>/<ward name>."
            "  Used only when doing 1 file per boundary"
        ),
        default=None,
    )

    # boundaries_single: bool = Field(
    #     description="If true, will only export boundaries 1 file per boundary.  False all is in the same file")

    @cached_property
    def excel_path(self) -> Path:
        if self.output_sub_path:
            return self.output_dir / self.output_sub_path / "Microplan.xlsx"
        else:
            return self.output_dir / "Microplan.xlsx"


class RewExportExcelParams(ServerSideExportBaseParams):
    gmt_db: GmtDbCredentials = Field(
        description="db connection params, generally will be the one currently used by the app"
    )

    boundary_guid_list: List[uuid.UUID] = Field(
        description="Which boundaries to export.  Can be any level.  Rew created for all operating level ones"
    )

    # will output to this dir / op level + 1 name / op level name / REW_[op level name]_[hf name].xlsx
    @cached_property
    def excel_base_path(self) -> Path:
        # can mix with the other excel export, so not adding rew sub dir
        return self.output_dir
