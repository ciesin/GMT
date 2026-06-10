import {pool} from "../../db-read/common";
import {Tables}  from "../../config/tables.config";
import {GeoPermission} from "../../server-interfaces/user/User";

/**
 * Return list of boundary_polygon (boundary global_ids) that user has permissions to
 * If boundary_global_id is not null - will return no empty list if permission exists
 * @param userId
 * @param boundary_global_id
 */
export async function getGeoPermissions(userId: string, boundary_global_id: string | null): Promise<Map<string, GeoPermission>> {
    let filterBoundary = (boundary_global_id != null)?  `AND boundary_polygon = '${boundary_global_id}'`: "";

    let geoPermissionsRows = await pool.query(`SELECT permission_main.boundary_polygon, permission_main.global_id,
         permission_main.parent_id, permission_parent.boundary_polygon as parent_boundary_polygon
         FROM ${Tables.auth_geo_permissions} permission_main
         LEFT JOIN ${Tables.auth_geo_permissions} permission_parent ON permission_main.parent_id=permission_parent.global_id
         WHERE permission_main.user_id = '${userId}'
           AND permission_main.deleted=false AND (permission_parent.deleted=false OR permission_parent.global_id IS null)
           ${filterBoundary}
         ORDER BY permission_main.parent_id DESC`);  // First we want to get real permissions and then only related ones

    let geoPermissions =  new Map<string, GeoPermission>();
    geoPermissionsRows.rows.forEach(row => {
        if(row.parent_id == null){
            // related_boundary_polygon will not be reset because permissions list is ordered
            geoPermissions.set(row.boundary_polygon, {
                boundary_polygon: row.boundary_polygon,
                global_id: row.global_id,
                related_boundary_polygon: []
            } as GeoPermission);
        }else{
            let geoPermission = {...geoPermissions.get(row.parent_boundary_polygon)}
            geoPermission.related_boundary_polygon.push(row.boundary_polygon);
            geoPermissions.set(row.parent_boundary_polygon, geoPermission);
        }
    });
    return geoPermissions;
}