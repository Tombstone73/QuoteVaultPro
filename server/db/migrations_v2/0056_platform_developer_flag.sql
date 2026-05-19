-- Migration 0056: Add is_platform_developer flag to users
-- Platform-level developer flag: distinct from is_platform_admin.
-- Grants access to internal/debug tooling (e.g. QB invoice inspector).
-- NOT tenant-scoped. Must be granted manually via SQL in production.
-- Backfills false for all existing rows.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_platform_developer boolean NOT NULL DEFAULT false;
