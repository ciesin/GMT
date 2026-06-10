import logging
import uuid
import sys
from pathlib import Path

from modules.db_checks.checks import run_data_check
from modules.excel_exporter.excel_export import run_excel_export_per_boundary
from modules.excel_exporter.excel_export_rew import run_excel_export_rew
from modules.params.flask_root_params import (
    RewExportExcelParams,
    DataCheckParams,
    ExportExcelParams,
)
from modules.params.gmt_credentials import GmtDbCredentials

log = logging.getLogger(__name__)


def debug_main() -> None:
    from api.flask_root import init_logging

    init_logging()

    test_db = GmtDbCredentials(
        port=5432,
        db_name="gmt_test",
        hostname="postgre-lan.ad.novel-t.ch",
        username="gmt_test",
        password_key="GMT_TEST_PASSWORD",
        pgpass_path_key="GMT_TEST_PGPASS_PATH",
    )

    local_db = GmtDbCredentials(
        port=5432,
        db_name="gmt",
        hostname="db",
        username="postgres",
        password_key="DB_PWD",
        pgpass_path_key="GMT_LOCAL_PGPASS_PATH",
    )

    prod_db = GmtDbCredentials(
        port=5432,
        db_name="gmt_prod",
        hostname="gmt-prod-db.dmz.novel-t.ch",
        username="gmt_prod",
        password_key="GMT_PROD_PASSWORD",
        pgpass_path_key="GMT_PROD_PGPASS_PATH",
    )

    """
--Getting all data inconsistency boundaries since the beginning
--over time might need a timestamp > in the where clause    
    WITH fm AS (SELECT message, position('surrounding' IN message) AS end_pos, length('Data check result: false for ') AS start_pos FROM master.logs 
WHERE message LIKE 'Data check result: false for %'
ORDER BY id DESC),
gt AS (
SELECT trim(UNNEST(string_to_array(
substring(message FROM start_pos+1 FOR end_pos- start_pos - 1), 
','
)))::uuid AS guid,
message FROM fm
)
SELECT DISTINCT gt.guid FROM gt
;
"""

    b_str = """
    c65debf2-1bf4-48c4-8a62-cc26cbad1e51
a8fbd2ec-4e11-452a-a1a5-8acf3fbe62ba
075a4959-9540-44fa-ba26-4fd59b90312e
d66c0f31-a10d-42b3-a776-2a30e6d1b299
dfe2cc01-0daa-4b70-ab97-44f6b7151eb7
ae382f0f-8d5a-4fbe-9063-4dddb3872845
2e88e0bc-b108-446c-85c4-30ae5c05a843
2c800091-8f23-4b44-9220-c734e27b7c2d
a62b9173-020f-419e-b876-948c9d560a26
3fa67a8f-5ecc-49d9-8c73-826f488d1243
01f510a1-f65a-4e6c-85ac-8b3a1ed1c9a9
7c351473-be6a-4625-b34e-2cdbd928463c
d85bf1a4-f0a5-46f8-b957-4220471b330c
fcbe638f-8ad8-4a5d-9182-15bedbeb29ed
27b745dd-73e2-4829-919f-6528947195cb
2e7d8180-4ec9-4729-8f90-80152cee87bb
ab7e0cea-861e-44de-8a25-d2eaee12b9f1
43eed0ec-a657-4faa-98b0-40347e95b6f8
69b6e1e3-84ad-4ac7-a27c-eff144a06d3c
cf9d534d-bb42-4c55-83a3-100ca5cbb782
7372adf8-afbe-4169-994c-d92c340e44e2
978b1a27-57a7-4426-8c92-8655b2c5f520
fad57688-297e-443e-affe-7ac685fec6c8
41ba8101-6f1c-45db-b3c4-500b1757a8e1
64882285-30aa-4c2c-8f21-6a84059b6847
90d4aca6-5242-48bd-ae78-aa051416a988
f5f6b533-fd03-40c0-8761-429c65785dfa
1602da16-c13b-4132-bd43-2018ae02ab0a
6e76752d-3b56-4456-b185-53fc87c799cf
b42ae0e1-db0f-4c37-b730-4396fd964a07
7db5f21c-a5c4-4ef8-8451-d67301fd101f
491550d2-1959-4a8d-8dfc-4066914fb2ab
ea27368e-d511-4523-a3da-a8b35a628844
0f576b4a-d89f-48a1-96c2-b09765af52ed
cdb0cca7-890f-40dc-8259-4403b00a5a1d
86d3c17e-24b6-434e-91ef-1fad7cfdd6b1
5e1ab4d2-2664-4d89-afe0-7216612218dc
589dfc91-4aff-4d36-a994-1fb84284f575
6449514c-f138-4f08-aa77-2d3595c70f69
c67de884-480c-4b73-94b0-9e2af13ea17b
d4a22e18-378e-4047-9855-71681e8b59d2
5b815014-032e-4d6f-9792-c28cda628c07
2195023a-afb9-4c1c-980d-2b9d6b6e3caf
f048a5ea-3cdd-4a54-a4ca-8ea5872b2fed
9146ae2b-d2d7-4141-ae96-125877e3d0bc
a2d991f2-44ae-4d5f-8f60-346a729e970d
0c86a8c7-089c-4d02-aa92-767747ef6198
f1db3274-3a5e-4d14-b2f4-99ecad156b78
ababfe81-bfda-4f62-8f42-05fb290446d7
452c5412-f2da-4328-8d65-3523ed5c9a95
bd6df2ef-0109-4ffc-b3dd-56fdb3f87269
063aa281-1142-491d-8f67-f408e79f9fff
04cc8b44-3b69-4d92-aa76-a68822910a60
ac6bfc9d-4dd5-47b6-b830-f8b877d5f8c9
36d86872-cf4a-4b7a-b878-651da760e517
cd707141-b4d6-40b6-a0d0-ec47ab41df4c
25c117a5-9b49-436d-b940-ce109635e9ab
ce97e062-12e3-4b2b-bce4-d76f820c2b60
6051acf2-a0c2-4a79-ae6b-2ee9667ab3cd
3230d45d-3040-4079-aa42-97570d13c8a3
77815c69-c4a4-474f-a405-6a68f1c19cb9
c0250a4e-4d94-4f2c-ae1b-350619decd66
77eeba60-94f1-4266-b945-cc74e86aa70f
10443a02-6a22-46f2-b7c3-da755aee98e7
541bb54a-e936-4207-9936-151318033c52
1ff2d619-a4e0-4f83-aa7f-8d524b2c287b
c1fc59c8-d87c-4d13-84f6-1625c1574d4c
20fad6b4-64ca-428f-9a02-fb390f64a383
421ca7ff-9ecc-4a98-838a-3cdffb33fda4
d7285927-397b-4cb4-b4f9-b8172ccc2825
8f707b50-a722-4d03-b2fb-0acb338deb09
651aac78-15c5-4082-8b74-e34cac99e450
4bd5c1bf-bf5e-431d-88a8-eba23d10a779
ea583ee4-28c3-4466-8201-290f0467a26b
c738268e-2de0-4d35-b5d7-86c2c10cf2f0
95c60963-4687-4b42-bd87-8376045746f1
aeebfec2-9400-4cc2-a946-4e693bdc294c
bae0b7c5-9ece-4563-b4aa-824b02d8773f
da62b586-163e-42db-b3d5-b870568ea882
3e5b1885-c828-4366-a354-f31b0eeb32bd
ede2dfbd-4431-46fd-a8ff-b8bcb396056f
0787cffd-80a3-4ec0-bcc8-be304e0198fd
7e151deb-948f-4e5f-bfb8-94398d98a605
af728ae5-980f-4b29-b8c4-423a337ce0e9
8c5c328a-0f76-4a6b-8ebd-e68ec4bbe9d6
82b29976-12af-4175-8e39-014237c9a59c
6d017030-2667-4b1f-9b39-cb8a61a70828
bab0c74e-f02f-4608-9afa-b4e23bed2f23
e2b3deab-4c24-4607-8a19-9df1e9c87cfb
0f7c150f-c19f-4118-94fb-9d6ee688545c
b04d5e5b-3640-474e-b124-c6a0f2f94362
623cb400-12b9-438f-96cd-536b6617a123
7acd36d4-08fb-4625-8175-72b2301f7fc3
99234eea-9851-4088-ba99-495ff992410a
823c52b8-fa8a-4d4b-9c90-7a9f42c517d8
250e22a0-3cd6-444d-bb6f-4b57493960fe
5700e0d5-0ff8-4e40-b79a-737fb97257fb
ab3587c6-8e42-4d2b-a71b-fe2314770070
6e28de1d-696f-4549-983d-411f0a969645
7834f721-bf11-4610-89cc-74e3ca006cb9
59f192a5-52be-4ac5-a468-112a8d99f96c
47a724fd-1465-4ff1-b59b-fe0e494c126d
2d49e2bf-e4f8-44d4-a2b9-fef1d87a0e39
20c124b8-6f2e-49ba-9572-ed7b263c1b83
ff5e0738-a9e9-45f7-9bbb-5e01608fbcaf
cbc390f5-3619-4f75-9043-1fe73bf1afd5
8c0e7d30-9e32-441f-baa2-6035cf0cadbf
3e2d1bde-f52f-4b77-9111-2f7df00a6807
2d05794c-1282-4c04-b27d-812b174aac61
34713bdf-e256-4472-b5bc-71c4f448b43e
    """

#     b_str = """
#     3e5b1885-c828-4366-a354-f31b0eeb32bd
# 43eed0ec-a657-4faa-98b0-40347e95b6f8
# 7c351473-be6a-4625-b34e-2cdbd928463c
# 7db5f21c-a5c4-4ef8-8451-d67301fd101f
# 823c52b8-fa8a-4d4b-9c90-7a9f42c517d8
# a2d991f2-44ae-4d5f-8f60-346a729e970d
# cdb0cca7-890f-40dc-8259-4403b00a5a1d
# cf9d534d-bb42-4c55-83a3-100ca5cbb782
# """
#
#     b_str = """
#     823c52b8-fa8a-4d4b-9c90-7a9f42c517d8
#     """

    b_set = set()
    for s in b_str.split("\n"):
        g_str = s.strip()

        if not g_str:
            continue

        b_set.add(uuid.UUID(g_str))

    b_list = list(b_set)

    db_conns = [prod_db, test_db]

    # just to use the vars
    log.info(f"Db con len {len(db_conns)} {len(b_list)} ")

    if False:
        produce_csv()
        sys.exit(0)

    if True:
        run_data_check(
            DataCheckParams(
                # gmt_db= local_db,
                # gmt_db=test_db,
                gmt_db=local_db,
                boundary_guid_list=b_list,
                # kano
                #boundary_guid_list=[uuid.UUID("4f4bd140-a2c6-4b0d-a94b-44d2332cf512")],


                # surrounding_boundary_guid_list=[uuid.UUID(b) for b in raw_s_list],
                limit_boundary_to_level=True,
                # boundary_guid_list=[uuid.UUID(boundary_guid)],
                sql_fixes_dir=Path("/data/fixes")
            )
        )
        sys.exit(0)

    # filename = "2025-05-12T07-53_f30.gdb"
    export_name = "test-export"
    user_id = "test-export-user"
    boundary_guid_list = [
        # shagogo
        uuid.UUID("fc887bd8-5847-4c09-be89-fb4c5e9498a4"),
        # Panshekaraa
        uuid.UUID("7e151deb-948f-4e5f-bfb8-94398d98a605"),
        # jahun lga
        # uuid.UUID("fced3865-adc3-4605-91f3-290054e1cd10"),
    ]
    run_excel_export_rew(
        RewExportExcelParams(
            gmt_db=local_db,
            boundary_guid_list=boundary_guid_list,
            export_name=export_name,
            user_id=user_id,
        )
    )
    run_excel_export_per_boundary(
        ExportExcelParams(
            gmt_db=local_db,
            boundary_guid_list=boundary_guid_list,
            export_name=export_name,
            user_id=user_id,
        )
    )

    # create_export_zip(ServerSideExportParams(
    #              zip_output_filename=zip_output_filename,
    #              user_id=user_id,
    # ))

    # boundary_guid_list = [uuid.UUID('2db07704-a4a0-4682-990e-c018d2a0d6df')]
    # run_data_check(
    #     DataCheckParams(
    #         #gmt_db= local_db,
    #         #gmt_db=test_db,
    #         gmt_db=local_db,
    #         boundary_guid_list=[uuid.UUID("228ee864-750a-408f-bdc3-e8b7a5ed5027"), uuid.UUID("091fd87a-d929-4433-9be5-3c5c8c8d3881")],
    #         surrounding_boundary_guid_list=[uuid.UUID(b) for b in raw_b_list],
    #         limit_boundary_to_level=True
    #         #boundary_guid_list=[uuid.UUID(boundary_guid)],
    #     )
    # )

    # run_state_export(
    #     StateExportParams(
    #         gmt_db=local_db,
    #         # state=StateBoundary(code="KD", global_id=uuid.UUID('aa13d807-45e2-4ba8-96ce-371126023935'))
    #         state=StateBoundary(
    #             code="KN", global_id=uuid.UUID("4f4bd140-a2c6-4b0d-a94b-44d2332cf512")
    #         ),
    #     )
    # )

    sys.exit(0)

    # filename = "2025-05-12T07-53_f30.gdb"
    # user_id = "a7e4f28c-f2e2-4f0e-a3b8-fc90461e216b"
    # boundary_guid_list = ["83dd81a5-fb92-47f3-bb34-95959f9ca8d7"]
    # # data_exporter.run_data_export(
    # #     GeometryExportParams(
    # #         gmt_db=_get_gmt_db_info(),
    # #         boundary_guid_list=[uuid.UUID(b) for b in boundary_guid_list],
    # #         filename=filename,
    # #         user_id=user_id,
    # #     )
    # # )
    #
    # run_state_export(
    #     StateExportParams(
    #         gmt_db=_get_gmt_db_info(),
    #         # state=StateBoundary(code="KD", global_id=uuid.UUID('aa13d807-45e2-4ba8-96ce-371126023935'))
    #         state=StateBoundary(
    #             code="KN", global_id=uuid.UUID("4f4bd140-a2c6-4b0d-a94b-44d2332cf512")
    #         ),
    #     )
    # )


def produce_csv():
    import re
    import json
    import pandas as pd

    # Replace this with your actual raw string input
    raw_log_string = """
    ["Remove offline data [fc887bd8-5847-4c09-be89-fb4c5e9498a4] start Username: [eg@novel-t.ch] Date: [2025-07-30T14:02:00.396Z] App version: [2e378012]", "Remove offline data [fc887bd8-5847-4c09-be89-fb4c5e9498a4] stop success Username: [eg@novel-t.ch] Date: [2025-07-30T14:02:11.072Z] App version: [2e378012]", "Remove offline data [ce97e062-12e3-4b2b-bce4-d76f820c2b60] start Username: [eg@novel-t.ch] Date: [2025-07-30T14:02:45.775Z] App version: [2e378012]", "Remove offline data [ce97e062-12e3-4b2b-bce4-d76f820c2b60] stop success Username: [eg@novel-t.ch] Date: [2025-07-30T14:02:56.148Z] App version: [2e378012]", "Remove offline data [fc887bd8-5847-4c09-be89-fb4c5e9498a4] start Username: [eg@novel-t.ch] Date: [2025-08-05T09:48:17.625Z] App version: [54de49f8]", "Remove offline data [fc887bd8-5847-4c09-be89-fb4c5e9498a4] stop success Username: [eg@novel-t.ch] Date: [2025-08-05T09:48:20.044Z] App version: [54de49f8]", "Take Offline Start for [dfe2cc01-0daa-4b70-ab97-44f6b7151eb7] Username: [eg@novel-t.ch] Date: [2025-08-05T09:48:27.580Z] App version: [54de49f8]", "Take Offline Success for [dfe2cc01-0daa-4b70-ab97-44f6b7151eb7] Username: [eg@novel-t.ch] Date: [2025-08-05T09:50:44.301Z] App version: [54de49f8]", "Take Offline Start for [f1db3274-3a5e-4d14-b2f4-99ecad156b78] Username: [eg@novel-t.ch] Date: [2025-08-05T09:50:54.406Z] App version: [54de49f8]", "Take Offline Success for [f1db3274-3a5e-4d14-b2f4-99ecad156b78] Username: [eg@novel-t.ch] Date: [2025-08-05T09:52:33.096Z] App version: [54de49f8]", "Take Offline Start for [d85bf1a4-f0a5-46f8-b957-4220471b330c] Username: [eg@novel-t.ch] Date: [2025-08-05T09:53:09.836Z] App version: [54de49f8]", "Take Offline Success for [d85bf1a4-f0a5-46f8-b957-4220471b330c] Username: [eg@novel-t.ch] Date: [2025-08-05T09:55:22.232Z] App version: [54de49f8]", "User sync successful Username: [eg@novel-t.ch] Date: [2025-08-05T10:03:05.931Z] App version: [54de49f8]"]
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

        log.debug(f"Action? [{action.group(1)}]")

    # Convert to DataFrame and save as CSV
    df = pd.DataFrame(parsed_data)
    df.to_csv("/data/parsed_logs.csv", index=False)

    print("CSV file 'parsed_logs.csv' created successfully.")
