DO $$
DECLARE
  users_admin_role INTEGER := 1;
  editor_role INTEGER := 2;
  --validator_role INTEGER := 3;
  --reader_role INTEGER := 4;
BEGIN
CREATE SCHEMA IF NOT EXISTS auth;

IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'action_enum') THEN
CREATE TYPE action_enum AS ENUM ('create', 'read', 'update', 'delete');
END IF;
-- CREATE TYPE resource_enum AS ENUM ('boundary', 'settlement', 'generic', 'auth', 'health_facility', 'master', 'ri');


CREATE TABLE IF NOT EXISTS auth.role (
    id SERIAL NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    auto_assign BOOLEAN NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (code),
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS auth.permission (
    id SERIAL NOT NULL,
    resource text NOT NULL,
    action action_enum NOT NULL,
    level int,
    allow BOOLEAN,
    description TEXT,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS auth.role_permission (
    role_id INTEGER NOT NULL,
    permission_id INTEGER NOT NULL,
    assignment_date timestamptz NOT NULL,
    deletion_date timestamptz NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY(role_id) REFERENCES auth.role (id) ON DELETE CASCADE,
    FOREIGN KEY(permission_id) REFERENCES auth.permission (id) ON DELETE CASCADE
);



CREATE TABLE IF NOT EXISTS auth.geo_permission (
    user_id UUID NOT NULL,
    boundary_polygon UUID NOT NULL,
    assignment_date timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (user_id, boundary_polygon)
    --FOREIGN KEY(boundary_polygon) REFERENCES boundary.polygon(global_id) ON DELETE CASCADE
);


/*
 * Seed roles and permissions
 */

--TRUNCATE auth.role_permission CASCADE;
--TRUNCATE auth.permission CASCADE;
--TRUNCATE auth.role CASCADE;

INSERT INTO auth.role (id, code, name, description, auto_assign)
VALUES (users_admin_role, 'gmt-users-administrator', 'Users administrator', '', false),
       (editor_role, 'gmt-editor', 'Editor', '', true);
       --(validator_role, 'gmt-validator', 'Validator', '', false),
       --(reader_role, 'gmt-reader', 'Reader', '', true);



INSERT INTO auth.permission (id, resource, action, level, allow)
VALUES
  (1, 'boundary', 'read', 0, true),
  (2, 'boundary', 'create', 0, true),
  (3, 'boundary', 'update', 0, true),
  (4, 'boundary', 'delete', 0, true),
  (5, 'generic', 'read', 0, true),
  (6, 'generic', 'create', 0, true),
  (7, 'generic', 'update', 0, true),
  (8, 'generic', 'delete', 0, true),
  (9, 'health_facility', 'read', 0, true),
  (10, 'health_facility', 'create', 0, true),
  (11, 'health_facility', 'update', 0, true),
  (12, 'health_facility', 'delete', 0, true),
  (13, 'master', 'read', 0, true),
  (14, 'master', 'create', 0, true),
  (15, 'master', 'update', 0, true),
  (16, 'master', 'delete', 0, true),
  (17, 'settlement', 'read', 0, true),
  (18, 'settlement', 'create', 0, true),
  (19, 'settlement', 'update', 0, true),
  (20, 'settlement', 'delete', 0, true),
  (21, 'ri', 'read', 0, true),
  (22, 'ri', 'create', 0, true),
  (23, 'ri', 'update', 0, true),
  (24, 'ri', 'delete', 0, true),
  -- restrict some fields that are not allowed to be updated
  (25, 'boundary.polygon.global_id', 'update', 2, false),
  (26, 'generic.line.global_id', 'update', 2, false),
  (27, 'generic.point.global_id', 'update', 2, false),
  (28, 'generic.polygon.global_id', 'update', 2, false),
  (29, 'health_facility.point.global_id', 'update', 2, false),
  (30, 'master.commits.publish_user', 'update', 2, false),
  (31, 'ri.catchment_item.global_id', 'update', 2, false),
  (32, 'ri.microplan.global_id', 'update', 2, false),
  -- for users admin
  (33, 'auth', 'read', 0, true),
  (34, 'auth', 'create', 0, true),
  (35, 'auth', 'update', 0, true),
  (36, 'auth', 'delete', 0, true);


INSERT INTO auth.role_permission (role_id, permission_id, assignment_date)
VALUES
       -- Users admin
       (users_admin_role, 33, current_timestamp),
       (users_admin_role, 34, current_timestamp),
       (users_admin_role, 35, current_timestamp),
       (users_admin_role, 36, current_timestamp),

       -- Editor
       (editor_role, 1, current_timestamp),
       (editor_role, 2, current_timestamp),
       (editor_role, 3, current_timestamp),
       (editor_role, 4, current_timestamp),
       (editor_role, 5, current_timestamp),
       (editor_role, 6, current_timestamp),
       (editor_role, 7, current_timestamp),
       (editor_role, 8, current_timestamp),
       (editor_role, 9, current_timestamp),
       (editor_role, 10, current_timestamp),
       (editor_role, 11, current_timestamp),
       (editor_role, 12, current_timestamp),
       (editor_role, 13, current_timestamp),
       (editor_role, 14, current_timestamp),
       (editor_role, 15, current_timestamp),
       (editor_role, 16, current_timestamp),
       (editor_role, 17, current_timestamp),
       (editor_role, 18, current_timestamp),
       (editor_role, 19, current_timestamp),
       (editor_role, 20, current_timestamp),
       (editor_role, 21, current_timestamp),
       (editor_role, 22, current_timestamp),
       (editor_role, 23, current_timestamp),
       (editor_role, 24, current_timestamp),
       (editor_role, 25, current_timestamp),
       (editor_role, 26, current_timestamp),
       (editor_role, 27, current_timestamp),
       (editor_role, 28, current_timestamp),
       (editor_role, 29, current_timestamp),
       (editor_role, 30, current_timestamp),
       (editor_role, 31, current_timestamp),
       (editor_role, 32, current_timestamp);

       -- Validator
       --(validator_role, 1, current_timestamp),
       --(validator_role, 3, current_timestamp),
       --(validator_role, 5, current_timestamp),
       --(validator_role, 7, current_timestamp),
       --(validator_role, 9, current_timestamp),


END $$;