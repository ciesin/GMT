--FORCE_NO_TRANSACTION

-- Note these cannot be run in a transaction because postgresql doesn't allow enum modifs in a transaction

-- Modified 000025.000002 to reflect this

ALTER TYPE sn_problematic RENAME VALUE 'Densly Populated' TO 'Densely Populated';

ALTER TYPE sn_problematic ADD VALUE 'Hard To Reach' AFTER 'Densely Populated';