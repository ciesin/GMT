import logging
import shutil

from modules.params.flask_root_params import ServerSideExportParams

log = logging.getLogger(__name__)


def create_export_zip(params: ServerSideExportParams) -> None:
    params.temp_zip_path.parent.mkdir(exist_ok=True, parents=True)

    # 3. zip and delete initial file
    log.info(f"Zipping file: {str(params.temp_zip_path)}")

    shutil.make_archive(
        # zip extension is always appended
        str(params.temp_zip_path.with_suffix("")),
        # something like /data/export/tmp/601a15d6-9291-4eaa-8dfe-69dcd04c5c80/2024-05-16T08-26_f3b.gdb
        "zip",
        root_dir=str(
            params.output_dir
        ),  # something like "/data/export/601a15d6-9291-4eaa-8dfe-69dcd04c5c80"
        # base_dir=params.output_dir.name,  # something like "2024-05-16T08-26_f3b.gdb",
        # logger to see any errors / status for debugging
        logger=log,
        dry_run=False,
    )

    log.info(f"File is zipped: {str(params.temp_zip_path)} ")

    log.info(f"Moving {params.temp_zip_path} to {params.zip_path}")

    shutil.move(params.temp_zip_path, params.zip_path)
