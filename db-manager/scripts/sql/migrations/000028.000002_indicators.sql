CREATE SCHEMA IF NOT EXISTS indicators;

DROP TABLE IF EXISTS indicators.boundary;

CREATE TABLE IF NOT EXISTS indicators.boundary
(

    boundary_polygon uuid PRIMARY KEY,
    --this is which data version/commit the indicators were calculated on
    version_id bigint,

    num_fp int, --number of fixed post (determined by boundary_polygon attribute)
    num_fp_ri int, --number of fixed post that do Routine Immuninization, note that outreach inherit from the parent
    num_fp_level_of_care int[], --categorized count of level of care field
    num_outreach int, --number of outreach sites
    num_fp_mp_ready int, -- RI HF with catchment status == completed ; Microplan ready means (num_hf-num_non_ri_hf) == num_hf_mp_ready


    num_fp_participate int, --num_fp of boundarings with participating flag set to true
    num_fp_mp_ready_participate int, --num_fp_mp_ready of boundarings with participating flag set to true

    --Settlements are settlement names, which should be 1 to 1 with a part
    num_set_total	int, --	all primary settlement name points attributed to boundary (not geospatial)
    num_set_mgn int, --number of settlements with a machine generated name
    num_set_prob int, --number of problematic settlements (contains any of the problematic flags)
    num_set_problematic int[], --categorized settlement counts (riverine, hard to reach, etc.)  Indexes are the sn_problematic values, a settlement can have many problematic values
    num_set_uninhabited int[], -- categorized count sn_uninhabited_reason, an uninhabited settlement only has 1 uninhabited reason
    num_set_pop_diff int, --How many settlements have a 'large' population diff between computed and estimated pop

    --Ward level metrics
    num_no_hf int, --number of boundaries that have no health facilities
    num_no_settlements int, --number of boundaries that have no settlements
    num_no_geometry int, --number of boundaries without a geometry
    num_boundary_corrections int, --number of boundary corrections

    boundary_pop	float,	--Tot pop for boundary, zonal stats
    catchment_pop_fp	float, --	Pop covered by fixed post health facilities
    catchment_pop_outreach	float, --	Pop covered by outreach health facilities 
    --Total catchment pop is the above 2 added

    catchment_pop_unclaimed float 
    
);

--
--ALTER TABLE indicators.boundary OWNER TO gmt_dev;

