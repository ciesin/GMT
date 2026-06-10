from typing import Dict

IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_BEFORE_PILOT = "Count of settlement names in GMT database BEFORE Pilot"
IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_AFTER_PILOT = "Count of settlement names in GMT database AFTER Pilot"

IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_DELETED_OR_DEMOTED = "Count of settlement names in GMT database AFTER Pilot that have been deleted or made non primary"

IND_SETTLEMENT_NAMES_IN_GRID3_DB_GEOPODE = "Count of settlement names in GRID3 DB (GeoPoDe)"
IND_NEW_SETTLEMENTS_ADDED_IN_GMT = "Count of new settlements added in GMT"
IND_SETTLEMENTS_WITH_UPDATED_NAMES = "Count of settlements with updated names"
IND_SETTLEMENTS_WITH_UPDATED_LOCATION = "Count of settlements with updated location"
IND_SETTLEMENTS_WITH_ALTERNATIVE_NAMES_ADDED = "Count of settlements with alternative names added"
IND_HARD_TO_REACH_SETTLEMENTS_GMT = "Count of Hard to Reach settlements (GMT)"
IND_NOMADIC_SETTLEMENTS_GMT = "Count of Nomadic settlements (GMT)"
IND_RIVERINE_SETTLEMENTS_GMT = "Count of Riverine settlements (GMT)"
IND_SETTLEMENTS_IN_GMT_TO_BE_ABANDONED_NOT_EXIST_ANYMORE = "Count of settlements in GMT to be abandoned / not exist anymore?"
IND_SETTLEMENTS_IN_FIXED_CATCHMENT_BEFORE_PILOT = "Count of settlements in fixed catchment BEFORE Pilot"
IND_SETTLEMENTS_IN_FIXED_CATCHMENT_AFTER_PILOT = "Count of settlements in fixed catchment AFTER Pilot"
IND_SETTLEMENT_IN_OUTREACH_CATCHMENT = "Count of settlement in outreach catchment"
IND_SETTLEMENTS_UNCOVERED_MOBILE_BEFORE_PILOT = "Count of settlements uncovered/mobile BEFORE Pilot"
IND_SETTLEMENTS_UNCOVERED_MOBILE_AFTER_PILOT = "Count of settlements uncovered/mobile AFTER Pilot"
IND_SETTLEMENTS_EXCLUDED_FROM_FIXED_POST_AND_ARE_NOW_UNCLAIMED = "Count of settlements excluded from fixed post and are now unclaimed"
IND_SETTLEMENTS_EXCLUDED_FROM_FIXED_POST_AND_ARE_NOW_CUSTOM_CATCHMENTS_OF_THE_SAME_HF = "Count of settlements excluded from fixed post and are now custom catchments of the same HF"
IND_SETTLEMENTS_EXCLUDED_FROM_FIXED_POST_AND_ARE_NOW_CUSTOM_CATCHMENTS_OF_ANOTHER_HF = "Count of settlements excluded from fixed post and are now custom catchments of another HF"
IND_SETTLEMENTS_EXCLUDED_FROM_OUTREACH_AND_ARE_NOW_UNCLAIMED = "Count of settlements excluded from outreach and are now unclaimed"
IND_SETTLEMENTS_EXCLUDED_FROM_OUTREACH_AND_ARE_NOW_CUSTOM_CATCHMENTS_OF_THE_SAME_HF = "Count of settlements excluded from outreach and are now custom catchments of the same HF"
IND_SETTLEMENTS_EXCLUDED_FROM_OUTREACH_AND_ARE_NOW_CUSTOM_CATCHMENTS_OF_ANOTHER_HF = "Count of settlements excluded from outreach and are now custom catchments of another HF"

IND_SETTLEMENTS_WITH_LESS_THAN_2KM_BEFORE_PILOT_WITHIN_FP_ALL_HF = "Count of settlements within <2km of a Fixed Post doing Routine Immunization BEFORE Pilot "
IND_SETTLEMENTS_WITH_LESS_THAN_2KM_AFTER_PILOT_WITHIN_FP_ALL_HF = "Count of settlements within <2km of a Fixed Post doing Routine Immunization AFTER Pilot"
IND_SETTLEMENTS_WITH_2_5KM_BEFORE_PILOT_WITHIN_FP_ALL_HF = "Count of settlements between 2 and 5km of a Fixed Post doing Routine Immunization BEFORE Pilot"
IND_SETTLEMENTS_WITH_2_5KM_AFTER_PILOT_WITHIN_FP_ALL_HF = "Count of settlements between 2 and 5km of a Fixed Post doing Routine Immunization AFTER Pilot"
IND_SETTLEMENTS_WITH_MORE_THAN_5KM_BEFORE_PILOT_WITHIN_FP_ALL_HF = "Count of settlements further than 5km of a Fixed Post doing Routine Immunization BEFORE Pilot"
IND_SETTLEMENTS_WITH_MORE_THAN_5KM_AFTER_PILOT_WITHIN_FP_ALL_HF = "Count of settlements further than 5km of a Fixed Post doing Routine Immunization AFTER Pilot"


IND_SETTLEMENTS_WITH_CHANGED_BOUNDARY = "Count of settlements that have changed the ward attribute"

IND_FP_GRID3_GEOPODE = "Count of fixed posts before the pilot in the Grid3 DB"
IND_FP_BEFORE_PILOT = "Count of fixed posts before the pilot in the GMT DB"
IND_FP_AFTER_PILOT = "Count of fixed posts after the pilot in the GMT DB"

IND_FP_THAT_ARE_DOING_RI = "Count of fixed posts after the pilot that are doing Routine Immunization"
IND_FP_NOT_DOING_RI = "Count of fixed posts after the pilot that are NOT doing Routine Immunization"

IND_FP_WITH_UPDATED_NAMES = "Count of fixed posts with updated names"

IND_FP_NEW = "Count of new fixed posts"
IND_FP_WITH_UPDATED_LOCATIONS = "Count of fixed posts with updated locations"

IND_FP_WITH_CHANGED_BOUNDARY = "Count of fixed posts that have changed the ward attribute"

IND_FP_DELETED = "Count of fixed posts that have been deleted"

IND_ALL_OUTREACH_LOCATIONS = "Count of all outreach sites"
IND_DEFAULT_OUTREACH_LOCATIONS = "Count of outreach sites with the default catchment"
IND_CUSTOM_OUTREACH_LOCATIONS = "Count of outreach sites with a custom catchment"
IND_DUPLICATED_OUTREACH_NAMES = "Count of duplicated outreach names"
INDICATOR_COUNT_OUTREACH_SITES_WITH_0_POPULATION = "Count outreach sites with 0 population"
IND_OUTREACHES_THAT_ARE_CLOSER_THAN_X_M_FROM_EACH_OTHER = "Count of outreach sites that are closer than 500 meters from each other"

IND_BOUNDARY_ADJUSTMENTS_TO_THE_WARD_BOUNDARY = "Count of boundary adjustments to the Ward boundary"
IND_BOUNDARY_ADJUSTMENTS_TO_THE_LGA_BOUNDARY = "Count of boundary adjustments to the LGA boundary"
IND_BOUNDARY_ADJUSTMENT_TO_THE_STATE_BOUNDARY = "Count of boundary adjustment to the State boundary"

def build_set_short_name_map():
    # Create a dictionary to map long indicator names to short names
    short_name_map = {
        IND_SETTLEMENT_NAMES_IN_GRID3_DB_GEOPODE:                                              "settlements_grid3_geopode",
        IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_BEFORE_PILOT:                                     "settlements_before_pilot",
        IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_AFTER_PILOT:                                      "settlements_after_pilot",
        IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_DELETED_OR_DEMOTED:                               "settlements_deleted_or_non_primary_after_pilot",
        IND_NEW_SETTLEMENTS_ADDED_IN_GMT:                                                      "settlements_new_settlements_after_pilot",
        IND_SETTLEMENTS_WITH_UPDATED_NAMES:                                                    "settlements_updated_names_after_pilot",
        IND_SETTLEMENTS_WITH_UPDATED_LOCATION:                                                 "settlements_updated_location_after_pilot",
        IND_SETTLEMENTS_WITH_ALTERNATIVE_NAMES_ADDED:                                          "settlements_alternative_names_added_after_pilot",
        IND_HARD_TO_REACH_SETTLEMENTS_GMT:                                                     "settlements_hard_to_reach_after_pilot",
        IND_NOMADIC_SETTLEMENTS_GMT:                                                           "settlements_nomadic_after_pilot",
        IND_RIVERINE_SETTLEMENTS_GMT:                                                          "settlements_riverine_after_pilot",
        IND_SETTLEMENTS_IN_GMT_TO_BE_ABANDONED_NOT_EXIST_ANYMORE:                              "settlements_uninhabited_after_pilot",
        IND_SETTLEMENTS_IN_FIXED_CATCHMENT_BEFORE_PILOT:                                       "settlements_in_fixed_post_catchment_before_pilot",
        IND_SETTLEMENTS_IN_FIXED_CATCHMENT_AFTER_PILOT:                                        "settlements_in_fixed_post_catchment_after_pilot",
        IND_SETTLEMENT_IN_OUTREACH_CATCHMENT:                                                  "settlements_in_outreach_catchment_after_pilot",
        IND_SETTLEMENTS_UNCOVERED_MOBILE_BEFORE_PILOT:                                         "settlements_uncovered_mobile_before_pilot",
        IND_SETTLEMENTS_UNCOVERED_MOBILE_AFTER_PILOT:                                          "settlements_uncovered_mobile_after_pilot",
        IND_SETTLEMENTS_EXCLUDED_FROM_FIXED_POST_AND_ARE_NOW_UNCLAIMED:                        "settlements_excluded_fixed_post_unclaimed_after_pilot",
        IND_SETTLEMENTS_EXCLUDED_FROM_FIXED_POST_AND_ARE_NOW_CUSTOM_CATCHMENTS_OF_THE_SAME_HF: "settlements_excluded_fixed_post_in_custom_same_hf_after_pilot",
        IND_SETTLEMENTS_EXCLUDED_FROM_FIXED_POST_AND_ARE_NOW_CUSTOM_CATCHMENTS_OF_ANOTHER_HF:  "settlements_excluded_fixed_post_in_custom_diff_hf_after_pilot",
        IND_SETTLEMENTS_EXCLUDED_FROM_OUTREACH_AND_ARE_NOW_UNCLAIMED:                          "settlements_excluded_outreach_unclaimed_after_pilot",
        IND_SETTLEMENTS_EXCLUDED_FROM_OUTREACH_AND_ARE_NOW_CUSTOM_CATCHMENTS_OF_THE_SAME_HF:   "settlements_excluded_outreach_in_custom_same_hf_after_pilot",
        IND_SETTLEMENTS_EXCLUDED_FROM_OUTREACH_AND_ARE_NOW_CUSTOM_CATCHMENTS_OF_ANOTHER_HF:    "settlements_excluded_outreach_in_custom_diff_hf_after_pilot",
        IND_SETTLEMENTS_WITH_LESS_THAN_2KM_BEFORE_PILOT_WITHIN_FP_ALL_HF:                      "settlements_less_than_2km_ri_fp_before_pilot",
        IND_SETTLEMENTS_WITH_LESS_THAN_2KM_AFTER_PILOT_WITHIN_FP_ALL_HF:                       "settlements_less_than_2km_ri_fp_after_pilot",
        IND_SETTLEMENTS_WITH_2_5KM_BEFORE_PILOT_WITHIN_FP_ALL_HF:                              "settlements_bet_2_5km_ri_fp_before_pilot",
        IND_SETTLEMENTS_WITH_2_5KM_AFTER_PILOT_WITHIN_FP_ALL_HF:                               "settlements_bet_2_5km_ri_fp_after_pilot",
        IND_SETTLEMENTS_WITH_MORE_THAN_5KM_BEFORE_PILOT_WITHIN_FP_ALL_HF:                      "settlements_more_than_5km_ri_fp_before_pilot",
        IND_SETTLEMENTS_WITH_MORE_THAN_5KM_AFTER_PILOT_WITHIN_FP_ALL_HF:                       "settlements_more_than_5km_ri_fp_after_pilot",
        IND_SETTLEMENTS_WITH_CHANGED_BOUNDARY:                                                 "settlements_changed_boundary_after_pilot"
    }

    return short_name_map


def build_hf_short_name_map() -> Dict[str,str]:
    hf_short_name_map = {

        IND_FP_GRID3_GEOPODE: "fixed_post_grid3_geopode",
        IND_FP_BEFORE_PILOT: "fixed_post_before_pilot",
        IND_FP_AFTER_PILOT:  "fixed_post_after_pilot",

        IND_FP_THAT_ARE_DOING_RI: "fixed_post_ri_after_pilot",
        IND_FP_NOT_DOING_RI: "fixed_post_not_ri_after_pilot",
        IND_FP_WITH_UPDATED_NAMES: "fixed_post_updated_names_after_pilot",
        IND_FP_NEW: "fixed_post_new_after_pilot",
        IND_FP_WITH_UPDATED_LOCATIONS: "fixed_post_updated_locations_after_pilot",
        IND_FP_WITH_CHANGED_BOUNDARY: "fixed_post_changed_boundary_after_pilot",
        IND_FP_DELETED: "fixed_post_deleted_after_pilot",

        IND_ALL_OUTREACH_LOCATIONS: "outreach_all_after_pilot",        
        IND_DEFAULT_OUTREACH_LOCATIONS: "outreach_default_catchment_after_pilot",
        IND_CUSTOM_OUTREACH_LOCATIONS: "outreach_custom_catchment_after_pilot",
        IND_DUPLICATED_OUTREACH_NAMES: "outreach_duplicated_names_after_pilot",
        INDICATOR_COUNT_OUTREACH_SITES_WITH_0_POPULATION: "outreach_zero_population_count_after_pilot",
        IND_OUTREACHES_THAT_ARE_CLOSER_THAN_X_M_FROM_EACH_OTHER: "outreach_closer_than_500_m_count_after_pilot",
        
    }
    return hf_short_name_map

def build_b_short_name_map():
    b_short_name_map = {
        IND_BOUNDARY_ADJUSTMENTS_TO_THE_WARD_BOUNDARY: "boundary_adjustment_ward_after_pilot",
        IND_BOUNDARY_ADJUSTMENTS_TO_THE_LGA_BOUNDARY: "boundary_adjustment_lga_after_pilot",
        IND_BOUNDARY_ADJUSTMENT_TO_THE_STATE_BOUNDARY: "boundary_adjustment_state_after_pilot",
    }
    return b_short_name_map

