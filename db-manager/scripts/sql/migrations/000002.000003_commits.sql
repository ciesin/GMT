
--DROP TABLE IF EXISTS master.commits CASCADE;

CREATE TABLE master.commits
(
    id bigserial PRIMARY KEY,
    publish_user text DEFAULT(session_user),
    comment text NOT NULL,
    timestamp timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_published boolean NOT NULL DEFAULT (false)
);
 
            