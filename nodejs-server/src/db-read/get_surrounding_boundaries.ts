
/*
Accepts 1 parameter: boundary_code

Returns the GeoJSON of all boundaries that intersect that boundaries extent that has been
expanded by EXTENT_PADDING_METERS meters.

This returns boundaries that intersect at ALL levels, including the state.

The input is generally the boundaryId of a boundary being checkout out

This is by design !  Surrounding boundaries includes the parents
 */
import {EXTENT_PADDING_METERS, pool} from "./common";
import {SurroundingBoundaries} from "../server-interfaces/SurroundingBoundaries";
import {Boundary} from "../server-interfaces/Boundary";
import {get_current_version_id} from "./get_current_version";
import escape from "pg-escape";
import GMT_CONFIG from "../config/gmt.config";

export async function getSurroundingBoundariesGuids(boundaryId: string): Promise<Array<Boundary>>{
    let escaped_boundary_id = escape.literal(boundaryId);

    //console.log(`Retrieving boundary data Boundary Id: ${boundaryId}`);
    const {rows} = await pool.query(`
WITH selected_boundary AS 
(
    SELECT ST_Transform(ST_Envelope(b.geom), 3857) as geom_envelope, b.level
    FROM boundary.polygon_latest b 
    WHERE b.global_id = ${escaped_boundary_id}
), 
extended_extent AS 
(
    SELECT ST_Transform(ST_SetSRID(
        ST_MakeBox2D(
            ST_Point(
                ST_XMin(sb.geom_envelope) - ${EXTENT_PADDING_METERS},
                ST_YMin(sb.geom_envelope) - ${EXTENT_PADDING_METERS}
            ),
            ST_Point(
                ST_XMax(sb.geom_envelope) + ${EXTENT_PADDING_METERS},
                ST_YMax(sb.geom_envelope) + ${EXTENT_PADDING_METERS}
            )
        ), 3857), 4326) as geom FROM selected_boundary sb
)
    SELECT b.global_id, b.code, b.level
    from boundary.polygon_latest b,
         extended_extent ee 
    where ST_Intersects(ee.geom, b.geom);
`);

    // Make it so we have a single geojson with the properties rolled up
    return rows;
}

/**
 * Not these boundaries are retrieved using intersection but this logic fails nor admin0
 * boundary as in theory assigning country boundary should be enough
 *
 * @param boundaryId
 */
export async function getOnlySurroundingBoundariesGuids(boundaryId: string): Promise<Array<Boundary>>{
    let escaped_boundary_id = escape.literal(boundaryId);

    //console.log(`Retrieving boundary data Boundary Id: ${boundaryId}`);

    const {rows} = await pool.query(`
WITH selected_boundary AS (
    SELECT ST_Transform(ST_Envelope(b.geom), 3857) as geom_envelope, b.level, geom as boundary_geom
    FROM boundary.polygon b 
    WHERE b.global_id = ${escaped_boundary_id}
), extended_extent AS (
    SELECT ST_Transform(ST_SetSRID(
        ST_MakeBox2D(
            ST_Point(
                ST_XMin(sb.geom_envelope) - ${EXTENT_PADDING_METERS},
                ST_YMin(sb.geom_envelope) - ${EXTENT_PADDING_METERS}
            ),
            ST_Point(
                ST_XMax(sb.geom_envelope) + ${EXTENT_PADDING_METERS},
                ST_YMax(sb.geom_envelope) + ${EXTENT_PADDING_METERS}
            )
        ), 3857), 4326) as geom, boundary_geom FROM selected_boundary sb
)
            SELECT b.global_id, b.code, b.level
            from boundary.polygon_latest b,
                 extended_extent ee 
            where ST_Intersects(ee.geom, b.geom) AND 
                   -- if the area is intersecting more than 50%, consider it as the same area that we are 
                   -- querying and skip it (there are some issues with boundaries and boundary could be
                   -- intersecting less than 50% and still be child)
                  -- alternative is "not ST_Contains(ee.boundary_geom, b.geom)"
                  ST_Area(ST_Intersection(b.geom, ee.boundary_geom))/ST_Area(b.geom) <0.5 AND
                  b.level = ${GMT_CONFIG.maxBoundaryLevel};
        `);

    // Make it so we have a single geojson with the properties rolled up
    return rows;
}

export async function handle_get_surrounding_boundaries(ctx, next) {
    let boundaryId = ctx.request.query['boundaryId'];
    const surrounding_boundaries = await getSurroundingBoundariesGuids(boundaryId);
    const surrounding_boundary_guids = surrounding_boundaries.map(row => row.global_id);
    const version = await get_current_version_id();
    const retValue: SurroundingBoundaries = {
        version,
        surrounding_boundary_guids,
        boundary_guid: boundaryId,
    };

    ctx.body = retValue;

    await next();
}


/*
Here we are only getting operating level boundary ids, the ids that are used in the partitions
*/
export async function getSurroundingBoundaryPartionIds(boundaryGlobalId: string): Promise<Array<number>>{
  let escapedBoundaryGlobalId = escape.literal(boundaryGlobalId);

  //console.log(`Retrieving boundary data Boundary Id: ${boundaryId}`);
  const query = `
        WITH selected_boundary AS 
        (
          SELECT ST_Transform(ST_Envelope(b.geom), 3857) as geom_envelope, b.level
          FROM boundary.polygon b 
          WHERE b.global_id = ${escapedBoundaryGlobalId}
        ), 
        extended_extent AS 
        (
          SELECT ST_Transform(ST_SetSRID(
              ST_MakeBox2D(
                  ST_Point(
                      ST_XMin(sb.geom_envelope) - ${EXTENT_PADDING_METERS},
                      ST_YMin(sb.geom_envelope) - ${EXTENT_PADDING_METERS}
                  ),
                  ST_Point(
                      ST_XMax(sb.geom_envelope) + ${EXTENT_PADDING_METERS},
                      ST_YMax(sb.geom_envelope) + ${EXTENT_PADDING_METERS}
                  )
              ), 3857), 4326) as geom FROM selected_boundary sb
        )
        SELECT DISTINCT(b_id.id)
        FROM boundary.polygon_latest b INNER JOIN partitions.boundary_id b_id ON b.global_id = b_id.global_id,
               extended_extent ee 
        WHERE ST_Intersects(ee.geom, b.geom) AND b.level = ${GMT_CONFIG.maxBoundaryLevel};
        `
  const {rows} = await pool.query(query);
  return rows.map(r => r.id);
}