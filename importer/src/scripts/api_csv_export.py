# Do a CSV by state export
import asyncio
from pathlib import Path

from importer.util import init_logging
from lib import file_utils
from natview_api_module.api_export import (
    export_to_schema,
    schema_to_csvs,
    table_to_markdown_doc,
)


async def amain():
    init_logging(False)
    export_dir = Path("/data/export/natview")

    # export_to_excel(export_dir)
    # return

    file_utils.remove_dir(export_dir, Path("/data/export"))

    export_dir.mkdir(parents=True, exist_ok=True)

    await export_to_schema()

    await schema_to_csvs(export_dir)

    await table_to_markdown_doc(export_dir)





if __name__ == '__main__':
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        # asyncio.run(amain(loop=loop))
        loop.run_until_complete(amain())
    except KeyboardInterrupt:
        pass