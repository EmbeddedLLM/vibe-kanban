CREATE TABLE local_password_credentials (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_operator BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX local_password_operator_idx
    ON local_password_credentials (is_operator) WHERE is_operator;

CREATE TABLE local_password_resets (
    user_id UUID PRIMARY KEY REFERENCES local_password_credentials(user_id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL
);
