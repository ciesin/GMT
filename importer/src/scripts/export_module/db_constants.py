from typing import List, Optional, Protocol, Union, Dict
import uuid 

class BoundaryRow(Protocol):
    # Empty method body (explicit '...')
    # def cursor(self) -> psycopg2.extensions.cursor: ...
    ward_guid: uuid.UUID
    partition_id: int
    
SCHEMA_EXPORT = "exp"
SCHEMA_SP = "partitions_settlement_part"
SCHEMA_SN = "partitions_settlement_name"
SCHEMA_CI = "partitions_ri_catchment_item"
SCHEMA_HF = "partitions_health_facility_point"

TABLE_SETTLEMENTS_BASE = "settlement_base"
TABLE_SETTLEMENTS_GEOPODE = "settlement_geopode"

TABLE_SETTLEMENTS_GMT_BASE = "settlement_gmt_base"
TABLE_SETTLEMENTS_GMT_AFTER_PILOT = "settlement_gmt_after_pilot"
TABLE_SETTLEMENTS_GMT_BEFORE_PILOT = "settlement_gmt_before_pilot"

TABLE_SETTLEMENTS_GMT_DELETED_DEMOTED = "settlement_gmt_deleted_or_demoted"

# stores both outreach & hf
TABLE_GMT_HF_BASE = "gmt_hf_base"
TABLE_GMT_FP_BASE = "gmt_fp_base"
TABLE_GMT_OUTREACH_BASE = "gmt_outreach_base"

TABLE_STATES = "state" 
TABLE_LGAS = "lga" 
TABLE_WARDS = "ward"
TABLE_SETTLEMENT_PARTS = "settlement_parts"
TABLE_CATCHMENT_POLYGONS = "catchments"

TABLE_BOUNDARY_ADJ = "boundary_adjustments"

VIEW_BOUNDARY_ADJ_DIFF = "boundary_adjustments_diff"

# These 3 are after pilot views specifically requested for Excel export (also in gdb)
VIEW_HEALTH_FACILITIES_FIXED_POST = "health_facilities_fixed_post"
VIEW_HEALTH_FACILITIES_OUTREACH = "outreaches"
VIEW_SETTLEMENTS = "settlements"

# we need <= 5km but since 3857 we give some buffer
# this also will determine when we don't put a closest HF since
# we won't search the country
BBOX_SP_BUFFER_3857_METERS = 7000