import contextlib
import logging
import textwrap

import importer.plugins.db_transforms
from importer.constants import YamlConfigConstants, TransformationParams
from importer.import_config import ImportConfig
from importer.util import ConfigException, DbTransformArguments, get_plugins
from lib import db_utils

log = logging.getLogger(__name__)
trace_log = logging.getLogger("trace." + __name__)


def run_db_transforms(import_config: ImportConfig, layer, table_name) -> str:
    """
    Runs database transforms.  These run after the data has gone through the
    in-memory / GeoPandas transforms and has been serialized to the database

    :return Markdown output
    """
    
    plugin_db_tranforms = get_plugins(importer.plugins.db_transforms)
    markdown_output = "# Database Transformations\n\n"

    staging_schema = import_config.util_cfg.STAGING_SCHEMA

    with contextlib.closing(db_utils.create_db_connection(import_config.util_cfg))as conn:

        before_row_count = db_utils.get_row_count(conn, staging_schema, table_name)

        db_transforms = layer.get(YamlConfigConstants.DB_TRANSFORMATIONS, [])

        # Apply an ordering, if provided.  Default to the transformations position in the YAML array
        for idx, transform in enumerate(db_transforms):

            if transform.get(TransformationParams.ORDER) is None:
                transform[TransformationParams.ORDER] = idx

        # Execute transforms in order
        for t in sorted(db_transforms, key=lambda k: k[TransformationParams.ORDER]):

            name = t.get(TransformationParams.TRANSFORM_NAME)

            markdown_output += f"1. {name}\n"

            if name.lower() in plugin_db_tranforms:
                output = plugin_db_tranforms[name.lower()].do_transform(
                    DbTransformArguments(
                    conn=conn,
                    postgis_table_name=table_name,
                    transform_config=t,
                    layer_config=layer,
                        staging_schema=staging_schema
                    )
                )

                if output and isinstance(output, str):
                    markdown_output += "\n" + textwrap.indent( output, " " * 4, lambda line: True) + "\n"
            else:
                raise ConfigException(f"Unknown db transform {name}")

        after_row_count = db_utils.get_row_count(conn, staging_schema, table_name)

    markdown_output += f"\nRow counts:\n* Before DB transformations: {before_row_count}\n* After DB Transformations: {after_row_count}\n\n"

    return markdown_output

