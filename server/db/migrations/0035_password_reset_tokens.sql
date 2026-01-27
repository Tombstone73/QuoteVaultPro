-- Migration 0035: Password Reset Tokens Table
-- Context: Forgot/reset password functionality with secure token handling
-- Date: 2026-01-27
--
-- This migration creates password_reset_tokens table for forgot/reset password flow.
-- Tokens are hashed (SHA256) before storage to prevent token theft if DB is compromised.
--
-- Features:
-- - Secure token storage (hash only, never plaintext)
-- - Single-use tokens (used_at tracking)
-- - Time-limited tokens (expires_at, default 60 minutes)
-- - User email linking for token validation
--
-- Safe to re-run: Uses IF NOT EXISTS and DO $$ BEGIN... EXCEPTION patterns.

-- 1) Ensure pgcrypto extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2) Create password_reset_tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, -- SHA256 hash of random token (never store plaintext)
  expires_at TIMESTAMPTZ NOT NULL, -- Token expiry (default: now + 60 minutes)
  used_at TIMESTAMPTZ NULL, -- Set when token is consumed (single-use enforcement)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Add index on user_id for listing user's tokens
DO $$ 
BEGIN
  CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL; -- Index already exists
END $$;

-- 4) Add index on expires_at for cleanup queries
DO $$ 
BEGIN
  CREATE INDEX password_reset_tokens_expires_at_idx ON password_reset_tokens(expires_at);
EXCEPTION
  WHEN duplicate_object THEN NULL; -- Index already exists
END $$;

-- 5) Ensure users.email has unique constraint (required for password reset lookup)
-- Check if constraint exists using pg_constraint/pg_class/pg_attribute query
DO $$
DECLARE
  constraint_exists BOOLEAN;
BEGIN
  -- Check for UNIQUE constraint on users(email)
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint con
    INNER JOIN pg_class rel ON rel.oid = con.conrelid
    INNER JOIN pg_attribute attr ON attr.attrelid = con.conrelid 
      AND attr.attnum = ANY(con.conkey)
    WHERE rel.relname = 'users'
      AND con.contype = 'u' -- UNIQUE constraint
      AND array_length(con.conkey, 1) = 1 -- Single column constraint
      AND attr.attname = 'email'
  ) INTO constraint_exists;

  IF NOT constraint_exists THEN
    ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE(email);
    RAISE NOTICE 'Added unique constraint on users.email';
  ELSE
    RAISE NOTICE 'Unique constraint on users.email already exists, skipping';
  END IF;
END $$;

-- 6) Add helpful comments
COMMENT ON TABLE password_reset_tokens IS 
  'Password reset tokens for forgot/reset password flow. Tokens are hashed (SHA256) and single-use with 60-minute expiry.';

COMMENT ON COLUMN password_reset_tokens.token_hash IS 
  'SHA256 hash of reset token. Never store plaintext tokens. Token is sent to user via email and hashed before lookup.';

COMMENT ON COLUMN password_reset_tokens.used_at IS 
  'Timestamp when token was consumed. NULL = unused, NOT NULL = already used (single-use enforcement).';

COMMENT ON COLUMN password_reset_tokens.expires_at IS 
  'Token expiry timestamp (default: created_at + 60 minutes). Expired tokens are rejected.';

-- Migration complete: password_reset_tokens table created with secure token handling
