CREATE SCHEMA IF NOT EXISTS indicators;

DROP TABLE IF EXISTS indicators.boundary;

CREATE TABLE IF NOT EXISTS indicators.boundary
(

    boundary_polygon uuid PRIMARY KEY,
    --this is which data version/commit the indicators were calculated on
    version_id bigint,
    pop	float,	--Tot pop for boundary
    catchment_pop	float, --	Pop covered by catchments
    num_set_unclaimed	int, --	Nb Settlement unclaimed
    num_set_multiple_claimed	int,--	Nb Settlement multiple claimed
    num_set_total	int, --	all primary settlement name points attributed to boundary (not geospatial)
    num_set_unihab	int, --	number settlement uninhabited, used to calculate %
    num_hf	int, --	all hf attributed to boundary
    num_non_ri_hf	int, --	to calculate % non-RI HFs
    num_hf_mp_ready int, -- RI HF with catchment status == completed ; Microplan ready means (num_hf-num_non_ri_hf) == num_hf_mp_ready
    num_set_fdc_required int, --	Nb Settlement requiring FieldDataCollection, a settlement is a primary name point !
    num_hf_fdc_required	int --	Nb health facilities requiring FieldDataCollection
);


--
--ALTER TABLE indicators.boundary OWNER TO gmt_dev;