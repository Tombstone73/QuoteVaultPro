ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organizations_is_archived_idx
  ON organizations(is_archived);
