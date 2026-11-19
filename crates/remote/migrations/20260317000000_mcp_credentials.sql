CREATE TABLE mcp_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash BYTEA NOT NULL UNIQUE,
    name TEXT NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    user_id UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    FOREIGN KEY (organization_id, user_id)
        REFERENCES organization_member_metadata(organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX mcp_credentials_member_idx ON mcp_credentials (organization_id, user_id);
CREATE INDEX mcp_credentials_owner_idx ON mcp_credentials (user_id);
CREATE INDEX mcp_credentials_project_idx ON mcp_credentials (project_id);
