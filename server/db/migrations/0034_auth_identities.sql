-- Migration 0034: Auth Identities Table
-- Separate credentials from user profiles for multi-provider support (password now, Google v1.2)

-- Ensure pgcrypto extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'password' (v1.0), 'google' (v1.2), etc.
  password_set_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Unique: one identity per user per provider
DO $$
BEGIN
  ALTER TABLE auth_identities ADD CONSTRAINT auth_identities_user_provider_unique UNIQUE(user_id, provider);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS auth_identities_user_id_idx ON auth_identities(user_id);
END $$;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS auth_identities_provider_idx ON auth_identities(provider);
END $$;

COMMENT ON TABLE auth_identities IS
  'Authentication credentials for users. Supports multiple auth providers per user (password, Google, etc.). Password hashes stored here, not in users table.';
