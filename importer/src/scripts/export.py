from pathlib import Path
import export_module.indicator_constants as ic
from export_module.db_checks import db_checks
from export_module.db_export import export_to_schema
from export_module.excel import export_to_excel
from export_module.gdb import export_db_geom_to_files



def main():
    export_dir = Path("/data/export/indicators")
    
    # export_to_excel(export_dir)
    # return 

    if False:
        db_checks()
        return

    export_to_schema()

    db_checks()

    export_db_geom_to_files(export_dir)

    # pip install openpyxl
    export_to_excel(export_dir)

if __name__ == "__main__":
    main()
