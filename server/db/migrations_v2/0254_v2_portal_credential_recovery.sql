-- Canonical V2 customer-portal password recovery. Tokens are tenant/access
-- scoped, one-time, and are never projected outside the server/email handoff.
CREATE TABLE IF NOT EXISTS v2_portal_password_reset_tokens (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  access_id varchar NOT NULL REFERENCES customer_portal_access(id) ON DELETE CASCADE,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS v2_portal_password_reset_tokens_hash_uidx
  ON v2_portal_password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS v2_portal_password_reset_tokens_access_idx
  ON v2_portal_password_reset_tokens(access_id);
CREATE INDEX IF NOT EXISTS v2_portal_password_reset_tokens_org_expiry_idx
  ON v2_portal_password_reset_tokens(organization_id, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS v2_portal_password_reset_tokens_active_access_uidx
  ON v2_portal_password_reset_tokens(access_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;
