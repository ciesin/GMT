from scripts.export_module.db_constants import *
import scripts.export_module.indicator_constants as ic
from scripts.export_module.general.views import create_view_with_filter_helper, lateral_boundary_join, exists_select, \
    db_round
import psycopg2.extensions

def create_view_hf_with_filter_helper(
        conn: psycopg2.extensions.connection,
        hf_short_name_map: Dict[str,str],
        indicator_name: str,
        source_table_name: str,
        sql_where_clause: str,
) -> bool:
    """
    For views that just need a simple filter 
    """
    return create_view_with_filter_helper(conn, 
                                          indicator_name, 
                                          source_table_name,
                                          hf_short_name_map,
                                          sql_where_clause)
    
    
def create_view_gmt_hf_updated_location(
    conn: psycopg2.extensions.connection,
    hf_short_name_map: Dict[str,str],
    indicator_name: str) -> bool:
    """
    In before and in after with location different
    Return true if created
    """
    if indicator_name != ic.IND_FP_WITH_UPDATED_LOCATIONS: 
        return False

    table_name = hf_short_name_map[indicator_name]

    view_sql = f"""
        CREATE VIEW {SCHEMA_EXPORT}.{table_name} AS
        SELECT a.* FROM {SCHEMA_EXPORT}.{TABLE_GMT_HF_BASE} a 
        WHERE EXISTS (
            SELECT 1 FROM {SCHEMA_EXPORT}.{TABLE_GMT_HF_BASE} b 
            WHERE b.global_id = a.global_id
                  AND b.tag = 'before_pilot'
                  AND NOT b.is_deleted
                  --Can give false negatives
                  --AND NOT ST_Equals(a.geom, b.geom)
                  --More than 0.1 meters difference
                  AND ST_Distance(a.geom::geography, b.geom::geography) > 0.1
        )
        AND a.tag = 'after_pilot'
        AND type = 'fixed_post'
        AND NOT a.is_deleted
        """
    with conn.cursor() as cur:
        cur.execute(view_sql)
        conn.commit()

    return True


def create_view_gmt_hf_dup_outreach_name(
    conn: psycopg2.extensions.connection,
    hf_short_name_map: Dict[str,str],
    indicator_name: str) -> bool:
    """
    In before and in after with location different
    Return true if created
    """
    if indicator_name != ic.IND_DUPLICATED_OUTREACH_NAMES:
        return False

    table_name = hf_short_name_map[indicator_name]

    view_sql = f"""
        CREATE VIEW {SCHEMA_EXPORT}.{table_name} AS
        SELECT a1.* FROM {SCHEMA_EXPORT}.{TABLE_GMT_OUTREACH_BASE} a1 
        WHERE EXISTS (
            SELECT 1 FROM {SCHEMA_EXPORT}.{TABLE_GMT_OUTREACH_BASE} a2 
            WHERE a1.global_id != a2.global_id
                  AND a1.name = a2.name
                  --Add boundary restriction, dups in same ward
                  AND a1.b3_guid = a2.b3_guid
                  AND a2.tag = 'after_pilot'
                  AND NOT a2.is_deleted
        )
        AND a1.tag = 'after_pilot'
        AND NOT a1.is_deleted
        """
    with conn.cursor() as cur:
        cur.execute(view_sql)
        conn.commit()

    return True


def create_view_gmt_added_hf(
        conn: psycopg2.extensions.connection,
        hf_short_name_map: Dict[str,str],
        indicator_name: str) -> bool:
    """
    In after but not before
    Return true if created
    """
    if indicator_name != ic.IND_FP_NEW:
        return False

    view_name = hf_short_name_map[indicator_name]

    view_sql = f"""
        CREATE VIEW {SCHEMA_EXPORT}.{view_name} AS
        SELECT * FROM {SCHEMA_EXPORT}.{TABLE_GMT_FP_BASE} a 
        WHERE NOT EXISTS (
            SELECT 1 FROM {SCHEMA_EXPORT}.{TABLE_GMT_FP_BASE} b 
            WHERE b.global_id = a.global_id
                AND b.tag = 'before_pilot'
                AND NOT b.is_deleted
        )
        AND a.tag = 'after_pilot'
        AND a.type = 'fixed_post'
        AND NOT a.is_deleted
        """
    with conn.cursor() as cur:
        cur.execute(view_sql)
        conn.commit()

    return True


def create_view_hf_deleted(
        conn: psycopg2.extensions.connection,
        hf_short_name_map: Dict[str,str],
        indicator_name: str) -> bool:
    """
    Because a HF can be deleted with the Kano & Kaduna updates,
    we want the indicator to mean deleted by the user 
    So this needs to be in a part of before pilot as well
    as having the is_deleted flag
    """
    if indicator_name != ic.IND_FP_DELETED:
        return False

    view_name = hf_short_name_map[indicator_name]

    table_name = TABLE_GMT_FP_BASE
    
    view_sql = f"""
        CREATE VIEW {SCHEMA_EXPORT}.{view_name} AS
        SELECT a.* FROM {SCHEMA_EXPORT}.{table_name} a 
        WHERE EXISTS (
            SELECT 1 FROM {SCHEMA_EXPORT}.{table_name} b 
            WHERE b.global_id = a.global_id
                AND b.tag = 'before_pilot'
        )
        AND a.is_deleted
        """
    with conn.cursor() as cur:
        cur.execute(view_sql)
        conn.commit()

    return True


def create_view_gmt_hf_updated_names(
        conn: psycopg2.extensions.connection,
        hf_short_name_map: Dict[str,str],
        indicator_name: str) -> bool:
    """
    In before and in after with name different
    Return true if created
    """
    if indicator_name != ic.IND_FP_WITH_UPDATED_NAMES:
        return False

    table_name = hf_short_name_map[indicator_name]

    view_sql = f"""
        CREATE VIEW {SCHEMA_EXPORT}.{table_name} AS
        SELECT a.* 
        FROM {SCHEMA_EXPORT}.{TABLE_GMT_HF_BASE} a 
        WHERE EXISTS (
            SELECT 1 FROM {SCHEMA_EXPORT}.{TABLE_GMT_HF_BASE} b 
            WHERE b.global_id = a.global_id
                  AND b.name != a.name
                  AND b.tag = 'before_pilot'
                  AND NOT b.is_deleted
        )
        AND a.tag = 'after_pilot'
        AND type = 'fixed_post'
        AND NOT is_deleted
        """
    with conn.cursor() as cur:
        cur.execute(view_sql)
        conn.commit()

    return True



def create_hf_indicator_views(
    conn: psycopg2.extensions.connection,
    hf_short_name_map: Dict[str,str],
    indicator_name: str):
    """
    All tables were cretade with create_hf_tables
    The indicators are all views
    """

    if create_view_gmt_added_hf(conn, hf_short_name_map, indicator_name):
        return

    if create_view_gmt_hf_updated_names(conn, hf_short_name_map, indicator_name):
        return

    if create_view_gmt_hf_updated_location(conn, hf_short_name_map, indicator_name):
        return

    if create_view_gmt_hf_dup_outreach_name(conn, hf_short_name_map, indicator_name):
        return

    if indicator_name == ic.IND_FP_GRID3_GEOPODE:
        create_view_hf_with_filter_helper(
            conn, hf_short_name_map, 
            indicator_name,
            TABLE_GMT_FP_BASE,
            "NOT is_deleted AND tag='grid3_geopode'"
        )
    elif indicator_name == ic.IND_FP_BEFORE_PILOT:
        create_view_hf_with_filter_helper(
            conn, hf_short_name_map, 
            indicator_name,
            TABLE_GMT_FP_BASE,
            "tag='before_pilot' AND NOT is_deleted"
        )
    elif indicator_name == ic.IND_FP_AFTER_PILOT:
        create_view_hf_with_filter_helper(
            conn, hf_short_name_map, 
            indicator_name,
            TABLE_GMT_FP_BASE,
            "tag='after_pilot' AND NOT is_deleted"
        )
    elif indicator_name == ic.IND_FP_THAT_ARE_DOING_RI:
        create_view_hf_with_filter_helper(
            conn, hf_short_name_map, 
            indicator_name,
            TABLE_GMT_FP_BASE,
            "tag='after_pilot' AND has_ri AND NOT is_deleted"
        )
    elif indicator_name == ic.IND_FP_NOT_DOING_RI:
        create_view_hf_with_filter_helper(
            conn, hf_short_name_map, 
            indicator_name,
            TABLE_GMT_FP_BASE,
            "tag='after_pilot' AND NOT has_ri AND NOT is_deleted"
        )
    elif indicator_name == ic.IND_ALL_OUTREACH_LOCATIONS:
        create_view_hf_with_filter_helper(
            conn, hf_short_name_map, 
            indicator_name,
            TABLE_GMT_OUTREACH_BASE,
            "tag='after_pilot' AND NOT is_deleted"
        )
    elif indicator_name == ic.IND_DEFAULT_OUTREACH_LOCATIONS:
        create_view_hf_with_filter_helper(
            conn, hf_short_name_map, 
            indicator_name,
            TABLE_GMT_OUTREACH_BASE,
            "tag='after_pilot' AND NOT has_explicit_include AND NOT is_deleted"
        )
    elif indicator_name == ic.IND_CUSTOM_OUTREACH_LOCATIONS:
        create_view_hf_with_filter_helper(
            conn, hf_short_name_map, 
            indicator_name,
            TABLE_GMT_OUTREACH_BASE,
            "tag='after_pilot' AND has_explicit_include AND NOT is_deleted"
        )
    elif indicator_name == ic.INDICATOR_COUNT_OUTREACH_SITES_WITH_0_POPULATION:
        create_view_hf_with_filter_helper(
            conn, hf_short_name_map, 
            indicator_name,
            TABLE_GMT_OUTREACH_BASE,
            "tag='after_pilot' AND computed_catchment_pop <= 0.5 AND NOT is_deleted"
        )
    elif indicator_name == ic.IND_OUTREACHES_THAT_ARE_CLOSER_THAN_X_M_FROM_EACH_OTHER:
        create_view_hf_with_filter_helper(
            conn, hf_short_name_map, 
            indicator_name,
            TABLE_GMT_OUTREACH_BASE,
            "tag='after_pilot' AND dist_closest_outreach <= 500 AND NOT is_deleted"
        )
    elif indicator_name == ic.IND_FP_WITH_CHANGED_BOUNDARY:
        create_view_hf_with_filter_helper(
            conn, hf_short_name_map, 
            indicator_name,
            TABLE_GMT_FP_BASE,
            "tag='after_pilot' AND changed_boundary AND NOT is_deleted"
        )
    elif indicator_name in [ic.IND_FP_DELETED]:
        create_view_hf_deleted(
            conn, hf_short_name_map, 
            indicator_name
        )
    else:
        raise Exception(f"No view for {indicator_name}")

    
def create_view_health_facilities_fixed_post_after_pilot(
    conn: psycopg2.extensions.connection,
    hf_short_name_map: Dict[str,str],
):
    """
    Seperate from the indicators, adds a few fields to the
    after pilot view
    """
    
    view_sql = f"""
CREATE VIEW {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST} AS
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
        
        fp.name,
        alt_names,
        fp.level_of_care AS type,
       
        is_deleted as deleted,
        
        {db_round('computed_catchment_pop', 1)},
        has_ri,
        changed_boundary,

        {exists_select(TABLE_GMT_FP_BASE, 'fp', "AND g.tag = 'grid3_geopode'")}
        AS in_geopode,
        
        {exists_select(TABLE_GMT_FP_BASE, 'fp', "AND g.tag = 'before_pilot'")}
        AS before_pilot,
        
        NOT {exists_select(TABLE_GMT_FP_BASE, 'fp', "AND (g.tag = 'before_pilot' OR g.tag = 'grid3_geopode')")}        
        AS new_facility,
        
        {exists_select(hf_short_name_map[ic.IND_FP_WITH_UPDATED_LOCATIONS], 'fp')}
        AS updated_location,
        
        {exists_select(hf_short_name_map[ic.IND_FP_WITH_UPDATED_NAMES], 'fp')}
        AS updated_name,
        
        fp.outreach_count > 0 as outreach,
        
        {db_round('fp.dist_closest_outreach', 1)},
        
        fp.geom
    
    FROM {SCHEMA_EXPORT}.{TABLE_GMT_FP_BASE} fp
    {lateral_boundary_join(3, 'fp')}
    {lateral_boundary_join(2, 'fp')}
    {lateral_boundary_join(1, 'fp')}    
    WHERE fp.tag = 'after_pilot'
    ORDER BY fp.state_name, fp.lga_name, fp.ward_name, fp.name;
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.global_id IS 
    'Globally Unique Identifier of this Fixed Post Health Facility';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.version_id 
    IS 'Internal GMT version id.  Each time the user syncs their changes to the server, a unique id is created.  Higher version ids indicate later changes.';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.b1_guid IS 'Boundary Administration Level 1 (State) Globally Unique Identifier associated to this fixed post health facility by attribute';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.b2_guid IS 'Boundary Administration Level 2 (LGA) Globally Unique Identifier associated to this fixed post health facility by attribute';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.b3_guid IS 'Boundary Administration Level 3 (Ward) Globally Unique Identifier associated to this fixed post health facility by attribute';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.state_name 
    IS 'Boundary Administration Level 1 (State) Name associated to this Fixed Post Health Facility by attribute';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.lga_name
    IS 'Boundary Administration Level 2 (LGA) Name associated to this Fixed Post Health Facility by attribute';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.ward_name
    IS 'Boundary Administration Level 3 (Ward) Name associated to this Fixed Post Health Facility by attribute';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.geo_state_name
    IS 'Boundary Administration Level 1 (State) Name that geospatially intersects this Fixed Post Health Facility';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.geo_lga_name
    IS 'Boundary Administration Level 2 (LGA) Name that geospatially intersects this Fixed Post Health Facility';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.geo_ward_name
    IS 'Boundary Administration Level 3 (Ward) Name that geospatially intersects this Fixed Post Health Facility';

    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.name
    IS 'Name of this Fixed Post Health Facility';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.alt_names
    IS 'Alterative Names of this Fixed Post Health Facility.  Note if more than one, will be joined by comma, for example: ''Alt Name 1, Alt Name 2, A third alternative name''';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.type
    IS 'Type of this Fixed Post Health Facility, can be one of Unknown, Primary, Secondary, Tertiary, Other, Dispensary';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.deleted
    IS 'True if this Fixed Post Health Facility has been deleted.  Will not appear in the UI';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.computed_catchment_pop
    IS 'Catchment GIS Population based on the Worldpop v2.1 Population Estimates of only this Fixed Post Health Facility.  This does NOT include any population covered by this Fixed Posts Outreach Sites.  Will be 0 if this Fixed Post does not provide Routine Immunization Services.';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.has_ri
    IS 'If this Fixed Post Health Facility provides Routine Immunization Services';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.changed_boundary
    IS 'If this Fixed Post Health Facilities attributed Ward was changed during the pilot';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.in_geopode
    IS 'If this Fixed Post Health Facility was present in the Grid3/Geopode data.  This is determined via global_id';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.before_pilot
    IS 'If this Fixed Post Health Facility was present before the pilot.  This is determined via global_id';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.new_facility
    IS 'If this Fixed Post Health Facility was added during the pilot.  This is determined via global_id';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.updated_location
    IS 'If this Fixed Post Health Facility was moved during the pilot';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.updated_name
    IS 'If this Fixed Post Health Facility was renamed during the pilot';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.outreach
    IS 'If this Fixed Post Health Facilities has outreaches attributed to it.  Note the GIS Population covered by these outreaches is not counted in computed_catchment_pop';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_FIXED_POST}.dist_closest_outreach
    IS 'Distance in meters to the closest outreach site to this Fixed Post Health Facility.  Note this site can be attributed to another Fixed Post or be in a different boundary.';

"""

    with conn.cursor() as cur:
        cur.execute(view_sql)
        conn.commit()
        
        

def create_view_health_facilities_outreach_after_pilot(
    conn: psycopg2.extensions.connection,
):
    """
    Seperate from the indicators, adds a few fields to the
    after pilot view
    """
    
    view_sql = f"""
CREATE VIEW {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH} AS
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
        
        out.name,
        
        parent_hf as parent_hf_guid,
        sq_fp.name AS parent_hf_name,
        
        {db_round('out.dist_closest_outreach', 1)},
        {db_round('out.dist_parent', 1)},
        
        NOT out.has_explicit_include AS default_catchment,
        out.has_explicit_include AS custom_catchment,
        
        {db_round('out.computed_catchment_pop', 1)},
        
        out.computed_catchment_pop <= 0 as zero_pop,
        
        out.geom
    
    FROM {SCHEMA_EXPORT}.{TABLE_GMT_OUTREACH_BASE} out
    {lateral_boundary_join(3, 'out')}
    {lateral_boundary_join(2, 'out')}
    {lateral_boundary_join(1, 'out')}
    LEFT JOIN LATERAL (
        SELECT fp.name 
        FROM {SCHEMA_EXPORT}.{TABLE_GMT_FP_BASE} fp 
        WHERE fp.global_id = out.parent_hf
        LIMIT 1
    ) sq_fp ON TRUE
    WHERE out.tag = 'after_pilot'
        AND NOT is_deleted
    ORDER BY out.state_name, out.lga_name, out.ward_name, out.name;
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.global_id IS 
    'Globally Unique Identifier of this Outreach Site';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.version_id 
    IS 'Internal GMT version id.  Each time the user syncs their changes to the server, a unique id is created.  Higher version ids indicate later changes.';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.b1_guid 
    IS 'Boundary Administration Level 1 (State) Globally Unique Identifier associated to this Outreach Site by attribute';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.b2_guid 
    IS 'Boundary Administration Level 2 (LGA) Globally Unique Identifier associated to this Outreach Site by attribute';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.b3_guid 
    IS 'Boundary Administration Level 3 (Ward) Globally Unique Identifier associated to this Outreach Site by attribute';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.state_name 
    IS 'Boundary Administration Level 1 (State) Name associated to this Outreach Site by attribute';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.lga_name
    IS 'Boundary Administration Level 2 (LGA) Name associated to this Outreach Site by attribute';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.ward_name
    IS 'Boundary Administration Level 3 (Ward) Name associated to this Outreach Site by attribute';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.geo_state_name
    IS 'Boundary Administration Level 1 (State) Name that geospatially intersects this Outreach Site';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.geo_lga_name
    IS 'Boundary Administration Level 2 (LGA) Name that geospatially intersects this Outreach Site';
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.geo_ward_name
    IS 'Boundary Administration Level 3 (Ward) Name that geospatially intersects this Outreach Site';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.name
    IS 'Name of this Outreach Site';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.parent_hf_guid
    IS 'Globally Unique Identifier of the parent Fixed Post Health Facility of this Outreach Site';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.parent_hf_name
    IS 'Name of the parent Fixed Post Health Facility of this Outreach Site';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.dist_closest_outreach
    IS 'Distance in meters to the closest outreach site to this Outreach Site.  Note this site can be attributed to another Fixed Post or be in a different boundary.';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.dist_parent
    IS 'Distance in meters from this Outreach Site to its parent Fixed Post Health Facility';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.default_catchment
    IS 'True if the population covered by this Outreach Site is calculated automatically using factors such as distance and frequency.';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.custom_catchment
    IS 'True if the population covered by this Outreach Site was chosen explicitly by either having created a new settlement specifically for this Outreach Site during its creation or by the user selecting which settlements this Outreach Site will cover.';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.computed_catchment_pop
    IS 'Catchment GIS Population based on the Worldpop v2.1 Population Estimates of this Outreach Site.';
    
    COMMENT ON COLUMN {SCHEMA_EXPORT}.{VIEW_HEALTH_FACILITIES_OUTREACH}.zero_pop
    IS 'True if the computed_catchment_pop is <= 0.  This can be due to settlements being marked as uninhabited, having too many other fixed posts or outreach sites nearby, or having a very infrequent frequency (such as 1x / month)';
    
"""

    with conn.cursor() as cur:
        cur.execute(view_sql)
        conn.commit()        