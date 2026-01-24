-- Migration 0033: Add password hash support for standard auth
-- Context: Enable email/password authentication for Railway production deployment
-- Date: 2026-01-24
-- 
-- This migration adds password_hash column to users table to support
-- AUTH_PROVIDER=standard (bcrypt password authentication). Column is nullable
-- to support existing users who authenticate via Replit OIDC or other OAuth providers.
--
-- Safe to re-run: Uses DO $$ BEGIN... EXCEPTION patterns for idempotency.

-- 1) Add password_hash column (nullable for OAuth users)
DO $$ 
BEGIN
  ALTER TABLE "users" ADD COLUMN "password_hash" TEXT;
EXCEPTION
  WHEN duplicate_column THEN 
    NULL; -- Column already exists, skip
END $$;

-- 2) Add case-insensitive email index for faster login lookups
-- (Allows efficient LOWER(email) comparisons in Passport LocalStrategy)
DO $$ 
BEGIN
  CREATE INDEX "users_email_lower_idx" ON "users" (LOWER(email));
EXCEPTION
  WHEN duplicate_table THEN 
    NULL; -- Index already exists with same name as a table (shouldn't happen)
  WHEN duplicate_object THEN 
    NULL; -- Index already exists, skip
END $$;

-- 3) Add helpful comments
COMMENT ON COLUMN users.password_hash IS 
  'Bcrypt password hash for standard auth (AUTH_PROVIDER=standard). NULL for OAuth-only users (Replit Auth, etc.). Cost factor: 10.';

-- Migration complete: Users table now supports both OAuth and password authentication
