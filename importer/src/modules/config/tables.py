class Schemas:
    boundary: str = "boundary"
    boundary_edited: str = "boundary_edited"  # not fully correct to have this schema name but that was the simplest way to add to geometry export
    partitions: str = "partitions"
    partitions_settlement_part: str = "partitions_settlement_part"
    partitions_health_facility_point = "partitions_health_facility_point"
    partitions_settlement_name = "partitions_settlement_name"
    partitions_ri_catchment_item = "partitions_ri_catchment_item"


class SchemaTables:
    boundary_latest: str = f"{Schemas.boundary}.polygon_latest"
    boundary_edited_latest: str = f"{Schemas.boundary}.polygon_edited_latest"
    partitions_boundary_id: str = f"{Schemas.partitions}.boundary_id"
    partitions_settlement_part: str = (
        f"{Schemas.partitions_settlement_part}.{Schemas.partitions_settlement_part}"
    )
