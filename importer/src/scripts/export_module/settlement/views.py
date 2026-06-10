from scripts.export_module.db_constants import *
import psycopg2.extensions
import scripts.export_module.indicator_constants as ic
from scripts.export_module.general.views import create_view_with_filter_helper, lateral_boundary_join, exists_select, \
    db_round


def create_view_set_after_with_filter_helper(
        conn: psycopg2.extensions.connection,
        set_short_name_map: Dict[str,str],
        indicator_name: str, sql_where_clause: str) -> bool:
    """
    For views that just need a simple filter on the GMT Latest settlement table

    """
    return create_view_with_filter_helper(conn, indicator_name, 
                                          TABLE_SETTLEMENTS_GMT_AFTER_PILOT,
                                          set_short_name_map,
                                          sql_where_clause)
        

def create_view_set_before_with_filter_helper(
        conn: psycopg2.extensions.connection,
        set_short_name_map: Dict[str,str],
        indicator_name: str, sql_where_clause: str) -> bool:
    """
    For views that just need a simple filter on the GMT Latest settlement table

    """
    return create_view_with_filter_helper(conn, indicator_name, 
                                          TABLE_SETTLEMENTS_GMT_BEFORE_PILOT,
                                          set_short_name_map,
                                          sql_where_clause)


def create_view_gmt_set_updated_names(
        conn: psycopg2.extensions.connection,
        set_short_name_map: Dict[str,str],
        indicator_name: str) -> bool:
    """
    In before and in after with name different
    Return true if created
    """
    if indicator_name != ic.IND_SETTLEMENTS_WITH_UPDATED_NAMES:
        return False

    view_name = set_short_name_map[indicator_name]

    view_sql = f"""
        CREATE VIEW {SCHEMA_EXPORT}.{view_name} AS
        SELECT a.* FROM {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_AFTER_PILOT} a 
        WHERE EXISTS (
            SELECT 1 FROM {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_BEFORE_PILOT} b 
            WHERE b.global_id = a.global_id
                  AND b.name != a.name
        )
        """
    with conn.cursor() as cur:
        cur.execute(view_sql)
        conn.commit()

    return True


def create_view_gmt_set_updated_location(
        conn: psycopg2.extensions.connection,
        set_short_name_map: Dict[str, str],
        indicator_name: str) -> bool:
    """
    In before and in after with location different
    Return true if created
    """
    if indicator_name != ic.IND_SETTLEMENTS_WITH_UPDATED_LOCATION:
        return False

    view_name = set_short_name_map[indicator_name]

    view_sql = f"""
        CREATE VIEW {SCHEMA_EXPORT}.{view_name} AS
        SELECT a.* FROM {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_AFTER_PILOT} a 
        WHERE EXISTS (
            SELECT 1 FROM {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_BEFORE_PILOT} b 
            WHERE b.global_id = a.global_id
                    --Accuracy issues this can give false negatives
                  --AND NOT ST_Equals(a.geom, b.geom)                  
                  AND ST_Distance(a.geom::geography, b.geom::geography) > 0.1
        )
        """
    with conn.cursor() as cur:
        cur.execute(view_sql)
        conn.commit()

    return True


def create_view_gmt_added_set(
        conn: psycopg2.extensions.connection,
        set_short_name_map: Dict[str, str],
        indicator_name: str) -> bool:
    """
    In after but not before
    Return true if created
    """
    if indicator_name != ic.IND_NEW_SETTLEMENTS_ADDED_IN_GMT:
        return False

    view_name = set_short_name_map[indicator_name]

    view_sql = f"""
        CREATE VIEW {SCHEMA_EXPORT}.{view_name} AS
        SELECT * FROM {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_AFTER_PILOT} a 
        WHERE NOT EXISTS (
            SELECT 1 FROM {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_BEFORE_PILOT} b 
            WHERE b.global_id = a.global_id
        )
        """
    with conn.cursor() as cur:
        cur.execute(view_sql)
        conn.commit()

    return True


def create_settlement_indicator_views(
        conn: psycopg2.extensions.connection,
        set_short_name_map: Dict[str,str],
        indicator_name: str):

    if create_view_gmt_added_set(
        conn, set_short_name_map,
        indicator_name):
        return

    if create_view_gmt_set_updated_names(conn, set_short_name_map, indicator_name):
        return

    if create_view_gmt_set_updated_location(conn, set_short_name_map, indicator_name):
        return
    
    if indicator_name == ic.IND_SETTLEMENT_NAMES_IN_GRID3_DB_GEOPODE:
        create_view_with_filter_helper(
            conn, 
            indicator_name,
            TABLE_SETTLEMENTS_GEOPODE,
            set_short_name_map,
            "1=1"
        )
    elif indicator_name == ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_BEFORE_PILOT:
        create_view_with_filter_helper(
            conn, 
            indicator_name,
            TABLE_SETTLEMENTS_GMT_BEFORE_PILOT,
            set_short_name_map,
            "1=1"
        )    
    elif indicator_name == ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_AFTER_PILOT:
        create_view_with_filter_helper(
            conn, 
            indicator_name,
            TABLE_SETTLEMENTS_GMT_AFTER_PILOT,
            set_short_name_map,
            "1=1"
        )  
    elif indicator_name == ic.IND_SETTLEMENTS_WITH_ALTERNATIVE_NAMES_ADDED:
        create_view_set_after_with_filter_helper(conn, set_short_name_map, indicator_name, "LENGTH(a.alt_names) > 0")
    elif indicator_name == ic.IND_NOMADIC_SETTLEMENTS_GMT:
        create_view_set_after_with_filter_helper(conn, set_short_name_map, indicator_name, "a.nomadic")
    elif indicator_name == ic.IND_HARD_TO_REACH_SETTLEMENTS_GMT:
        create_view_set_after_with_filter_helper(conn, set_short_name_map, indicator_name, "a.hard_to_reach")
    elif indicator_name == ic.IND_RIVERINE_SETTLEMENTS_GMT:
        create_view_set_after_with_filter_helper(conn, set_short_name_map, indicator_name, "a.riverine")
    elif indicator_name == ic.IND_SETTLEMENTS_IN_GMT_TO_BE_ABANDONED_NOT_EXIST_ANYMORE:
        create_view_set_after_with_filter_helper(conn, set_short_name_map, indicator_name, "a.uninhabited")
    elif indicator_name == ic.IND_SETTLEMENT_IN_OUTREACH_CATCHMENT:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_pop_at_least("outreach_catchment_perc")
        )
    elif indicator_name == ic.IND_SETTLEMENTS_IN_FIXED_CATCHMENT_BEFORE_PILOT:
        create_view_set_before_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_pop_at_least("fixed_catchment_perc")
        )
    elif indicator_name == ic.IND_SETTLEMENTS_IN_FIXED_CATCHMENT_AFTER_PILOT:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_pop_at_least("fixed_catchment_perc")
        )
    elif indicator_name == ic.IND_SETTLEMENTS_UNCOVERED_MOBILE_BEFORE_PILOT:
        create_view_set_before_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_pop_at_least("uncovered_catchment_perc")
        )
    elif indicator_name == ic.IND_SETTLEMENTS_UNCOVERED_MOBILE_AFTER_PILOT:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_pop_at_least("uncovered_catchment_perc")
        )
    elif indicator_name == ic.IND_SETTLEMENTS_WITH_LESS_THAN_2KM_BEFORE_PILOT_WITHIN_FP_ALL_HF:
        create_view_set_before_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_hf_dist(None, 2000)
        )
    elif indicator_name == ic.IND_SETTLEMENTS_WITH_2_5KM_BEFORE_PILOT_WITHIN_FP_ALL_HF:
        create_view_set_before_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_hf_dist(2000, 5000)
        )
    elif indicator_name == ic.IND_SETTLEMENTS_WITH_MORE_THAN_5KM_BEFORE_PILOT_WITHIN_FP_ALL_HF:
        create_view_set_before_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_hf_dist(5000, None)
        )
    elif indicator_name == ic.IND_SETTLEMENTS_WITH_LESS_THAN_2KM_AFTER_PILOT_WITHIN_FP_ALL_HF:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_hf_dist(None, 2000)
        )
    elif indicator_name == ic.IND_SETTLEMENTS_WITH_2_5KM_AFTER_PILOT_WITHIN_FP_ALL_HF:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_hf_dist(2000, 5000)
        )
    elif indicator_name == ic.IND_SETTLEMENTS_WITH_MORE_THAN_5KM_AFTER_PILOT_WITHIN_FP_ALL_HF:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_hf_dist(5000, None)
        )
    elif indicator_name == ic.IND_SETTLEMENTS_EXCLUDED_FROM_FIXED_POST_AND_ARE_NOW_UNCLAIMED:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_pop_at_least("uncovered_catchment_perc") + " AND excluded_fixed_post"
        )
    elif indicator_name == ic.IND_SETTLEMENTS_EXCLUDED_FROM_FIXED_POST_AND_ARE_NOW_CUSTOM_CATCHMENTS_OF_THE_SAME_HF:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            "excluded_custom_same_fp"
        )
    elif indicator_name == ic.IND_SETTLEMENTS_EXCLUDED_FROM_FIXED_POST_AND_ARE_NOW_CUSTOM_CATCHMENTS_OF_ANOTHER_HF:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            "excluded_custom_diff_fp"
        )
    elif indicator_name == ic.IND_SETTLEMENTS_EXCLUDED_FROM_OUTREACH_AND_ARE_NOW_UNCLAIMED:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            where_clause_pop_at_least("uncovered_catchment_perc") + " AND excluded_outreach"
        )
    elif indicator_name == ic.IND_SETTLEMENTS_EXCLUDED_FROM_OUTREACH_AND_ARE_NOW_CUSTOM_CATCHMENTS_OF_THE_SAME_HF:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            "excluded_custom_same_outreach"
        )
    elif indicator_name == ic.IND_SETTLEMENTS_EXCLUDED_FROM_OUTREACH_AND_ARE_NOW_CUSTOM_CATCHMENTS_OF_ANOTHER_HF:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            "excluded_custom_diff_outreach"
        )
    elif indicator_name == ic.IND_SETTLEMENTS_WITH_CHANGED_BOUNDARY:
        create_view_set_after_with_filter_helper(
            conn, set_short_name_map,
            indicator_name,
            "changed_boundary"
        )
    elif indicator_name == ic.IND_SETTLEMENT_NAMES_IN_GMT_DATABASE_DELETED_OR_DEMOTED:
        create_view_with_filter_helper(
            conn, 
            indicator_name,
            TABLE_SETTLEMENTS_GMT_DELETED_DEMOTED,
            set_short_name_map,
            "1=1"
        )
    else:
        raise Exception(f"No view for {indicator_name}")



def where_clause_pop_at_least(perc_column: str, alias="", pop_lower_bound = 0.5):
    # at least 1 person using the greater of est or computed pop
    # either computed/estimated outreach catchment is more than 0.5 people
    # For uncovered / unclaimed, we use the same logic as the Excel export
    # in getMobileItems in sheet-hf-catchment.ts
    
    if len(alias) > 0:
        alias += "."
    
    return f"""
        GREATEST(
            COALESCE({alias}estimated_pop, 0),
            {alias}computed_pop
        ) * {alias}{perc_column} / 100.0 >= {pop_lower_bound}
    """


def where_clause_hf_dist(dist_lb, dist_ub):
    if dist_lb is None:
        return f"distance_closest_fp < {dist_ub}"
    if dist_ub is None:
        # if the distance is null, it implies there are none close by
        return f"COALESCE(distance_closest_fp, {dist_lb}+1) > {dist_lb}"
    else:
        return f"distance_closest_fp BETWEEN {dist_lb} AND {dist_ub}"


def create_view_settlements_after_pilot(
    conn: psycopg2.extensions.connection,
    set_short_name_map: Dict[str,str],
):
    """
    Seperate from the indicators, adds a few fields to the
    after pilot view
    """
    
    boundary_comment = "Attributed/Geospatial boundaries do not affect this calculation."
    
    view_sql = f"""
CREATE VIEW {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS} AS    
WITH after AS (
    SELECT 
        set.global_id,
        set.version_id,
        
        set.b1_guid,
        set.b2_guid,
        set.b3_guid,
        
        --attributed 
        set.state_name,
        set.lga_name,
        set.ward_name,
        
        --geospatial
        b1_geo.name AS geo_state_name,
        b2_geo.name AS geo_lga_name,
        b3_geo.name AS geo_ward_name,
        
        set.name,
        set.alt_names,
        
        set.estimated_pop,
        {db_round('set.computed_pop', 1)},
        
        {db_round( 'set.fixed_catchment_perc', 1)},
        {db_round('set.outreach_catchment_perc', 1)},
        {db_round('set.uncovered_catchment_perc', 1)},
                
        set.hard_to_reach,
        set.nomadic,
        set.riverine,
        set.uninhabited,
        
        set.excluded_fixed_post,
        set.excluded_outreach AS excluded_from_outreach,
        set.excluded_custom_same_outreach,
        set.excluded_custom_diff_outreach,
        set.excluded_custom_same_fp,
        set.excluded_custom_diff_fp,
        
        {db_round('set.distance_closest_fp', 1, 'distance_fp_after')}, 
        {db_round('set_before.distance_closest_fp', 1, 'distance_fp_before')},
        
        CASE WHEN set_before.fixed_catchment_perc > set_before.uncovered_catchment_perc THEN
            'fixed'
            WHEN set_before.uncovered_catchment_perc >= set_before.uncovered_catchment_perc THEN
            'mobile'
        ELSE NULL 
        END AS strategy_type_before,
        
        CASE WHEN 
            set.fixed_catchment_perc >= set.uncovered_catchment_perc AND
            set.fixed_catchment_perc >= set.outreach_catchment_perc 
        THEN 'fixed'
        WHEN set.outreach_catchment_perc >= set.uncovered_catchment_perc
        THEN 'outreach' 
        ELSE 'mobile' 
        END AS strategy_type_after,
        
        CASE WHEN set.in_custom_catchment THEN 'custom' ELSE 'default' END as catchment_type,
        
        {where_clause_pop_at_least('uncovered_catchment_perc', 'set')} as unclaimed_after,
        
        set.excluded_outreach AND {where_clause_pop_at_least('uncovered_catchment_perc', 'set')} as excluded_from_outreach_and_unclaimed,
        
        {exists_select(TABLE_SETTLEMENTS_GEOPODE, 'set')}
        AS in_geopode,
        
        
        {exists_select(TABLE_SETTLEMENTS_GMT_BEFORE_PILOT, 'set')} 
        AS before_pilot,
        
        NOT {exists_select(TABLE_SETTLEMENTS_GMT_BEFORE_PILOT, 'set')}
        AS new_settlement,
        
        {exists_select(set_short_name_map[ic.IND_SETTLEMENTS_WITH_UPDATED_LOCATION], 'set')}
        AS updated_location,
        
        {exists_select(set_short_name_map[ic.IND_SETTLEMENTS_WITH_UPDATED_NAMES], 'set')}
        AS updated_name,
        
        False AS deleted,
        
        set.geom
    
    FROM {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_AFTER_PILOT} set
    --Because of the unique global_id constraint, this is 0 or 1 row
    LEFT JOIN {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_BEFORE_PILOT} set_before
        ON set_before.global_id = set.global_id
    {lateral_boundary_join(3, 'set')}
    {lateral_boundary_join(2, 'set')}
    {lateral_boundary_join(1, 'set')}    
), deleted AS (
    SELECT global_id,
        version_id,
        
        b1_guid,
        b2_guid,
        b3_guid,
        
        --attributed 
        state_name,
        lga_name,
        ward_name,
        
        --geospatial
        b1_geo.name AS geo_state_name,
        b2_geo.name AS geo_lga_name,
        b3_geo.name AS geo_ward_name,
        
        set.name,
        NULL::text as alt_names,
        
        NULL::DOUBLE PRECISION as estimated_pop,
        NULL::DOUBLE PRECISION as computed_pop,
        
        NULL::DOUBLE PRECISION AS fixed_catchment_perc,
        NULL::DOUBLE PRECISION AS outreach_catchment_perc,
        NULL::DOUBLE PRECISION AS uncovered_catchment_perc,
        
        NULL::boolean AS hard_to_reach,
        NULL::boolean AS nomadic,
        NULL::boolean AS riverine,
        NULL::boolean AS uninhabited,
        
        NULL::boolean AS excluded_fixed_post,
        NULL::boolean AS excluded_from_outreach,
        NULL::boolean AS excluded_custom_same_outreach,
        NULL::boolean AS excluded_custom_diff_outreach,
        NULL::boolean AS excluded_custom_same_fp,
        NULL::boolean AS excluded_custom_diff_fp,
        
        NULL::DOUBLE PRECISION AS distance_fp_before,
        NULL::DOUBLE PRECISION AS distance_fp_after,
        
        NULL::text as strategy_type_before,
        NULL::text as strategy_type_after,
        
        'default' AS catchment_type,
        
        NULL::boolean AS unclaimed_after,
        NULL::boolean AS excluded_from_outreach_and_unclaimed,
        
        {exists_select(TABLE_SETTLEMENTS_GEOPODE, 'set')}
        AS in_geopode,
        
        
        {exists_select(TABLE_SETTLEMENTS_GMT_BEFORE_PILOT, 'set')} 
        AS before_pilot,
        
        NOT {exists_select(TABLE_SETTLEMENTS_GMT_BEFORE_PILOT, 'set')}
        AS new_settlement,
        
        {exists_select(set_short_name_map[ic.IND_SETTLEMENTS_WITH_UPDATED_LOCATION], 'set')}
        AS updated_location,
        
        {exists_select(set_short_name_map[ic.IND_SETTLEMENTS_WITH_UPDATED_NAMES], 'set')}
        AS updated_name,
        
        True AS deleted,
        
        set.geom
    
    FROM {SCHEMA_EXPORT}.{TABLE_SETTLEMENTS_GMT_DELETED_DEMOTED} set
    {lateral_boundary_join(3, 'set')}
    {lateral_boundary_join(2, 'set')}
    {lateral_boundary_join(1, 'set')}    
)    
--with done now the select    
    (
        SELECT * from after
    ) UNION ALL (
        SELECT * from deleted
    )
    ORDER BY state_name, lga_name, ward_name, name;
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.global_id IS 
    'Globally Unique Identifier of this Settlement';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.version_id 
    IS 'Internal GMT version id.  Each time the user syncs their changes to the server, a unique id is created.  Higher version ids indicate later changes.';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.b1_guid 
    IS 'Boundary Administration Level 1 (State) Globally Unique Identifier associated to this Settlement by attribute';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.b2_guid 
    IS 'Boundary Administration Level 2 (LGA) Globally Unique Identifier associated to this Settlement by attribute';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.b3_guid 
    IS 'Boundary Administration Level 3 (Ward) Globally Unique Identifier associated to this Settlement by attribute';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.state_name 
    IS 'Boundary Administration Level 1 (State) Name associated to this Settlement by attribute';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.lga_name
    IS 'Boundary Administration Level 2 (LGA) Name associated to this Settlement by attribute';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.ward_name
    IS 'Boundary Administration Level 3 (Ward) Name associated to this Settlement by attribute';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.geo_state_name
    IS 'Boundary Administration Level 1 (State) Name that geospatially intersects this Settlement';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.geo_lga_name
    IS 'Boundary Administration Level 2 (LGA) Name that geospatially intersects this Settlement';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.geo_ward_name
    IS 'Boundary Administration Level 3 (Ward) Name that geospatially intersects this Settlement';

    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.name
    IS 'Name of this Settlement';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.alt_names
    IS 'Alterative Names of this Settlement.  Note if more than one, will be joined by comma, for example: ''Alt Name 1, Alt Name 2, A third alternative name''';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.estimated_pop
    IS 'User entered population for this Settlement.  Ideally matches the REW population figure';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.computed_pop
    IS 'GIS Population based on the Worldpop v2.1 Population Estimates combined with this Settlement''s geometry.';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.fixed_catchment_perc
    IS '% between 0 and 100 of how much of this Settlement''s population is covered by a fixed post health facility';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.outreach_catchment_perc
    IS '% between 0 and 100 of how much of this Settlement''s population is covered by an outreach site';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.uncovered_catchment_perc
    IS '% between 0 and 100 of how much of this Settlement''s population not covered.  This can also be considered as ''Mobile'' since the assumption is non covered population is handled via mobile sites';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.hard_to_reach
    IS 'True if this Settlement has been flagged as Hard to Reach';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.nomadic
    IS 'True if this Settlement has been flagged as Nomadic';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.riverine
    IS 'True if this Settlement has been flagged as Riverine';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.uninhabited
    IS 'True if this Settlement has been flagged as Uninhabited.  Note the computed and estimated population will be 0 in this case';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.excluded_fixed_post
    IS 'True if any fixed post health facility has explicitly excluded this Settlement.  Note fixed_catchment_perc could still be greater than 0 due to another Fixed Post covering this Settlement.  {boundary_comment}';
     
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.excluded_from_outreach
    IS 'True if any outreach site has explicitly excluded this Settlement.  Note outreach_catchment_perc could still be greater than 0 due to another outreach site covering this Settlement.  {boundary_comment}';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.catchment_type
    IS 'Can be either ''custom'' or ''default''.  Custom means that this Settlement is in the custom catchment of an outreach site.';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.excluded_custom_same_outreach
    IS 'True if this Settlement has been explicitly excluded from an outreach site''s catchment and has been explicitly included (via custom catchment for example) by another outreach site whose parent fixed post health facility is the same as the outreach site that excluded this Settlement.  {boundary_comment}';
        
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.excluded_custom_diff_outreach
    IS 'True if this Settlement has been explicitly excluded from an outreach site''s catchment and has been explicitly included (via custom catchment for example) by another outreach site whose parent fixed post health facility is different than the outreach site that excluded this Settlement.  {boundary_comment}';
        
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.excluded_custom_same_fp
    IS 'True if this Settlement was explicitly excluded from a fixed post health facility but has been explicitly included in the catchment of an outreach site whose parent is that same fixed post health facility.  {boundary_comment}';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.excluded_custom_diff_fp
    IS 'True if this Settlement was explicitly excluded from a fixed post health facility but has been explicitly included in the catchment of an outreach site whose parent is different than the fixed post health facility that excluded this Settlement.  {boundary_comment}';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.distance_fp_after
    IS 'Distance in meters to the closest fixed post health facility using the settlement and health facility data after the pilot.  Note this is the distance to the settlement boundary.  If this is 0 it means the fixed post is located inside this Settlement.';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.distance_fp_before
    IS 'Distance in meters to the closest fixed post health facility using the settlement and health facility data before the pilot.  Will be blank if this Settlement did not exist before the pilot.  Note this is the distance to the settlement boundary.  If this is 0 it means the fixed post is located inside this Settlement.';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.strategy_type_before
    IS 'Can be either ''fixed'' or ''mobile''.  This can not be ''outreach'' because before the pilot, there were no outreach sites.  Important to note that this can be both, see the fields fixed_catchment_perc and uncovered_catchment_perc (aka mobile) for the precise distribution.  This field is determined by which percentage is greatest.';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.strategy_type_after
    IS 'Can be either ''fixed'', ''mobile'', or ''outreach'' using data after the pilot.  Important to note that this can a mix of all three: see the fields fixed_catchment_perc, outreach_catchment_perc and uncovered_catchment_perc (aka mobile) for the precise distribution.  This field is determined by which percentage is greatest.';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.unclaimed_after
    IS 'True if this Settlement is unclaimed after the pilot.  Note this is calculated via if uncovered_catchment_perc * the greater of computed_pop and estimated_pop is greater than 0.5.  Said another way, if at least one person is not covered by a fixed post or outreach site, this settlement is considered unclaimed';
        
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.excluded_from_outreach_and_unclaimed
    IS 'True if unclaimed_after is True and excluded_from_outreach is True';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.in_geopode
    IS 'If this Settlement was present in the Grid3/Geopode data.  This is determined via global_id';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.before_pilot
    IS 'If this Settlement was present before the pilot.  This is determined via global_id';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.new_settlement
    IS 'If this Settlement was added during the pilot.  This is determined via global_id';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.updated_location
    IS 'If this Settlement was moved during the pilot';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.updated_name
    IS 'If this Settlement was renamed during the pilot';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_SETTLEMENTS}.deleted
    IS 'True if this Settlement has been deleted.  Will not appear in the UI';


"""

    with conn.cursor() as cur:
        cur.execute(view_sql)
        conn.commit()