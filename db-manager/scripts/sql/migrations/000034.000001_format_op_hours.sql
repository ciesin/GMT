CREATE OR REPLACE
FUNCTION health_facility.describe_operating_hours(
    opening_times TIME WITHOUT TIME ZONE[],
    closing_times TIME WITHOUT TIME ZONE[]
)
RETURNS TEXT AS $$
DECLARE
    result_parts TEXT := '';

day_labels TEXT[] := ARRAY['MO',
'TU',
'WE',
'TH',
'FR',
'SA',
'SU'];

s TIME;

e TIME;

min_array_length INT;

BEGIN
-- Handle NULL array inputs
    IF opening_times IS NULL
        OR closing_times IS NULL THEN
        RETURN 'N/A';
    END IF;
-- Handle empty arrays
    IF array_length(opening_times, 1) IS NULL
        OR array_length(closing_times, 1) IS NULL THEN
        RETURN 'N/A';
    END IF;
-- Determine the minimum array length to process

    min_array_length := LEAST(
        array_length(opening_times, 1),
        array_length(closing_times, 1),
        7 -- Maximum 7 days in a week
    );
-- Process each day
    FOR i IN 1.. min_array_length LOOP
        s := opening_times[i];

        e := closing_times[i];
-- Skip processing if either time is NULL

        CONTINUE
            WHEN s IS NULL
            OR e IS NULL;

        IF e <= s THEN
              CONTINUE;
        END IF;
-- Add separator if this isn't the first entry
        IF result_parts <> '' THEN
            result_parts := result_parts || ', ';
        END IF;

        IF s = time '00:00:00' AND e = time '23:59:59' THEN
            result_parts := result_parts || day_labels[i];
        ELSE
            -- Format the time range with 'h' separator
            result_parts := result_parts ||
                       day_labels[i] || ' ' ||
                       to_char(s, 'HH24"h"MI') || ' - ' ||
                       to_char(e, 'HH24"h"MI');
        END IF;
    END LOOP;
RETURN COALESCE(NULLIF(result_parts, ''), 'N/A');
END;

$$ LANGUAGE plpgsql;