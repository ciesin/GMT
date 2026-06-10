from lib.async_db_utils import (
    ConnType,
    PoolConn,
    create_schema,
    execute_log,
    drop_table,
)

from psycopg.sql import SQL, Literal, Identifier

from lib.logger_utils import get_logger

from modules.exporter_shared.gmt_db_objects import ExportDbNames

log = get_logger(__name__)

# IMPORTANT these are from
# https://github.com/novelt/GMT/tree/main/importer/src/modules/exporter_api
# main branch
# StateExportDbNames => ExportDbNames

COMMENT_LAST_SYNC_TIME_GMT = "Timestamp in the GMT time zone when the settlement was last updated/changed.  Note Excel may not interpret this correctly when opening the csv file."
COMMENT_EXPORT_TIME_GMT = (
    "Timestamp in the GMT time zone when this record was exported."
)

COMMENT_PART_FP = "fixed post"
COMMENT_FP_NAME = f"Name of the {COMMENT_PART_FP}"


async def create_settlement_table(
    conn: PoolConn,
) -> None:
    sql = (
        SQL("drop view if exists {}")
        .format(ExportDbNames.MOBILE_SUMMARY.as_identifier())
        .as_string()
    )

    await execute_log(conn, sql)
    await conn.execute(
        SQL("drop view if exists {}")
        .format(ExportDbNames.MOBILE_SETTLEMENTS.as_identifier())
        .as_string()
    )
    await drop_table(conn, ExportDbNames.SET)

    # table used as base table for table we'll make for each stat
    sql = (
        SQL("""
CREATE SCHEMA IF NOT EXISTS {schema};

CREATE TABLE {TABLE_SETTLEMENTS} (
    global_id UUID PRIMARY KEY,
    version_id TEXT NOT NULL,
    last_sync_time_gmt TIMESTAMP NOT NULL,
    export_time_gmt TIMESTAMP WITHOUT TIME ZONE NOT NULL,

    state_global_id UUID NOT NULL,
    lga_global_id UUID NOT NULL,
    ward_global_id UUID NOT NULL,
    state_name TEXT NOT NULL,
    lga_name TEXT NOT NULL,
    ward_name TEXT NOT NULL,
    lon_x DOUBLE PRECISION NOT NULL,
    lat_y DOUBLE PRECISION NOT NULL,
    set_with_gps text NOT NULL,

    name TEXT NOT NULL,

    type {schema}.settlement_part_type NOT NULL,

    synonyms TEXT NOT NULL,

    is_primary BOOLEAN NOT NULL,

    comments TEXT NOT NULL,


    estimated_pop INTEGER NULL,
    computed_pop INTEGER NOT NULL,
    settlement_type {schema}."settlement_part_type" NOT NULL,
    reason_for_attention TEXT NOT NULL,

    uninhabited BOOLEAN NOT NULL,
    uninhabited_reason text NULL,
   fixed_catchment_perc DOUBLE PRECISION NOT NULL,
   outreach_catchment_perc DOUBLE PRECISION NOT NULL, 
   uncovered_catchment_perc DOUBLE PRECISION NOT NULL,

   geom Geometry(MultiPolygon, 4326) NOT NULL
);

COMMENT ON COLUMN {TABLE_SETTLEMENTS}.global_id IS 'Unique identifier for the place or settlement (UUID format).';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.version_id IS 'Version number of the dataset or record (used for tracking changes).';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.last_sync_time_gmt IS {COMMENT_LAST_SYNC_TIME_GMT}; 

COMMENT ON COLUMN {TABLE_SETTLEMENTS}.export_time_gmt IS {COMMENT_EXPORT_TIME_GMT};

COMMENT ON COLUMN {TABLE_SETTLEMENTS}.type IS 'Settlement Type';

COMMENT ON COLUMN {TABLE_SETTLEMENTS}.ward_global_id IS 'UUID of the ward that is attributed to the settlement';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.lga_global_id IS 'UUID of the LGA that is the attributed parent of the ward';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.state_global_id IS 'UUID of the state that is the attributed parent of the LGA';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.ward_name IS 'Name of the ward with global_id ward_global_id';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.lga_name IS 'Name of the LGA with global_id lga_global_id';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.state_name IS 'Name of the state with global_id state_global_id';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.lon_x IS 'Longitude coordinate of the settlement name point.';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.lat_y IS 'Latitude coordinate of the settlement name point.';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.set_with_gps IS 'If the longitude/latitude were set using the GPS';

COMMENT ON COLUMN {TABLE_SETTLEMENTS}.name IS 'Name of the place or settlement.';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.is_primary IS 'Boolean indicating if the settlement is the primary one in its area; note in GMT only primary settlements are seen on the map';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.uninhabited IS 'Boolean indicating if the place is uninhabited.';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.synonyms IS 'Alternative names for the place, if any (pipe-separated)';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.estimated_pop IS 'Estimated population of the area. This is user provided';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.computed_pop IS 'Population calculated by computing zonal stats with the configured population raster and the settlement polygon geometry';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.settlement_type IS 'One of "bua", "ssa", "ha" or "gmt". These correspond to Built up Area, Small settlement area, hamlet area, and a settlement created with GMT, either hand drawn or a buffer around a point';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.reason_for_attention IS 'Notes or flags about data quality issues or known problems (if any). (pipe-separated). Values will be one of "Unknown", "Security Compromised", "Slum", "Nomadic/Fulani", "Scattered", "Riverine", "Internally Displaced", "Non-compliant", "Zero-dose", "Uptake Issue", "Measles Outbreak", "cVDPV Outbreak", "Polio High-Risk", "Other", "Densely Populated", "Hard To Reach"';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.uninhabited_reason IS 'Reason why the place is uninhabited (if marked as such), either blank or one of "N/A", "Unknown", "Abandoned", "Destroyed", "No settlement", or "Other - [User provided reason]".  N/A means the settlement is inhabited.' ;
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.fixed_catchment_perc IS 'Percentage (value between 0 and 100) of this settlements population that is covered by fixed post ri service';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.outreach_catchment_perc IS 'Percentage (value between 0 and 100) of this settlements population that is covered by outreach ri service';
COMMENT ON COLUMN {TABLE_SETTLEMENTS}.uncovered_catchment_perc IS 'Percentage (value between 0 and 100) of this settlements population that is not covered by neither fixed post ri service nor outreach ri service';

COMMENT ON COLUMN {TABLE_SETTLEMENTS}.comments IS 'Free form text for information not covered by a standard field';

    """)
        .format(
            TABLE_SETTLEMENTS=ExportDbNames.SET.as_identifier(),
            COMMENT_LAST_SYNC_TIME_GMT=Literal(COMMENT_LAST_SYNC_TIME_GMT),
            COMMENT_EXPORT_TIME_GMT=Literal(COMMENT_EXPORT_TIME_GMT),
            schema=Identifier(ExportDbNames.SET.schema_name),
        )
        .as_string()
    )

    await execute_log(conn, sql)


async def create_ci_table(conn: PoolConn) -> None:
    await drop_table(conn, ExportDbNames.CI)

    sql = (
        SQL("""

CREATE TABLE {TABLE_CI} (
    ci_global_id UUID PRIMARY KEY,
    version_id TEXT NOT NULL,
    last_sync_time_gmt TIMESTAMP NOT NULL,
    
    hf_global_id UUID NOT NULL,
    hf_name TEXT NOT NULL,
    hf_state_global_id UUID NOT NULL,
    hf_lga_global_id UUID NOT NULL,
    hf_ward_global_id UUID NOT NULL,
    hf_state_name TEXT NOT NULL,
    hf_lga_name TEXT NOT NULL,
    hf_ward_name TEXT NOT NULL,
    
    sn_global_id UUID NOT NULL,
    sn_name TEXT NOT NULL,
    sn_state_global_id UUID NOT NULL,
    sn_lga_global_id UUID NOT NULL,
    sn_ward_global_id UUID NOT NULL,
    sn_state_name TEXT NOT NULL,
    sn_lga_name TEXT NOT NULL,
    sn_ward_name TEXT NOT NULL,
    
    population_perc DOUBLE PRECISION NOT NULL,
    
    type {schema}."ci_type" NOT NULL
   
);

COMMENT ON COLUMN {TABLE_CI}.ci_global_id IS 'Unique identifier for the catchment item; note! this can change if the catchment is recalculated';

COMMENT ON COLUMN  {TABLE_CI}.hf_global_id IS 'Unique identifier for the {COMMENT_PART_HF}';

COMMENT ON COLUMN {TABLE_CI}.sn_global_id IS 'Unique identifier for the settlement name point';

COMMENT ON COLUMN {TABLE_CI}.hf_name IS {COMMENT_HF_NAME};
COMMENT ON COLUMN {TABLE_CI}.sn_name IS 'Name of the settlement name point';

COMMENT ON COLUMN {TABLE_CI}.version_id IS 'Version number of the data record';

COMMENT ON COLUMN {TABLE_CI}.last_sync_time_gmt IS {COMMENT_LAST_SYNC_TIME_GMT};

COMMENT ON COLUMN {TABLE_CI}.hf_ward_global_id IS 'UUID of the ward in which the {COMMENT_PART_HF} is attributed';
COMMENT ON COLUMN {TABLE_CI}.hf_lga_global_id IS 'UUID of the LGA that is the attributed parent of the ward';
COMMENT ON COLUMN {TABLE_CI}.hf_state_global_id IS 'UUID of the state that is the attributed parent of the LGA';

COMMENT ON COLUMN {TABLE_CI}.hf_ward_name IS 'Name of the ward with global_id hf_ward_global_id';
COMMENT ON COLUMN {TABLE_CI}.hf_lga_name IS 'Name of the LGA with global_id hf_lga_global_id';
COMMENT ON COLUMN {TABLE_CI}.hf_state_name IS 'Name of the state with global_id hf_state_global_id';

COMMENT ON COLUMN {TABLE_CI}.sn_ward_global_id IS 'UUID of the ward in which the settlement name point is attributed';
COMMENT ON COLUMN {TABLE_CI}.sn_lga_global_id IS 'UUID of the LGA that is the attributed parent of the ward';
COMMENT ON COLUMN {TABLE_CI}.sn_state_global_id IS 'UUID of the state that is the attributed parent of the LGA';

COMMENT ON COLUMN {TABLE_CI}.sn_ward_name IS 'Name of the ward with global_id sn_ward_global_id';
COMMENT ON COLUMN {TABLE_CI}.sn_lga_name IS 'Name of the LGA with global_id sn_lga_global_id';
COMMENT ON COLUMN {TABLE_CI}.sn_state_name IS 'Name of the state with global_id sn_state_global_id';

COMMENT ON COLUMN {TABLE_CI}.population_perc IS 'Percentage (0-100) of the given settlement that will be in the catchment of the assiciated health facility';

COMMENT ON COLUMN {TABLE_CI}.type IS 'Can be one of "generated", "include", "exclude".  generated means this percentage was automatically calculated.  Include means the user explicitly chose to associate this settlement and health facility.  Exclude means it was explicitly excluded.  Note for excludes, population percentage is 0. For includes, the population percentage is also 0 because there will be other rows with "generated" with the final population percentage values.';

        """)
        .format(
            TABLE_CI=ExportDbNames.CI.as_identifier(),
            COMMENT_LAST_SYNC_TIME_GMT=Literal(COMMENT_LAST_SYNC_TIME_GMT),
            COMMENT_PART_HF=SQL(COMMENT_PART_FP),
            COMMENT_HF_NAME=Literal(COMMENT_FP_NAME),
            schema=Identifier(ExportDbNames.CI.schema_name),
        )
        .as_string()
    )

    await execute_log(conn, sql)

    # autocommit by default


async def create_catchment_polygon_table(conn: PoolConn) -> None:
    await drop_table(conn, ExportDbNames.CP)

    sql = (
        SQL("""

CREATE TABLE {TABLE_CP} (
    
    
    export_time_gmt TIMESTAMP WITHOUT TIME ZONE NOT NULL,

    hf_global_id UUID NOT NULL,
    hf_name TEXT NOT NULL,
    strategy_type {schema}.hf_type NOT NULL, 
    
    hf_state_global_id UUID NOT NULL,
    hf_lga_global_id UUID NOT NULL,
    hf_ward_global_id UUID NOT NULL,
    hf_state_name TEXT NOT NULL,
    hf_lga_name TEXT NOT NULL,
    hf_ward_name TEXT NOT NULL,

    gis_pop double precision NOT NULL,
    est_pop double precision NOT NULL, 
    est_gis_pop double precision NOT NULL,
    --SUM(sp.computed_pop * ci.population_perc / 100) AS gis_pop,
    --        SUM(COALESCE(sn.estimated_pop,0) * ci.population_perc / 100) AS est_pop,
      --      SUM(COALESCE(sn.estimated_pop, sp.computed_pop) * ci.population_perc / 100) AS est_gis_pop 

    geom Geometry(Polygon, 4326) NULL

);


COMMENT ON COLUMN  {TABLE_CP}.hf_global_id IS 'Unique identifier for the {COMMENT_PART_HF}';



COMMENT ON COLUMN {TABLE_CP}.hf_name IS {COMMENT_HF_NAME};


COMMENT ON COLUMN {TABLE_CP}.export_time_gmt IS {COMMENT_EXPORT_TIME_GMT};

COMMENT ON COLUMN {TABLE_CP}.hf_ward_global_id IS 'UUID of the ward in which the {COMMENT_PART_HF} is attributed';
COMMENT ON COLUMN {TABLE_CP}.hf_lga_global_id IS 'UUID of the LGA that is the attributed parent of the ward';
COMMENT ON COLUMN {TABLE_CP}.hf_state_global_id IS 'UUID of the state that is the attributed parent of the LGA';

COMMENT ON COLUMN {TABLE_CP}.hf_ward_name IS 'Name of the ward with global_id hf_ward_global_id';
COMMENT ON COLUMN {TABLE_CP}.hf_lga_name IS 'Name of the LGA with global_id hf_lga_global_id';
COMMENT ON COLUMN {TABLE_CP}.hf_state_name IS 'Name of the state with global_id hf_state_global_id';

COMMENT ON COLUMN {TABLE_CP}.strategy_type IS 'Determined by if associated health facility is of type fixed post or outreach';

COMMENT ON COLUMN {TABLE_CP}.gis_pop IS 'Catchment population using the GIS population';
COMMENT ON COLUMN {TABLE_CP}.est_pop IS 'Catchment population using the user provided settlement population estimates.  If user provided population estimate is not present, will default to 0.';
COMMENT ON COLUMN {TABLE_CP}.est_gis_pop IS 'Catchment population using the user provided settlement population estimates and if not provided, defaulting to the GIS population of any settlement missing the user provided estimated population.';

        """)
        .format(
            TABLE_CP=ExportDbNames.CP.as_identifier(),
            COMMENT_LAST_SYNC_TIME_GMT=Literal(COMMENT_LAST_SYNC_TIME_GMT),
            COMMENT_EXPORT_TIME_GMT=Literal(COMMENT_EXPORT_TIME_GMT),
            COMMENT_PART_HF=SQL(COMMENT_PART_FP),
            COMMENT_HF_NAME=Literal(COMMENT_FP_NAME),
            schema=Identifier(ExportDbNames.CP.schema_name),
        )
        .as_string()
    )

    await execute_log(conn, sql)


async def create_hf_tables(conn: PoolConn) -> None:
    # Create 3 tables with same structure, but tweaking the comments to explain the differences

    await create_hf_types(conn)
    await create_outreach_table(conn)

    for table_name in [
        ExportDbNames.HF,
        ExportDbNames.FP,
    ]:
        await drop_table(conn, table_name)

        sql = (
            SQL("""

CREATE TABLE {TABLE} (
    fp_global_id UUID PRIMARY KEY,
    version_id TEXT NOT NULL,
    last_sync_time_gmt TIMESTAMP NOT NULL,
    export_time_gmt TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    state_global_id UUID NOT NULL,
    lga_global_id UUID NOT NULL,
    ward_global_id UUID NOT NULL,
    state_name TEXT NOT NULL,
    lga_name TEXT NOT NULL,
    ward_name TEXT NOT NULL,
    lon_x DOUBLE PRECISION  NOT NULL,
    lat_y DOUBLE PRECISION NOT NULL,
    set_with_gps text NOT NULL,
    name TEXT NOT NULL,
    synonyms TEXT NOT NULL,

    comments TEXT NOT NULL,

    services TEXT NOT NULL,
    mp_status {schema}."hf_microplan_status" NOT NULL,
    level_of_care {schema}."hf_level_of_care" NOT NULL ,

    primary_type TEXT NOT NULL,
    ownership {schema}."hf_ownership" NOT NULL,
    operating_hours_start TEXT NOT NULL,
    operating_hours_stop TEXT NOT NULL,
    staff_names TEXT NOT NULL,
    staff_positions TEXT NOT NULL,
    staff_types TEXT NOT NULL,

    transport TEXT  NOT NULL,
    frequency {schema}.hf_frequency NOT NULL,
    type {schema}."hf_type" NOT NULL,
    custom_catchment boolean NOT NULL,
    gis_catchment_pop DOUBLE PRECISION NOT NULL,
    estimated_catchment_pop DOUBLE PRECISION NOT NULL,
    estimated_gis_catchment_pop DOUBLE PRECISION NOT NULL,
    geom Geometry(Point, 4326) NOT NULL

);


COMMENT ON COLUMN {TABLE}.fp_global_id IS 'Unique identifier for the {COMMENT_PART_HF}';


COMMENT ON COLUMN {TABLE}.version_id IS 'Version number of the data record';

COMMENT ON COLUMN {TABLE}.last_sync_time_gmt IS {COMMENT_LAST_SYNC_TIME_GMT};

COMMENT ON COLUMN {TABLE}.export_time_gmt IS {COMMENT_EXPORT_TIME_GMT};

COMMENT ON COLUMN {TABLE}.ward_global_id IS 'UUID of the ward in which the {COMMENT_PART_HF} is attributed';

COMMENT ON COLUMN {TABLE}.lga_global_id IS 'UUID of the LGA that is the attributed parent of the ward';
COMMENT ON COLUMN {TABLE}.state_global_id IS 'UUID of the state that is the attributed parent of the LGA';

COMMENT ON COLUMN {TABLE}.ward_name IS 'Name of the ward with global_id ward_global_id';
COMMENT ON COLUMN {TABLE}.lga_name IS 'Name of the LGA with global_id lga_global_id';
COMMENT ON COLUMN {TABLE}.state_name IS 'Name of the state with global_id state_global_id';

COMMENT ON COLUMN {TABLE}.lon_x IS 'Longitude coordinate of the facility';
COMMENT ON COLUMN {TABLE}.lat_y IS 'Latitude coordinate of the facility';

COMMENT ON COLUMN {TABLE}.set_with_gps IS 'If the longitude/latitude were set using the GPS';

COMMENT ON COLUMN {TABLE}.name IS {COMMENT_HF_NAME};
COMMENT ON COLUMN {TABLE}.synonyms IS 'Alternative names or spellings for the facility (pipe-separated)';

COMMENT ON COLUMN {TABLE}.services IS 'Services provided (e.g., Routine Immunization) (pipe-separated)  Values can be one of "Antenatal Care", "Postnatal Care", "Delivery", "Routine Immunization", "Family Planning", "HIV/AIDS Prevention", "Curative Care and OPD", "Newborn Care", "IMCI", "TB/Leprosy services", "Malaria control", "Growth Monitoring", "Eye Care", "Mental Care", "Oral Care", "Health Education", "Community Engagement", "Sanitation", "CMAM", "Referral", "IYCF"';
COMMENT ON COLUMN {TABLE}.mp_status IS 'Microplanning status; values can be "Not Started", "In Progress", "Complete"';
COMMENT ON COLUMN {TABLE}.level_of_care IS 'Facility’s level in the healthcare system; values can be "Unknown", "Primary", "Secondary", "Tertiary", "Other", "Dispensary"';

COMMENT ON COLUMN {TABLE}.primary_type IS 'Main classification of the facility; values can be "Unknown", "Health Post", "Primary Health Clinic", "Primary Health Centre"';
COMMENT ON COLUMN {TABLE}.ownership  IS 'Indicates if the facility is privately owned or not.  Values can be "Public", "Private", "Unknown"';
COMMENT ON COLUMN {TABLE}.operating_hours_start IS 'Pipe-separated start times for each day of the week, starts with Monday; can be blank when Routine Immunization Services not provided';
COMMENT ON COLUMN {TABLE}.operating_hours_stop IS 'Pipe-separated stop times for each day of the week';
COMMENT ON COLUMN {TABLE}.staff_names IS 'Names of staff members (pipe-separated)';
COMMENT ON COLUMN {TABLE}.staff_positions IS 'Positions of staff members (pipe-separated); position in pipe separated list matches the same position as the staff name';
COMMENT ON COLUMN {TABLE}.staff_types IS 'Types or roles of staff (pipe-separated); position in pipe separated list matches the same position as the staff name';

COMMENT ON COLUMN {TABLE}.transport IS 'Mode of transport used for outreach (pipe-separated)';
COMMENT ON COLUMN {TABLE}.frequency IS 'Frequency of service delivery (e.g., once per month); values can be "oncePerMonth", "twicePerMonth", ..., "daily", "other"';
COMMENT ON COLUMN {TABLE}.type IS 'Type of service delivery (Is either outreach or fixed)';

COMMENT ON COLUMN {TABLE}.custom_catchment IS 'True if the catchment was chosen explicitly';

COMMENT ON COLUMN {TABLE}.comments IS 'Free form text for information not covered by a standard field';
        """)
            .format(
                TABLE=table_name.as_identifier(),
                COMMENT_LAST_SYNC_TIME_GMT=Literal(COMMENT_LAST_SYNC_TIME_GMT),
                COMMENT_PART_HF=SQL(COMMENT_PART_FP),
                COMMENT_HF_NAME=Literal(COMMENT_FP_NAME),
                COMMENT_EXPORT_TIME_GMT=Literal(COMMENT_EXPORT_TIME_GMT),
                schema=Identifier(ExportDbNames.HF.schema_name),
            )
            .as_string()
        )

        await execute_log(conn, sql)

    # the comments that depend on the table, note the
    # outreach ones are with create_outreach_table
    sql = (
        SQL("""
    COMMENT ON COLUMN {TABLE_HF}.gis_catchment_pop IS 'Computed population handled by this fixed post INCLUDING its attached outreaches';
    COMMENT ON COLUMN {TABLE_HF}.estimated_catchment_pop IS 'Estimated population (pop entered directly by users, defaulted to 0 if not defined) handled by this fixed post INCLUDING its attached outreaches.  Note estimated population is often not defined.';
    COMMENT ON COLUMN {TABLE_HF}.estimated_gis_catchment_pop IS 'Estimated population (pop entered directly by users, defaulted to computed pop if not defined) handled by this fixed post INCLUDING its attached outreaches';

    COMMENT ON COLUMN {TABLE_FP}.gis_catchment_pop IS 'Computed population handled by this fixed post NOT INCLUDING its attached outreaches';
    COMMENT ON COLUMN {TABLE_FP}.estimated_catchment_pop IS 'Estimated population (pop entered directly by users, defaulted to 0 if not defined) handled by this fixed post NOT INCLUDING its attached outreaches.  Note estimated population is often not defined.';
    COMMENT ON COLUMN {TABLE_FP}.estimated_gis_catchment_pop IS 'Estimated population (pop entered directly by users, defaulted to computed pop if not defined) handled by this fixed post NOT INCLUDING its attached outreaches';


    """)
        .format(
            TABLE_HF=ExportDbNames.HF.as_identifier(),
            TABLE_FP=ExportDbNames.FP.as_identifier(),
        )
        .as_string()
    )

    await execute_log(conn, sql)
    # autocommit by default


async def create_hf_types(conn: PoolConn) -> None:
    # Create types used by the 3
    sql = (
        SQL("""

DROP TYPE IF EXISTS {schema}."hf_ownership";

CREATE TYPE {schema}."hf_ownership" AS ENUM (
    'Unknown',
    'Public', 'Private');      

DROP TYPE IF EXISTS {schema}.hf_frequency;

CREATE TYPE {schema}.hf_frequency AS ENUM (
'oncePerMonth', 'twicePerMonth', 'threePerMonth',
            'oncePerWeek', 'twicePerWeek', 'threePerWeek',
            'fourPerWeek', 'fivePerWeek', 'sixPerWeek',
            'daily', 'other', 'unknown');      
""")
        .format(
            schema=Identifier(ExportDbNames.HF.schema_name),
        )
        .as_string()
    )

    await execute_log(conn, sql)


async def create_outreach_table(conn: PoolConn) -> None:
    await drop_table(conn, ExportDbNames.OUTREACH)

    sql = (
        SQL("""
CREATE TABLE {TABLE_OUTREACH} (
    outreach_global_id UUID PRIMARY KEY,
    version_id TEXT NOT NULL,
    last_sync_time_gmt TIMESTAMP NOT NULL,
    export_time_gmt TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    state_global_id UUID NOT NULL,
    lga_global_id UUID NOT NULL,
    ward_global_id UUID NOT NULL,
    state_name TEXT NOT NULL,
    lga_name TEXT NOT NULL,
    ward_name TEXT NOT NULL,
    lon_x DOUBLE PRECISION  NOT NULL,
    lat_y DOUBLE PRECISION NOT NULL,
    set_with_gps text NOT NULL,
    name TEXT NOT NULL,

    comments TEXT NOT NULL,

    operating_hours_start TEXT NOT NULL,
    operating_hours_stop TEXT NOT NULL,
    fixed_post_parent_global_id UUID NULL,
    transport TEXT  NOT NULL,
    frequency {schema}.hf_frequency NOT NULL,
    type {schema}."hf_type" NOT NULL,
    custom_catchment boolean NOT NULL,

    gis_catchment_pop DOUBLE PRECISION NOT NULL,
    estimated_catchment_pop DOUBLE PRECISION NOT NULL,
    estimated_gis_catchment_pop DOUBLE PRECISION NOT NULL,

    geom Geometry(Point, 4326) NOT NULL

);


COMMENT ON COLUMN {TABLE_OUTREACH}.outreach_global_id IS 'Unique identifier for the outreach';


COMMENT ON COLUMN {TABLE_OUTREACH}.version_id IS 'Version number of the data record';

COMMENT ON COLUMN {TABLE_OUTREACH}.last_sync_time_gmt IS {COMMENT_LAST_SYNC_TIME_GMT};

COMMENT ON COLUMN {TABLE_OUTREACH}.export_time_gmt IS {COMMENT_EXPORT_TIME_GMT};

COMMENT ON COLUMN {TABLE_OUTREACH}.ward_global_id IS 'UUID of the ward in which the outreach is attributed';

COMMENT ON COLUMN {TABLE_OUTREACH}.lga_global_id IS 'UUID of the LGA that is the attributed parent of the ward';
COMMENT ON COLUMN {TABLE_OUTREACH}.state_global_id IS 'UUID of the state that is the attributed parent of the LGA';

COMMENT ON COLUMN {TABLE_OUTREACH}.ward_name IS 'Name of the ward with global_id ward_global_id';
COMMENT ON COLUMN {TABLE_OUTREACH}.lga_name IS 'Name of the LGA with global_id lga_global_id';
COMMENT ON COLUMN {TABLE_OUTREACH}.state_name IS 'Name of the state with global_id state_global_id';

COMMENT ON COLUMN {TABLE_OUTREACH}.lon_x IS 'Longitude coordinate of the facility';
COMMENT ON COLUMN {TABLE_OUTREACH}.lat_y IS 'Latitude coordinate of the facility';

COMMENT ON COLUMN {TABLE_OUTREACH}.set_with_gps IS 'If the longitude/latitude were set using the GPS';

COMMENT ON COLUMN {TABLE_OUTREACH}.name IS 'Name of the outreach site';

COMMENT ON COLUMN {TABLE_OUTREACH}.operating_hours_start IS 'Pipe-separated start times for each day of the week, starts with Monday; can be blank when Routine Immunization Services not provided';
COMMENT ON COLUMN {TABLE_OUTREACH}.operating_hours_stop IS 'Pipe-separated stop times for each day of the week';
COMMENT ON COLUMN {TABLE_OUTREACH}.fixed_post_parent_global_id IS 'Parent facility’s global ID for outreach';
COMMENT ON COLUMN {TABLE_OUTREACH}.transport IS 'Mode of transport used for outreach (pipe-separated)';
COMMENT ON COLUMN {TABLE_OUTREACH}.frequency IS 'Frequency of service delivery (e.g., once per month); values can be "oncePerMonth", "twicePerMonth", ..., "daily", "other"';
COMMENT ON COLUMN {TABLE_OUTREACH}.type IS 'Type of service delivery (Is either outreach or fixed)';

COMMENT ON COLUMN {TABLE_OUTREACH}.custom_catchment IS 'True if the catchment was chosen explicitly';

COMMENT ON COLUMN {TABLE_OUTREACH}.comments IS 'Free form text for information not covered by a standard field';

COMMENT ON COLUMN {TABLE_OUTREACH}.gis_catchment_pop IS 'Computed population handled by this health facility';
    COMMENT ON COLUMN {TABLE_OUTREACH}.estimated_catchment_pop IS 'Estimated population (pop entered directly by users, defaulted to 0 if not defined) handled by this health facility.  Note estimated population is often not defined.';
    COMMENT ON COLUMN {TABLE_OUTREACH}.estimated_gis_catchment_pop IS 'Estimated population (pop entered directly by users, defaulted to computed pop if not defined) handled by this health facility';
        """)
        .format(
            TABLE_OUTREACH=ExportDbNames.OUTREACH.as_identifier(),
            COMMENT_LAST_SYNC_TIME_GMT=Literal(COMMENT_LAST_SYNC_TIME_GMT),
            COMMENT_EXPORT_TIME_GMT=Literal(COMMENT_EXPORT_TIME_GMT),
            schema=Identifier(ExportDbNames.HF.schema_name),
        )
        .as_string()
    )

    await execute_log(conn, sql)


async def create_raw_hf_table(conn: ConnType) -> None:
    # uses enums
    await drop_table(conn, ExportDbNames.HF)
    await drop_table(conn, ExportDbNames.RAW_HF)
    await drop_table(conn, ExportDbNames.CP)

    await create_schema(conn, ExportDbNames.RAW_HF.schema_name)

    create_sql = (
        SQL(
            """
--use our own types to not have type dependencies outside the schema            

DROP TYPE IF EXISTS {schema}."hf_services";

CREATE TYPE {schema}."hf_services" AS ENUM (
    'Antenatal Care',
    'Postnatal Care',
    'Delivery',
    'Routine Immunization',
    'Family Planning',
    'HIV/AIDS Prevention',
    'Curative Care and OPD',
    'Newborn Care',
    'IMCI',
    'TB/Leprosy services',
    'Malaria control',
    'Growth Monitoring',
    'Eye Care',
    'Mental Care',
    'Oral Care',
    'Health Education',
    'Community Engagement',
    'Sanitation',
    'CMAM',
    'Referral',
    'IYCF');

DROP TYPE IF EXISTS {schema}."hf_level_of_care";

CREATE TYPE {schema}."hf_level_of_care" AS ENUM (
    'Unknown',
    'Primary',
    'Secondary',
    'Tertiary',
    'Other',
    'Dispensary');

DROP TYPE IF EXISTS {schema}."hf_maturity_level";

CREATE TYPE {schema}."hf_maturity_level" AS ENUM (
    'Unknown',
    'Mature',
    'Old',
    'New'); 

 DROP TYPE IF EXISTS {schema}."hf_primary_type";

CREATE TYPE {schema}."hf_primary_type" AS ENUM (
    'Unknown',
    'Health Post',
    'Primary Health Clinic',
    'Primary Health Centre');

DROP TYPE IF EXISTS {schema}."hf_staff_position";

CREATE TYPE {schema}."hf_staff_position" AS ENUM (
    'Unknown',
    'StaffPosition',
    'Medical Doctor',
    'Pharmacist',
    'Laboratory Scientist/Technician',
    'Nurse',
    'Midwife',
    'Nurse & Midwife',
    'Community Health Officer',
    'Senior CHEW',
    'Junior CHEW',
    'Environmental Health Officer',
    'Health Record/Info Management Officer',
    'Health Attendant/Assistant',
    'Other'
    ); 

 DROP TYPE IF EXISTS {schema}."hf_staff_type";

CREATE TYPE {schema}."hf_staff_type" AS ENUM (
    'Unknown',
    'Casual',
    'Part-time',
    'Full-time');

DROP TYPE IF EXISTS {schema}."hf_means_of_transport";

CREATE TYPE {schema}."hf_means_of_transport" AS ENUM (
    'Unknown',
    'Foot',
    'Bicycle',
    'Motorbike',
    'Vehicle',
    'Canoe',
    'Boat'); 

DROP TYPE IF EXISTS {schema}."hf_type";

CREATE TYPE {schema}."hf_type" AS ENUM (    
    'fixed_post',
    'outreach'
   ); 

DROP TYPE IF EXISTS {schema}."hf_microplan_status";

CREATE TYPE {schema}."hf_microplan_status" AS ENUM (
    'Unknown',
    'Not Started',
    'In Progress',
    'Complete'); 

CREATE TABLE IF NOT EXISTS {raw_hf}
(
    global_id uuid NOT NULL,
    version_id int8 NOT NULL,

    boundary_polygon uuid NOT NULL,
    geom public.geometry(point, 4326) NULL,
    set_with_gps bool NULL,
    "name" text NOT NULL,

    comments TEXT NOT NULL,

    synonyms text[] DEFAULT ARRAY[]::text[] NOT NULL,
    equipment text[] DEFAULT ARRAY[]::text[] NOT NULL,
    services {schema}."hf_services"[] DEFAULT ARRAY[]::{schema}.hf_services[] NOT NULL,
    mp_status {schema}."hf_microplan_status" DEFAULT 'Unknown'::{schema}.hf_microplan_status NOT NULL,
    level_of_care {schema}."hf_level_of_care" DEFAULT 'Unknown'::{schema}.hf_level_of_care NOT NULL,
    maturity_level {schema}."hf_maturity_level" DEFAULT 'Unknown'::{schema}.hf_maturity_level NOT NULL,
    primary_type {schema}."hf_primary_type" DEFAULT 'Unknown'::{schema}.hf_primary_type NOT NULL,
    private bool NULL,
    operating_hours_start time without time zone[] DEFAULT ARRAY[]::time without time zone[] NOT NULL,
    operating_hours_stop time without time zone[] DEFAULT ARRAY[]::time without time zone[] NOT NULL,
    staff_names text[] DEFAULT ARRAY[]::text[] NOT NULL,
    staff_positions {schema}."hf_staff_position"[] DEFAULT ARRAY[]::{schema}.hf_staff_position[] NOT NULL,
    staff_types {schema}."hf_staff_type"[] DEFAULT ARRAY[]::{schema}.hf_staff_type[] NOT NULL,
    parent uuid NULL,
    transport {schema}."hf_means_of_transport"[] DEFAULT ARRAY[]::{schema}.hf_means_of_transport[] NOT NULL,
    frequency text DEFAULT 'Unknown'::text NOT NULL,
    "type" {schema}."hf_type"  NOT NULL,
    properties jsonb NOT NULL,

    raster_width     integer          default 0                NOT NULL,
    raster_height    integer          default 0                NOT NULL,
    origin_x         double precision default 0                NOT NULL,
    origin_y         double precision default 0                NOT NULL,
    catchment_raster bit varying      default ''::bit varying  NOT NULL
);                     
                     """
        )
        .format(
            raw_hf=ExportDbNames.RAW_HF.as_identifier(),
            schema=Identifier(ExportDbNames.RAW_HF.schema_name),
        )
        .as_string()
    )

    await execute_log(conn, create_sql, log_return=False)
