import request from 'supertest';
// import {Context} from "koa";
import { getValidToken } from '../fixtures/auth.fixtures'
import { hasPermission, hasGeoPermission } from '../../server-interfaces/utils/permissions.util'
import { PermissionsTree } from '../../server-interfaces/PermissionsResponse'
// import { get_user_permissions } from '../../utils/auth/permissions.util'
import app from '../../app';


test('401 status should be returned when user asks for permissions without Bearer token', async () => {
    const response = await request(app.callback()).get('/me');
    expect(response.status).toBe(401);
    // expect(JSON.parse(response.text)).toStrictEqual({permissions: {}, geo_permissions: []});
});

test('401 status should be returned when user asks for permissions with invalid Bearer token', async () => {
    const response = await request(app.callback()).get('/me').set({ Authorization: "Bearer abc" });
    expect(response.status).toBe(401);
    // expect(JSON.parse(response.text)).toStrictEqual({permissions: {}, geo_permissions: []});
});

test('Protected route should return 200 status for the users with valid access token returns editor permissions', async () => {
    const token = await getValidToken();
    const response = await request(app.callback())
        .get('/me')
        .set({ Authorization: "Bearer " +  token });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toStrictEqual(  {
        "permissions":  {
            "boundary":  {
              "permissions": [
                 {
                  "action": "read",
                  "allow": true,
                  "description": null,
                  "id": 1,
                  "level": 0,
                  "resource": "boundary",
                },
                 {
                  "action": "create",
                  "allow": true,
                  "description": null,
                  "id": 2,
                  "level": 0,
                  "resource": "boundary",
                },
                 {
                  "action": "update",
                  "allow": true,
                  "description": null,
                  "id": 3,
                  "level": 0,
                  "resource": "boundary",
                },
                 {
                  "action": "delete",
                  "allow": true,
                  "description": null,
                  "id": 4,
                  "level": 0,
                  "resource": "boundary",
                },
              ],
              "polygon": {
                  "permissions": [],
                  "global_id": {
                    "permissions": [
                      {
                        "id": 25,
                        "resource": "boundary.polygon.global_id",
                        "action": "update",
                        "level": 2,
                        "allow": false,
                        "description": null
                      }
                    ]
                  }
              }
            },
            "generic":  {
              "permissions": [
                 {
                  "action": "read",
                  "allow": true,
                  "description": null,
                  "id": 5,
                  "level": 0,
                  "resource": "generic",
                },
                 {
                  "action": "create",
                  "allow": true,
                  "description": null,
                  "id": 6,
                  "level": 0,
                  "resource": "generic",
                },
                 {
                  "action": "update",
                  "allow": true,
                  "description": null,
                  "id": 7,
                  "level": 0,
                  "resource": "generic",
                },
                 {
                  "action": "delete",
                  "allow": true,
                  "description": null,
                  "id": 8,
                  "level": 0,
                  "resource": "generic",
                },
              ],
                "line": {
              "permissions": [],
              "global_id": {
                "permissions": [
                  {
                    "id": 26,
                    "resource": "generic.line.global_id",
                    "action": "update",
                    "level": 2,
                    "allow": false,
                    "description": null
                  }
                ]
              }
            },
            "point": {
              "permissions": [],
              "global_id": {
                "permissions": [
                  {
                    "id": 27,
                    "resource": "generic.point.global_id",
                    "action": "update",
                    "level": 2,
                    "allow": false,
                    "description": null
                  }
                ]
              }
            },
            "polygon": {
              "permissions": [],
              "global_id": {
                "permissions": [
                  {
                    "id": 28,
                    "resource": "generic.polygon.global_id",
                    "action": "update",
                    "level": 2,
                    "allow": false,
                    "description": null
                  }
                ]
              }
            }
            },
            "health_facility": {
                "permissions": [
                    {
                        "action": "read",
                        "allow": true,
                        "description": null,
                        "id": 9,
                        "level": 0,
                        "resource": "health_facility",
                    },
                    {
                        "action": "create",
                        "allow": true,
                        "description": null,
                        "id": 10,
                        "level": 0,
                        "resource": "health_facility",
                    },
                    {
                        "action": "update",
                        "allow": true,
                        "description": null,
                        "id": 11,
                        "level": 0,
                        "resource": "health_facility",
                    },
                    {
                        "action": "delete",
                        "allow": true,
                        "description": null,
                        "id": 12,
                        "level": 0,
                        "resource": "health_facility",
                    },
                ],
                "point": {
                    "permissions": [],
                    "global_id": {
                        "permissions": [
                            {
                                "id": 29,
                                "resource": "health_facility.point.global_id",
                                "action": "update",
                                "level": 2,
                                "allow": false,
                                "description": null
                            }
                        ]
                    }
                },
            },
            "master":  {
              "permissions": [
                 {
                  "action": "read",
                  "allow": true,
                  "description": null,
                  "id": 13,
                  "level": 0,
                  "resource": "master",
                },
                 {
                  "action": "create",
                  "allow": true,
                  "description": null,
                  "id": 14,
                  "level": 0,
                  "resource": "master",
                },
                 {
                  "action": "update",
                  "allow": true,
                  "description": null,
                  "id": 15,
                  "level": 0,
                  "resource": "master",
                },
                 {
                  "action": "delete",
                  "allow": true,
                  "description": null,
                  "id": 16,
                  "level": 0,
                  "resource": "master",
                },
              ],
              "commits": {
              "permissions": [],
              "publish_user": {
                "permissions": [
                  {
                    "id": 30,
                    "resource": "master.commits.publish_user",
                    "action": "update",
                    "level": 2,
                    "allow": false,
                    "description": null
                  }
                ]
              }
            }
            },
            "settlement":  {
              "permissions": [
                 {
                  "action": "read",
                  "allow": true,
                  "description": null,
                  "id": 17,
                  "level": 0,
                  "resource": "settlement",
                },
                 {
                  "action": "create",
                  "allow": true,
                  "description": null,
                  "id": 18,
                  "level": 0,
                  "resource": "settlement",
                },
                 {
                  "action": "update",
                  "allow": true,
                  "description": null,
                  "id": 19,
                  "level": 0,
                  "resource": "settlement",
                },
                 {
                  "action": "delete",
                  "allow": true,
                  "description": null,
                  "id": 20,
                  "level": 0,
                  "resource": "settlement",
                },
              ],
            },
            "ri":  {
              "permissions": [
                 {
                  "action": "read",
                  "allow": true,
                  "description": null,
                  "id": 21,
                  "level": 0,
                  "resource": "ri",
                },
                 {
                  "action": "create",
                  "allow": true,
                  "description": null,
                  "id": 22,
                  "level": 0,
                  "resource": "ri",
                },
                 {
                  "action": "update",
                  "allow": true,
                  "description": null,
                  "id": 23,
                  "level": 0,
                  "resource": "ri",
                },
                 {
                  "action": "delete",
                  "allow": true,
                  "description": null,
                  "id": 24,
                  "level": 0,
                  "resource": "ri",
                },
              ],
              "catchment_item": {
              "permissions": [],
              "global_id": {
                "permissions": [
                  {
                    "id": 31,
                    "resource": "ri.catchment_item.global_id",
                    "action": "update",
                    "level": 2,
                    "allow": false,
                    "description": null
                  }
                ]
              }
            },
              "microplan": {
              "permissions": [],
              "global_id": {
                "permissions": [
                  {
                    "id": 32,
                    "resource": "ri.microplan.global_id",
                    "action": "update",
                    "level": 2,
                    "allow": false,
                    "description": null
                  }
                ]
              }}
            }
        },
        "geo_permissions":  [],
        "hierarchical_geo_permissions":  []
     });
});

test('Endpoint /me should be accessible for logged in users', async () => {
    const token = await getValidToken();
    const response = await request(app.callback())
        .get('/me')
        .set({ Authorization: "Bearer " + token });
    expect(response.status).toBe(200);
});

test('Endpoint /me should NOT be accessible for logged off users as well', async () => {
    const response = await request(app.callback()).get('/me');
    expect(response.status).toBe(401);
});


test('hasPermission should return true for update if column is marked as allowed for edit', async () => {
    const permissions_tree: PermissionsTree = {
    boundary: {
      polygon: {
          is_deleted: {
              permissions: [
                {
                  id: 25,
                  resource: "boundary.polygon.is_deleted",
                  action: "update",
                  level: 2,
                  allow: false,
                  description: null
                }
              ]
         },
         permissions: [],
      },
      permissions: [
          {
          id: 1,
          resource: "boundary",
          action: "read",
          level: 0,
          allow: true,
          description: null
        },
        {
          "id": 2,
          "resource": "boundary",
          "action": "update",
          "level": 0,
          "allow": true,
          "description": null,
          // permissions: [
          //     {
          //     id: 1,
          //     resource: "id",
          //     action: "update",
          //     level: 0,
          //     allow: true,
          //     description: null,
          //     permissions: []
          //   }
          // ]
        }
      ]
    }
  };
    expect(hasPermission(permissions_tree, 'boundary.polygon.boundary_polygon', 'update'))
        .toBe(true);
});


test('hasPermission should return true for update if parent column is marked as allowed for edit', async () => {
    const permissions_tree: PermissionsTree = {
    boundary: {
      permissions: [
          {
          id: 1,
          resource: "boundary",
          action: "read",
          level: 0,
          allow: true,
          description: null
        },
        {
          "id": 2,
          "resource": "boundary",
          "action": "update",
          "level": 0,
          "allow": true,
          "description": null
        }
      ]
    }
  };
    expect(hasPermission(permissions_tree, 'boundary.polygon.boundary_polygon.deeper_key', 'update'))
        .toBe(true);
});

test('hasPermission should return false for create if parent schema does not have create permission', async () => {
    const permissions_tree: PermissionsTree = {
    boundary: {
      permissions: [
          {
          id: 1,
          resource: "boundary",
          action: "read",
          level: 0,
          allow: true,
          description: null
        },
        {
          id: 2,
          resource: "boundary",
          action: "update",
          level: 0,
          allow: true,
          description: null
        }
      ]
    }
  };
    expect(hasPermission(permissions_tree, 'boundary.polygon.boundary_polygon.deeper_key', 'update'))
        .toBe(true);
});


test('hasPermission should return false for update if schema is allowed but the field is denied', async () => {
    const permissions_tree: PermissionsTree = {
    boundary: {
      permissions: [
        {
          id: 2,
          resource: "boundary",
          action: "update",
          level: 0,
          allow: true,
          description: null
        }
      ],
      polygon: {
          permissions: [],
          global_id: {
             permissions: [
                  {
                    id: 25,
                    resource: "boundary.polygon.global_id",
                    action: "update",
                    level: 2,
                    allow: false,
                    description: null
                  }
             ]
          }
      }
    }
  };
    expect(hasPermission(permissions_tree, 'boundary.polygon.boundary_polygon.global_id', 'update'))
        .toBe(false);
});

test('hasPermission should return false for update if permissions tree is empty', async () => {
    const permissions_tree = {};
    expect(hasPermission(permissions_tree, 'boundary.polygon.boundary_polygon', 'update'))
        .toBe(false);
});

// currently it is a bit stupid test but if we need to implement tree structure for seed this
// would be more useful test
test('hasGeoPermission should return true if user has access to the right boundary', async () => {
    expect(hasGeoPermission(['abc', 'def', 'aba'], 'def'))
        .toBe(true);
});
test('hasGeoPermission should return false if user has NO access to the boundary', async () => {
    expect(hasGeoPermission(['abc', 'def', 'aba'], 'ab'))
        .toBe(false);
});
// We need testing db setup to test deletion_date
// test.only('hasPermission should not return permission that has deletion_date not null', async () => {
//     console.log(getUserPermissions({} as Context, ['gmt-editor']));
//     // const permissions_tree = {};
//     // expect(hasPermission(permissions_tree, 'boundary.polygon.boundary_polygon', 'update'))
//     //     .toBe(false);
// });
