import {PermissionsTree, PermissionActions, Permission} from "../../server-interfaces/PermissionsResponse";


export function hasPermission(permissionsTree: PermissionsTree, permission: string, action: PermissionActions): boolean{
    let resources_names = permission.split(".");
    let tree_part: PermissionsTree = permissionsTree; // permissions list operations fail
    // let tree_part: PermissionsOrKey = permissionsTree;
    let allow: boolean | null = null;
    resources_names.forEach(resource_name => {
        if(typeof(tree_part[resource_name]) == "undefined") {
            return;
        }
        tree_part = tree_part[resource_name] as PermissionsTree;
        if(tree_part !== undefined && tree_part["permissions"] !== undefined){
            tree_part["permissions"].forEach(permission => {
               if(allow === null && permission.allow === true && permission.action === action){
                   allow = true;
               }else if(permission.allow === false && permission.action === action){
                   allow = false;
               }
            });
        }
    });
    //console.log(JSON.stringify(permissionsTree, null, 4));
    if(allow === null){
        allow = false;
    }
    return allow;
}

/**
 * geoPermissions has all boundary_polygons so simple check if string exists in the list is enough
 * @param geoPermissions
 * @param boundary_polygon
 */
export function hasGeoPermission(geoPermissions: string[], boundary_polygon: string): boolean {
    return geoPermissions.includes(boundary_polygon);
}

/**
 * Recursively iterates all permissions and create tree structure like
 * {
 *     schema_name: {
 *         permissions: [],
 *         table_name: {
 *             permissions: [],
 *             field_name: {
 *                 permissions: []
 *             }
 *         }
 *     }
 * }
 * Real example:
 *
 *  "settlement": {
        "permissions": [
            {
                "id": 5,
                "resource": "settlement",
                "action": "update",
                "level": 0,
                "allow": true,
                "description": null
            } ],
        "polygon": {
            "permissions": [],
            "geom": {
                "permissions": [
                    {
                        "id": 8,
                        "resource": "settlement.polygon.geom",
                        "action": "update",
                        "level": 2,
                        "allow": false,
                        "description": null
                    }
    ]}}}}
 * @param tree
 * @param permissions
 * @param i
 */
function _formPermissionsTreeRecursive(tree: PermissionsTree, permissions: Permission[], i: number) : PermissionsTree{
    let permissions_length = permissions.length;
    if (permissions_length - i == 0){
        return tree;
    }
    let level = permissions[i].level;

    for(i; i < permissions_length; i++){
        if(permissions[i].level > level){
            break;
        }
        let resources = permissions[i].resource.split(".");
        let tree_part: PermissionsTree = tree as PermissionsTree;
        // let tree_part: PermissionsTree = tree;
        resources.forEach(resource_name => {
            if(tree_part[resource_name] == undefined){
                tree_part[resource_name] = {"permissions": []}
            }
            tree_part = tree_part[resource_name] as PermissionsTree;
        });
        tree_part["permissions"]!.push(permissions[i]);

    }
    return _formPermissionsTreeRecursive(tree, permissions, i);
}

/**
 * Get tree structure of permissions
 * @param permissions
 */
export function formPermissionsTree(permissions: Array<Permission>) : PermissionsTree{
    return _formPermissionsTreeRecursive({}, permissions, 0);
}
