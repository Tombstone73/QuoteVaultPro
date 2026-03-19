CREATE TABLE IF NOT EXISTS proof_access_tokens (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    line_item_id varchar NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
    proof_version_id varchar NOT NULL REFERENCES line_item_proof_versions(id) ON DELETE CASCADE,
    token varchar(128) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    created_by varchar(255) NOT NULL
);

CREATE INDEX IF NOT EXISTS proof_access_tokens_org_idx
    ON proof_access_tokens (organization_id);

CREATE INDEX IF NOT EXISTS proof_access_tokens_line_item_idx
    ON proof_access_tokens (line_item_id);

CREATE INDEX IF NOT EXISTS proof_access_tokens_proof_version_idx
    ON proof_access_tokens (proof_version_id);

CREATE INDEX IF NOT EXISTS proof_access_tokens_expires_at_idx
    ON proof_access_tokens (expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS proof_access_tokens_token_uidx
    ON proof_access_tokens (token);