from psycopg.sql import Identifier, SQL

from lib.async_db_utils import (
    execute_log,
    drop_table,
    ConnType,
    create_schema,
    table_exists,
    create_index,
)
from lib.logger_utils import get_logger
from modules.exporter_shared.gmt_db_objects import ExportDbNames

log = get_logger(__name__)


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

--This order used in the excel export columns
CREATE TYPE {schema}."hf_services" AS ENUM (
    'Routine Immunization',
    'Antenatal Care',    
    'Postnatal Care',
    'Delivery',    
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
    global_id uuid PRIMARY KEY,
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


async def create_raw_ci_table(conn: ConnType) -> None:
    await drop_table(conn, ExportDbNames.RAW_CI)

    # uses enums
    await drop_table(conn, ExportDbNames.CI)
    await drop_table(conn, ExportDbNames.CP)

    await create_schema(conn, ExportDbNames.RAW_CI.schema_name)

    create_sql = (
        SQL(
            """
DROP TYPE IF EXISTS {schema}."ci_type";

CREATE TYPE {schema}."ci_type" AS ENUM (
    'generated',
    'include',
    'exclude');

CREATE TABLE IF NOT EXISTS {raw_ci}
(
    global_id uuid NOT NULL,
    version_id bigint NOT NULL,
    boundary_polygon uuid NOT NULL,

    settlement_part uuid NOT NULL,
    health_facility_point uuid NOT NULL,

    population_perc double precision NOT NULL,

    properties jsonb DEFAULT '{{}}'::jsonb NOT NULL,
    "type" {schema}."ci_type" DEFAULT 'generated'::{schema}.ci_type NOT NULL,
    
    PRIMARY KEY (global_id, version_id)
);                     
                     """
        )
        .format(
            raw_ci=ExportDbNames.RAW_CI.as_identifier(),
            schema=Identifier(ExportDbNames.RAW_CI.schema_name),
        )
        .as_string()
    )

    await execute_log(conn, create_sql, log_return=False)

    await create_index(
        conn, ExportDbNames.RAW_CI.with_column_name("settlement_part"), is_geom=False
    )
    await create_index(
        conn,
        ExportDbNames.RAW_CI.with_column_name("health_facility_point"),
        is_geom=False,
    )


async def create_raw_sp_table(conn: ConnType) -> None:
    await drop_table(conn, ExportDbNames.RAW_SP)

    sql = (
        SQL("""


    DROP TYPE IF EXISTS {schema}.sp_split_type;

    CREATE TYPE {schema}.sp_split_type AS ENUM
    (
        'none',
        'merged_by_hand',
        'split_by_hand',
        'auto_split_parent',
        'auto_split_child',
        'boundary_split_parent',
        'boundary_split_child'
    );


    DROP TYPE IF EXISTS {schema}."settlement_part_type";

    CREATE TYPE {schema}."settlement_part_type" AS ENUM (
	'gmt',
	'bua',
	'ssa',
	'ha');

    CREATE TABLE {sp_raw} (
        global_id uuid PRIMARY KEY,
        version_id bigint NOT NULL, 
        is_deleted bool NOT NULL DEFAULT False,
        boundary_polygon uuid NOT NULL,
        geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
        type {schema}.settlement_part_type NOT NULL,        
        properties jsonb NOT NULL DEFAULT '{{}}',
        area_m2 double precision NOT NULL,
        computed_pop real NULL,
        bbox double precision[] NULL,
        original_guids uuid[] NOT NULL DEFAULT array[]::uuid[],
        split_type {schema}.sp_split_type NOT NULL DEFAULT 'none',
        split_parent uuid NULL 
    );



            """)
        .format(
            sp_raw=ExportDbNames.RAW_SP.as_identifier(),
            schema=Identifier(ExportDbNames.RAW_SP.schema_name),
        )
        .as_string()
    )

    await execute_log(conn, sql, log_return=False)


async def create_raw_sn_table(conn: ConnType) -> None:
    await create_schema(conn, ExportDbNames.RAW_SN.schema_name)

    # because of enum dep
    await drop_table(conn, ExportDbNames.SET)
    await drop_table(conn, ExportDbNames.RAW_SN)

    log.info(f"Creating table {ExportDbNames.RAW_SN}")

    create_sql = (
        SQL(
            """

DROP TYPE IF EXISTS {schema}."sn_problematic";

--Aka special attention
--This order is used in the excel
CREATE TYPE {schema}."sn_problematic" AS ENUM (
    'Unknown',
    'Security Compromised',
    'Slum',
    'Densely Populated',
    'Hard To Reach',
    'Nomadic/Fulani',
    'Scattered',
    'Riverine',
    'Internally Displaced',
    'Non-compliant',
    'Zero-dose',
    'Uptake Issue',
    'Measles Outbreak',
    'cVDPV Outbreak',
    'Polio High-Risk',
    'Other');

DROP TYPE IF EXISTS {schema}."sn_uninhabited_reason";

CREATE TYPE {schema}."sn_uninhabited_reason" AS ENUM (
    'Unknown',
    'Abandoned',
    'Destroyed',
    'No settlement',
    'Other');

CREATE TABLE IF NOT EXISTS {sn}
(
    global_id uuid PRIMARY KEY,
    --As we don't have merges / etc; simpler to hard delete names 
    --Only in the import step is that done though    
    version_id bigint NOT NULL,
    boundary_polygon uuid NOT NULL,    
    geom public.geometry(point, 4326) NULL,
    set_with_gps bool NULL,
    "name" text NOT NULL,

    comments TEXT NOT NULL,
    synonyms text[] DEFAULT ARRAY[]::text[] NOT NULL,
    is_machine_generated bool NOT NULL DEFAULT false,
    is_primary bool DEFAULT false NOT NULL,
    estimated_pop DOUBLE PRECISION NULL,

    settlement_part uuid NULL,

    uninhabited bool NULL,
    uninhabited_reason {schema}."sn_uninhabited_reason" NULL,
    uninhabited_other_detail text NOT NULL,
    problematic {schema}."sn_problematic"[] DEFAULT ARRAY[]::{schema}.sn_problematic[] NOT NULL,

    properties jsonb DEFAULT '{{}}'::jsonb NOT NULL     
);                     

COMMENT ON COLUMN {sn}.boundary_polygon IS 'Attributed boundary global id; for GMT users can change the boundary of a settlement name';

                     """
        )
        .format(
            sn=ExportDbNames.RAW_SN.as_identifier(),
            schema=Identifier(ExportDbNames.RAW_SN.schema_name),
        )
        .as_string()
    )

    await execute_log(conn, create_sql, log_return=False)

    if not await table_exists(conn, ExportDbNames.RAW_SN):
        raise Exception(f"{ExportDbNames.RAW_SN} should exist")
