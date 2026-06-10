CREATE TYPE sn_problematic AS ENUM (
  'Unknown',
  'Security Compromised',
  'Slum',
  --Note these are fixed via 000031.000001_settlements.sql
  'Densly Populated',
   --'Hard To Reach',
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
  'Other'
);

--drop settlement_name_accessibility_type

CREATE TYPE sn_uninhabited_reason AS ENUM (
  'Unknown',
  'Abandoned',
  'Destroyed',
  'No settlement',
  'Other'
);


--save space
DROP MATERIALIZED VIEW IF EXISTS settlement.name_latest;
DROP MATERIALIZED VIEW IF EXISTS settlement.part_latest;
DROP MATERIALIZED VIEW IF EXISTS settlement.polygon_latest;

ALTER TABLE settlement.name 
DROP COLUMN inaccessible_reasons;

ALTER TABLE settlement.name 
ADD COLUMN problematic sn_problematic[] NOT NULL DEFAULT array[]::sn_problematic[];

ALTER TABLE settlement.name 
ADD COLUMN uninhabited_reason sn_uninhabited_reason;
