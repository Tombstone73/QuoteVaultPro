-- Migration 0044: Platform Admin + Org Creator
-- Adds platform-admin flag and last-login tracking to users,
-- creates platform_audit_logs (org-agnostic), and org_invites tables.
--
-- ID type note: all PK and FK columns use character varying (matching users.id /
-- organizations.id which are Drizzle varchar("id") → PostgreSQL character varying).
-- Pattern: id character varying PRIMARY KEY DEFAULT gen_random_uuid()::text
-- (mirrors migration 0035 convention for this codebase)

-- ─── users extensions ────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN last_login_at timestamptz NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ─── platform_audit_logs ─────────────────────────────────────────────────────
-- Separate from org-scoped audit_logs; orgId is optional here.
-- org_id / actor_user_id are nullable foreign keys (SET NULL on delete so audit
-- records survive org/user deletion).
CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id              character varying PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id          character varying NULL REFERENCES organizations(id) ON DELETE SET NULL,
  actor_user_id   character varying NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_email     TEXT NOT NULL,
  action          TEXT NOT NULL,           -- e.g. 'org.create', 'platform.reauth'
  ip              TEXT NOT NULL,
  user_agent      TEXT NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_audit_logs_actor_user_id_idx ON platform_audit_logs (actor_user_id);
CREATE INDEX IF NOT EXISTS platform_audit_logs_action_idx        ON platform_audit_logs (action);
CREATE INDEX IF NOT EXISTS platform_audit_logs_created_at_idx    ON platform_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_logs_org_id_idx        ON platform_audit_logs (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_audit_logs_action_created_at_idx ON platform_audit_logs (action, created_at DESC);

COMMENT ON TABLE platform_audit_logs IS 'Platform-level audit trail. org_id is nullable for cross-org actions. id/org_id/actor_user_id are character varying matching existing varchar PK convention.';

-- ─── org_invites ──────────────────────────────────────────────────────────────
-- org_id → organizations(id) ON DELETE CASCADE (invite is meaningless without org)
-- created_by_user_id → users(id) ON DELETE RESTRICT (cannot delete platform admin
--   while outstanding invites exist; promotes accountability)
CREATE TABLE IF NOT EXISTS org_invites (
  id                  character varying PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id              character varying NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'owner',
  token_hash          TEXT NOT NULL,           -- SHA-256 of raw token; never store raw
  expires_at          timestamptz NOT NULL,
  created_by_user_id  character varying NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),
  accepted_at         timestamptz NULL
);

CREATE INDEX IF NOT EXISTS org_invites_org_id_idx     ON org_invites (org_id);
CREATE INDEX IF NOT EXISTS org_invites_email_idx      ON org_invites (email);
CREATE INDEX IF NOT EXISTS org_invites_expires_at_idx ON org_invites (expires_at);
CREATE INDEX IF NOT EXISTS org_invites_created_by_user_id_idx ON org_invites (created_by_user_id);

-- Ensure token_hash is globally unique within its org context
CREATE UNIQUE INDEX IF NOT EXISTS org_invites_org_id_token_hash_uidx
  ON org_invites (org_id, token_hash);

-- Prevent multiple pending (unaccepted) invites for the same email in the same org
-- Note: expires_at > now() is NOT IMMUTABLE so cannot be used in a partial index predicate;
-- expiry enforcement must happen in application logic.
CREATE UNIQUE INDEX IF NOT EXISTS org_invites_active_org_email_uidx
  ON org_invites (org_id, email)
  WHERE accepted_at IS NULL;

COMMENT ON TABLE org_invites IS 'Owner/member invites for organizations. token_hash = SHA-256(rawToken). Never store raw token. id/org_id/created_by_user_id are character varying matching existing varchar PK convention.';
