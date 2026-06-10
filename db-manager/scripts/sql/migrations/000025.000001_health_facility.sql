CREATE TABLE health_facility.data_all as 
select * from health_facility.point;

DROP MATERIALIZED VIEW IF EXISTS health_facility.point_latest;
DROP TABLE IF EXISTS health_facility.point ;

--TODO remove deprecated ones
-- health_facility_catchment_status
-- health_facility_maturity_level
-- health_facility_strategy
-- health_facility_type


--DROP TYPE IF EXISTS health_facility_level_of_care ;
CREATE TYPE hf_level_of_care AS ENUM (
    'Unknown',
  'Primary',
  'Secondary',
  'Tertiary',
  'Other',
  'Dispensary');

--ALTER TYPE health_facility_maturity_level OWNER TO CURRENT_USER ;
--ALTER TYPE health_facility_maturity_level RENAME TO health_facility_maturity_level_old;

--DROP TYPE IF EXISTS health_facility_maturity_level  ;
CREATE TYPE hf_maturity_level AS ENUM (
  'Unknown',
  'Mature',
  'Old',
  'New');

--DROP TYPE IF EXISTS health_facility_catchment_status  ;
CREATE TYPE hf_microplan_status AS ENUM (
    'Unknown',
    'Not Started',
    'In Progress',
    'Complete');

CREATE TYPE hf_services AS ENUM (
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
'IYCF'
);

CREATE TYPE hf_primary_type AS ENUM (
  'Unknown',
  'Health Post',
  'Primary Health Clinic',
  'Primary Health Centre'
);

CREATE TYPE hf_staff_position AS ENUM (
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
  'Health Attendant/Assistant'
);

CREATE TYPE hf_staff_type AS ENUM (
  'Unknown',
  'Casual',
  'Part-time',
  'Full-time'
);

CREATE TYPE hf_type AS ENUM (
  'Unknown',
  'fixed_post',
  'outreach',
  'mobile');

CREATE TYPE hf_means_of_transport AS ENUM (
  'Unknown',
  'Foot',
  'Bicycle',
  'Motorbike',
  'Vehicle',
  'Canoe',
  'Boat'
);



CREATE TABLE IF NOT EXISTS health_facility.point
(
    global_id uuid NOT NULL,
    version_id bigint NOT NULL REFERENCES master.commits (id),
    is_deleted bool NOT NULL DEFAULT False,
    boundary_polygon uuid NOT NULL,
    --Health facility points can have a null geometry
    geom geometry(Point,4326) ,
    name text NOT NULL,
    synonyms text[] NOT NULL DEFAULT array[]::text[] ,
    equipment text[] NOT NULL DEFAULT array[]::text[] ,
    services hf_services[] NOT NULL DEFAULT array[]::hf_services[],
    
    --Note that when the concept of microplan versions is introduced, this will need to be in a table
    --containing a PK of hf id and mp version id an containing this field
    mp_status hf_microplan_status NOT NULL DEFAULT 'Unknown',
    level_of_care hf_level_of_care NOT NULL DEFAULT 'Unknown',
    maturity_level hf_maturity_level NOT NULL DEFAULT 'Unknown',
    primary_type hf_primary_type NOT NULL DEFAULT 'Unknown',

    -- null is unknown
    private bool,
    
    operating_hours_start time without time zone[] NOT NULL DEFAULT array[]::time without time zone[],
    operating_hours_stop time without time zone[] NOT NULL DEFAULT array[]::time without time zone[],
    
    staff_names text[] NOT NULL DEFAULT array[]::text[],
    staff_positions hf_staff_position[] NOT NULL DEFAULT array[]::hf_staff_position[],
    staff_types hf_staff_type[] NOT NULL DEFAULT array[]::hf_staff_type[],

    --outreach fields
    parent uuid,
    transport hf_means_of_transport[] NOT NULL DEFAULT array[]::hf_means_of_transport[],
    frequency text NOT NULL DEFAULT 'Unknown',
    type hf_type NOT NULL DEFAULT 'Unknown',

    --Raster fields
    raster_width     integer          default 0                NOT NULL,
    raster_height    integer          default 0                NOT NULL,
    origin_x         double precision default 0                NOT NULL,
    origin_y         double precision default 0                NOT NULL,
    catchment_raster bit varying      default ''::bit varying  not null,

    properties jsonb NOT NULL,
    PRIMARY KEY(global_id, version_id)
);

COMMENT ON COLUMN health_facility.point.operating_hours_start IS 'Should be an array of length 7, index 0 is Monday, index 6 is Sunday';
COMMENT ON COLUMN health_facility.point.operating_hours_stop IS 'Should be an array of length 7, index 0 is Monday, index 6 is Sunday';

--Here import the data from the old schema
INSERT INTO health_facility.point (
  global_id, version_id, is_deleted,
    boundary_polygon, geom, name,
    synonyms, equipment, services,
    mp_status, level_of_care, maturity_level, 

    parent, --transport, 
    frequency, type,
       
    properties
)
SELECT 
  global_id, version_id, is_deleted,
    boundary_polygon, geom, name,
    synonyms, equipment, ARRAY['Routine Immunization']::hf_services[],
    'Not Started', type::text::hf_level_of_care as level_of_care, 
    maturity_level::text::hf_maturity_level, --type as primary_type,
    
    parent, --transport, 
    frequency, strategy::text::hf_type as type,
       
    properties
FROM health_facility.data_all;

CREATE INDEX point_geom ON
    health_facility.point USING GIST (geom);

CREATE INDEX point_boundary_polygon ON
    health_facility.point (boundary_polygon);



DROP MATERIALIZED VIEW IF EXISTS health_facility.point_latest;


-- Useful when running this by hand
--ALTER MATERIALIZED VIEW health_facility.point_latest  OWNER TO "gmt_dev";

DROP TABLE health_facility.data_all;