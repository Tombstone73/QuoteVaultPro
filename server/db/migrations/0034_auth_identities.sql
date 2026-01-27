-- Migration 0034: Auth Identities Table
-- Context: Separate credentials from user profiles for multi-provider support
-- Date: 2026-01-27
--
-- This migration creates auth_identities table to store authentication credentials
-- separately from user profiles. Supports password auth (v1.0), OAuth providers (v1.2+).
--
-- Design:
-- - users table: profile data only (email, name, role, status)
-- - auth_identities table: credentials (password_hash, provider)
-- - One user can have multiple auth methods (password + Google)
--
-- Safe to re-run: Uses IF NOT EXISTS and DO $$ BEGIN... EXCEPTION patterns.

-- 1) Ensure pgcrypto extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2) Create auth_identities table
CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'password' (v1.0), 'google' (v1.2+), etc.
  password_hash TEXT, -- Only used when provider='password', NULL for OAuth
  password_set_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Add unique constraint: one identity per user per provider
DO $$ 
BEGIN
  ALTER TABLE auth_identities 
    ADD CONSTRAINT auth_identities_user_provider_unique 
    UNIQUE(user_id, provider);
EXCEPTION
  WHEN duplicate_object THEN NULL; -- Constraint already exists
END $$;

-- 4) Add index for user lookups
DO $$ 
BEGIN
  CREATE INDEX auth_identities_user_id_idx ON auth_identities(user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL; -- Index already exists
END $$;

-- 5) Add index for provider filtering
DO $$ 
BEGIN
  CREATE INDEX auth_identities_provider_idx ON auth_identities(provider);
EXCEPTION
  WHEN duplicate_object THEN NULL; -- Index already exists
END $$;

-- 6) Add helpful comments
COMMENT ON TABLE auth_identities IS 
  'Authentication credentials for users. Supports multiple auth providers per user (password, Google, etc.). Password hashes stored here, not in users table.';

COMMENT ON COLUMN auth_identities.provider IS 
  'Auth provider type: ''password'' for email/password, ''google'' for Google OAuth, etc.';

COMMENT ON COLUMN auth_identities.password_hash IS 
  'Bcrypt password hash (cost factor 10). Only set when provider=''password''. NULL for OAuth providers.';

COMMENT ON COLUMN auth_identities.password_set_at IS 
  'Timestamp when password was last set/changed. Used for password age policies and audit logs.';

-- Migration complete: auth_identities table created
-- NOTE: Do NOT migrate existing password_hash data from users table.
-- Users with password_hash in users table will need to use "Forgot password" to set new password in auth_identities.
-- This is safer than attempting automatic migration which could fail or cause data inconsistencies.
