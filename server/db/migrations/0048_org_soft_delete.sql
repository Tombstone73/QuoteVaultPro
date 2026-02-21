-- Migration 0048: Organization Soft Delete with Platform Admin Controls
-- Adds delete lifecycle tracking to organizations table for safe deletion workflow.
--
-- Workflow:
-- 1. Org owner/admin requests deletion → delete_state = 'pending_delete'
-- 2. Platform admin finalizes → delete_state = 'soft_deleted', org access blocked
-- 3. Platform admin can restore → delete_state = 'active'

-- Add delete lifecycle columns to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delete_state text NOT NULL DEFAULT 'active';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delete_requested_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delete_requested_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delete_confirmed_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delete_confirmed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delete_reason text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_ip text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_user_agent text;

-- Add constraint to validate delete_state values
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'organizations_delete_state_check'
  ) THEN
    ALTER TABLE organizations 
    ADD CONSTRAINT organizations_delete_state_check 
    CHECK (delete_state IN ('active', 'pending_delete', 'soft_deleted'));
  END IF;
END $$;

-- Create index for filtering by delete_state
CREATE INDEX IF NOT EXISTS organizations_delete_state_idx ON organizations (delete_state);
CREATE INDEX IF NOT EXISTS organizations_delete_requested_at_idx ON organizations (delete_requested_at);

-- Add comments
COMMENT ON COLUMN organizations.delete_state IS 'Deletion lifecycle state: active (normal), pending_delete (owner requested), soft_deleted (platform admin finalized)';
COMMENT ON COLUMN organizations.delete_requested_at IS 'Timestamp when org owner/admin requested deletion';
COMMENT ON COLUMN organizations.delete_requested_by_user_id IS 'User who requested deletion (org owner/admin)';
COMMENT ON COLUMN organizations.delete_confirmed_at IS 'Timestamp when platform admin confirmed deletion';
COMMENT ON COLUMN organizations.delete_confirmed_by_user_id IS 'Platform admin who confirmed deletion';
COMMENT ON COLUMN organizations.deleted_at IS 'Timestamp when org was soft-deleted (platform admin finalized)';
COMMENT ON COLUMN organizations.deleted_by_user_id IS 'Platform admin who finalized soft deletion';
COMMENT ON COLUMN organizations.delete_reason IS 'Reason provided when deletion was requested';
