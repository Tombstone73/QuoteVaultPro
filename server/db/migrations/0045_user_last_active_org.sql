-- Migration 0045: Add last_active_org_id to users
-- Tracks which org the user last explicitly selected, persisted in DB so it
-- survives across sessions and devices.  ON DELETE SET NULL ensures we never
-- hold a dangling FK if the org is deleted.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_org_id character varying NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_last_active_org_fk'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_last_active_org_fk
      FOREIGN KEY (last_active_org_id)
      REFERENCES organizations(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_last_active_org_id_idx ON users(last_active_org_id);
