generic_poi_layers = [
                      'fc_poi_church',
                     'fc_poi_market', 'fc_poi_mosque',
                      'fc_poi_school',
                      'fc_poi_water',

                      ]

boundary_layers = [
    "boundary_country",
    "boundary_states",
    "boundary_lgas",
    "boundary_wards",]

settlement_polygons = [
    "fe_builtup_areas",
    "fe_smlsettlement_areas",
    "fe_hamlet_areas",
]

hf = [
    "fc_poi_health_facilities_raw"
]

settlement_part = [
    "settlement_part",
]

name_corrections = [
    "settlement_name_corrections"
]

names = [
    #"fc_settlementpt",
    # we want to overwrite the ft_settlementpt so we import these after
    "fc_settlement_primary_names",
    #"fc_settlement_alternate_names",
    # making sure the associated settlement part has the same boundary_polygon guid
    "part_global_id_fix",

]


layers = boundary_layers + settlement_polygons + settlement_part + \
         hf + generic_poi_layers + names

# name corrections is not needed because geopode
# ensures that each settlement has 1 primary name
#layers = names


with open("/data/import.sh", "w") as f:

    # set -x is echo commands
    # set -e is to exit on error
    f.write("#!/bin/bash\nset -x\nset -e\n")

    for lyr in layers:

        # This is to fix the problem that the geopode settlements (HA/SSA/BUA) do not have the ward code
        # we want the ward code to be consistent with the names that are associated with them
        if lyr == "part_global_id_fix":
            f.write("""
PGPASSWORD="${DB_PWD}" psql --echo-all -v ON_ERROR_STOP=1 \
-h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" --dbname "${DB_NAME}" <<-EOSQL

WITH correct_boundaries AS
(
    SELECT p.global_id,
        p.version_id,
        n.boundary_polygon
    FROM settlement.name_latest n
        INNER JOIN settlement.part_latest p on
            p.global_id = n.settlement_part
    WHERE n.boundary_polygon != p.boundary_polygon
)
UPDATE settlement.part p
SET boundary_polygon = cb.boundary_polygon
FROM correct_boundaries cb
WHERE cb.global_id = p.global_id AND
    cb.version_id = p.version_id;

REFRESH MATERIALIZED VIEW settlement.part_latest;

EOSQL
""")
            continue

        cmd_args = [
    "/usr/gmt-venv/bin/python /src/importer/main.py",
    "--config /config_files/geopode_export/main.yml",
    "--config /config_files/docker_local_db.yml",
    #"--config /config_files/dev.yml",
    "--skip-pdf",
    f"--comment \"Grid3 layer {lyr}\"",
    f"--import-key {lyr}",
    "--username ${DB_ADMIN_USER}",
    "--password ${DB_ADMIN_PASSWORD}",

    #"--stage",
    "--import",
    "--use-db-copy",
    "--force",
            #"--verbose",
    ]

       
        s = ""
        for line in cmd_args:
            s += "  " + line + " \\\n"

        # remove last new line & continuation character
        # s = s[:-2] + "\n"

        f.write(f"""while true\ndo\n{s} && break\n  read -n 1 -s -r -p \"Press any key to continue\"\ndone\n""" )

        s = f"""mkdir -p /data/import_stage_reports/stage_output_{lyr}""".strip() + "\n"
        f.write(s)

        s = f"""cp -R /data/stage_output/* /data/import_stage_reports/stage_output_{lyr}""".strip() + "\n"

        f.write(s)

