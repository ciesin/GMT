export enum SchemaName {
  boundary = "boundary",
  settlement = "settlement",
  ri = "ri",
  generic = "generic",
  health_facility = "health_facility",
  partitions = "partitions",
}

export enum BasicTableName {
  polygon_edited = "polygon_edited",
  polygon = "polygon",
  point = "point",
  name = "name",
}


export const Tables = {
    boundary_all: `${SchemaName.boundary}.${BasicTableName.polygon}`,
    boundary_latest: `${SchemaName.boundary}.${BasicTableName.polygon}_latest`,
    boundary_edited: `${SchemaName.boundary}.${BasicTableName.polygon}_edited`,
    indicators_boundary: 'indicators.boundary',
    partitions_boundary_id: `${SchemaName.partitions}.boundary_id`,
    partitions_settlement_part: `${SchemaName.partitions}_settlement_part`,
    partitions_settlement_name: `${SchemaName.partitions}_settlement_name`,
    partitions_ri_catchment_item: `${SchemaName.partitions}_ri_catchment_item`,
    settlement_part: 'settlement_part',
    settlement_name: 'settlement_name',
    ri_catchment_item: 'ri_catchment_item',
    auth_geo_permissions: 'auth.geo_permission',
    auth_permissions: 'auth.permission',
    auth_role: 'auth.role',
    auth_role_permission: 'auth.role_permission',
    users: 'public.user_entity',
};
