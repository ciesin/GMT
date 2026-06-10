from pathlib import Path
import shlex

from psycopg.sql import SQL, Literal, Identifier

from importer.constants import GisFormats
from lib import file_utils
from lib.async_utils import run_command
from modules.exporter_shared.gmt_db_objects import ExportDbNames

from modules.params.flask_root_params import StateExportParams


async def export_gdb(params: StateExportParams) -> None:
    pg_passfile = params.gmt_db.write_pg_pass()

    output_file_path = (
        params.staging_base_dir / params.geom_subdir / f"GMT_{params.state.code}.gdb"
    )

    file_utils.remove_dir(output_file_path, params.export_base_path)

    output_file_path.parent.mkdir(parents=True, exist_ok=True)

    await export_fp(params, output_file_path, pg_passfile)
    await export_outreach(params, output_file_path, pg_passfile)
    await export_catchments(params, output_file_path, pg_passfile)
    await export_wards(params, output_file_path, pg_passfile)
    await export_settlements(params, output_file_path, pg_passfile)


async def export_fp(
    params: StateExportParams, output_file_path: Path, pg_passfile: Path
) -> None:
    cmd_line_parts = [
        "--config FGDB_BULK_LOAD YES",
        "--config PG_USE_COPY YES",
        f"-f {GisFormats.FGDB}",
        "-gt 66536",  # how many features per transaction
        "-nln 'Facility_Locations'",
        "-nlt POINT",
        "-sql",
        shlex.quote(
            SQL("""
SELECT
    src.fp_global_id,
    src.name,
    src.state_name,
    src.lga_name,
    src.ward_name,
    src.level_of_care,
    src.mp_status,
    src.ownership,
    src.lat_y,
    src.lon_x,
    src.export_time_gmt as "last_updated_gmt",
    src.geom
FROM {hf} src
""")
            .format(hf=StateExportDbNames.FP.as_identifier())
            .as_string()
        ),
        shlex.quote(str(output_file_path)),
        # already quoted
        params.gmt_db.gdal_conn_str,
    ]
    return_code = await run_command(
        "ogr2ogr",
        cmd_line_parts,
        {
            "PGPASSFILE": f"{pg_passfile}",
        },
        log_command=False,
    )

    if return_code != 0:
        raise Exception(f"ogr2ogr failed with return code {return_code}")


async def export_outreach(
    params: StateExportParams, output_file_path: Path, pg_passfile: Path
) -> None:
    cmd_line_parts = [
        "--config FGDB_BULK_LOAD YES",
        "--config PG_USE_COPY YES",
        f"-f {GisFormats.FGDB}",
        "-gt 66536",  # how many features per transaction
        "-nln 'Outreach_Locations'",
        "-update",
        "-nlt POINT",
        "-sql",
        shlex.quote(
            SQL("""
SELECT
    src.outreach_global_id,
    src.name,
    src.state_name,
    src.lga_name,
    src.ward_name,
    
    src.fixed_post_parent_global_id,
    
    src.lat_y,
    src.lon_x,
    src.export_time_gmt as "last_updated_gmt",
    src.geom
FROM {hf} src
""")
            .format(hf=StateExportDbNames.OUTREACH.as_identifier())
            .as_string()
        ),
        shlex.quote(str(output_file_path)),
        # already quoted
        params.gmt_db.gdal_conn_str,
    ]
    return_code = await run_command(
        "ogr2ogr",
        cmd_line_parts,
        {
            "PGPASSFILE": f"{pg_passfile}",
        },
        log_command=False,
    )

    if return_code != 0:
        raise Exception(f"ogr2ogr failed with return code {return_code}")


async def export_catchments(
    params: StateExportParams, output_file_path: Path, pg_passfile: Path
):
    cmd_line_parts = [
        "--config FGDB_BULK_LOAD YES",
        "--config PG_USE_COPY YES",
        f"-f {GisFormats.FGDB}",
        "-gt 66536",  # how many features per transaction
        "-nln 'Catchment_Areas'",
        "-update",
        "-nlt POLYGON",
        "-sql",
        shlex.quote(
            SQL("""
    SELECT
        src.hf_global_id as facility_id,
        src.hf_name,
        src.hf_state_name as state_name,
        src.hf_lga_name as lga_name,
        src.hf_ward_name as ward_name,
        src.strategy_type,
        
        src.est_pop,
        src.est_gis_pop,
        src.gis_pop,
        
        src.export_time_gmt as "last_updated_gmt",
        src.geom
    FROM {cp} src
    """)
            .format(cp=StateExportDbNames.CP.as_identifier())
            .as_string()
        ),
        shlex.quote(str(output_file_path)),
        # already quoted
        params.gmt_db.gdal_conn_str,
    ]
    return_code = await run_command(
        "ogr2ogr",
        cmd_line_parts,
        {
            "PGPASSFILE": f"{pg_passfile}",
        },
        log_command=False,
    )

    if return_code != 0:
        raise Exception(f"ogr2ogr failed with return code {return_code}")


async def export_wards(
    params: StateExportParams, output_file_path: Path, pg_passfile: Path
):
    cmd_line_parts = [
        "--config FGDB_BULK_LOAD YES",
        "--config PG_USE_COPY YES",
        f"-f {GisFormats.FGDB}",
        "-gt 66536",  # how many features per transaction
        "-nln 'Ward_Boundaries'",
        "-update",
        "-nlt MULTIPOLYGON",
        "-sql",
        shlex.quote(
            SQL("""
        SELECT
            b3.global_id as ward_id,
            b3.name as ward_name,
            b2.name as lga_name,
            b1.name as state_name,
            b3.computed_pop as gis_pop,
            now() at time zone 'utc' as last_updated_gmt,
            b3.geom
        FROM {boundary} b3
        INNER JOIN {boundary} b2 ON b3.boundary_polygon = b2.global_id
        INNER JOIN {boundary} b1 ON b2.boundary_polygon = b1.global_id
        WHERE b2.boundary_polygon = {state_guid}
        """)
            .format(
                boundary=Identifier("boundary", "polygon_latest"),
                state_guid=Literal(params.state.global_id),
            )
            .as_string()
        ),
        shlex.quote(str(output_file_path)),
        # already quoted
        params.gmt_db.gdal_conn_str,
    ]
    return_code = await run_command(
        "ogr2ogr",
        cmd_line_parts,
        {
            "PGPASSFILE": f"{pg_passfile}",
        },
        log_command=False,
    )

    if return_code != 0:
        raise Exception(f"ogr2ogr failed with return code {return_code}")


async def export_settlements(
    params: StateExportParams, output_file_path: Path, pg_passfile: Path
) -> None:
    cmd_line_parts = [
        "--config FGDB_BULK_LOAD YES",
        "--config PG_USE_COPY YES",
        f"-f {GisFormats.FGDB}",
        "-gt 66536",  # how many features per transaction
        "-nln 'Settlement'",
        "-update",
        "-nlt MULTIPOLYGON",
        "-sql",
        shlex.quote(
            SQL("""
            SELECT
                s.global_id as settlement_id,
                s.name,
                s.state_name,
                s.lga_name,
                s.ward_name,
                s.type as settlement_type,
                s.estimated_pop,
                s.computed_pop,
                s.lat_y,
                s.lon_x,
                s.export_time_gmt as "last_updated_gmt",
                s.geom
            FROM {set} s            
            """)
            .format(
                set=StateExportDbNames.SET.as_identifier(),
                state_guid=Literal(params.state.global_id),
            )
            .as_string()
        ),
        shlex.quote(str(output_file_path)),
        # already quoted
        params.gmt_db.gdal_conn_str,
    ]
    return_code = await run_command(
        "ogr2ogr",
        cmd_line_parts,
        {
            "PGPASSFILE": f"{pg_passfile}",
        },
        log_command=False,
    )

    if return_code != 0:
        raise Exception(f"ogr2ogr failed with return code {return_code}")
