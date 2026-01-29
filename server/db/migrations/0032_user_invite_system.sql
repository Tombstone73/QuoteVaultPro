-- User Invite System: Add mustSetPassword flag for temporary password flow
-- Enables owner/admin to invite users via email with temporary password
-- Users must set permanent password on first login

-- Add mustSetPassword boolean to users table
-- Default false for existing users (already have passwords set)
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN must_set_password boolean NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- Create index for efficient queries on users requiring password change
CREATE INDEX IF NOT EXISTS users_must_set_password_idx ON users (must_set_password) WHERE must_set_password = true;

-- Add comments for documentation
COMMENT ON COLUMN users.must_set_password IS 'True if user was invited with temporary password and must set new password on first login';
