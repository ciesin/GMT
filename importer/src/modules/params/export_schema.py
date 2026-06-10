from enum import StrEnum


SCHEMA_EXPORT = "export_web"
TABLE_COMMON_FIELDS = "common_fields"
SURROUNDING = "surrounding"


class SCHEMA_PREFIX(StrEnum):
    # These are also schema names; the tables/views in them also contain it as a prefix followed by the boundary partition id
    CI = "ri_catchment_item"
    SN = "settlement_name"
    SP = "settlement_part"
    HF = "health_facility_point"

    # created for export, in SCHEMA_EXPORT schema
    EXPORT_SN = f"{SCHEMA_EXPORT}_settlement_name"
    EXPORT_SN_MOBILE = f"{SCHEMA_EXPORT}_settlement_name_mobile"
    EXPORT_SP = f"{SCHEMA_EXPORT}_settlement_extent"
    EXPORT_FIXED_POST = f"{SCHEMA_EXPORT}_fixed_post"
    EXPORT_OUTREACH = f"{SCHEMA_EXPORT}_outreach"
    EXPORT_FP_CATCH = f"{SCHEMA_EXPORT}_fixed_post_catchment"
    EXPORT_OUT_CATCH = f"{SCHEMA_EXPORT}_outreach_catchment"

    EXPORT_B3_EDITED = f"{SCHEMA_EXPORT}_edited_ward"
    EXPORT_B3 = f"{SCHEMA_EXPORT}_ward"
    EXPORT_B2 = f"{SCHEMA_EXPORT}_lga"
    EXPORT_B1 = f"{SCHEMA_EXPORT}_state"

    # Views that include the surrounding areas
    EXPORT_SURROUNDING_CI = f"{SCHEMA_EXPORT}_{SURROUNDING}_{CI}"
    EXPORT_SURROUNDING_SN = f"{SCHEMA_EXPORT}_{SURROUNDING}_{SN}"
    EXPORT_SURROUNDING_SP = f"{SCHEMA_EXPORT}_{SURROUNDING}_{SP}"
    EXPORT_SURROUNDING_HF = f"{SCHEMA_EXPORT}_{SURROUNDING}_{HF}"
