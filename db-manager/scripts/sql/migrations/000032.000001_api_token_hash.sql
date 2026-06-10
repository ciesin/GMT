
CREATE TABLE IF NOT EXISTS auth.api_token_hash (
    hash_id SERIAL PRIMARY KEY,
    name text NOT NULL,
    user_id UUID NOT NULL,
    use_count INT NOT NULL DEFAULT 0,
    expire_date timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE (name, user_id)
);

COMMENT ON COLUMN auth.api_token_hash.use_count IS 'How many times token has been used in the API';
COMMENT ON COLUMN auth.api_token_hash.expire_date IS 'Expiration date, also in JWT';
COMMENT ON COLUMN auth.api_token_hash.name IS 'User provided name, also in JWT';

--note we do not store the jwt itself for security reasons