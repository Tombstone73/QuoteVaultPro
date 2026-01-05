-- Migration 0015: Tenant Hardening - Add NOT NULL constraints and foreign keys
-- Phase 3 of tenant standardization: Enforce data integrity after successful backfills
-- Safe to apply: All organization_id columns verified to have no NULLs

BEGIN;

-- ============================================================
-- STEP 1: Add NOT NULL constraints to job tables
-- ============================================================

-- These columns were added in migration 0014 and backfilled successfully
-- Now we enforce NOT NULL to prevent future data integrity issues

ALTER TABLE jobs 
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE job_files 
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE job_notes 
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE job_status_log 
  ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- STEP 2: Add foreign key constraints (NOT VALID first)
-- ============================================================

-- Add FK constraints as NOT VALID first (no full table scan)
-- Then VALIDATE in separate step (allows concurrent operations)

-- Jobs -> Organizations FK
ALTER TABLE jobs 
  ADD CONSTRAINT jobs_organization_id_fkey 
  FOREIGN KEY (organization_id) 
  REFERENCES organizations(id) 
  ON DELETE CASCADE 
  NOT VALID;

-- Job Files -> Organizations FK
ALTER TABLE job_files 
  ADD CONSTRAINT job_files_organization_id_fkey 
  FOREIGN KEY (organization_id) 
  REFERENCES organizations(id) 
  ON DELETE CASCADE 
  NOT VALID;

-- Job Notes -> Organizations FK
ALTER TABLE job_notes 
  ADD CONSTRAINT job_notes_organization_id_fkey 
  FOREIGN KEY (organization_id) 
  REFERENCES organizations(id) 
  ON DELETE CASCADE 
  NOT VALID;

-- Job Status Log -> Organizations FK
ALTER TABLE job_status_log 
  ADD CONSTRAINT job_status_log_organization_id_fkey 
  FOREIGN KEY (organization_id) 
  REFERENCES organizations(id) 
  ON DELETE CASCADE 
  NOT VALID;

-- ============================================================
-- STEP 3: Validate foreign key constraints
-- ============================================================

-- Now validate the constraints (checks existing data)
-- This is safe because we've verified no orphaned records exist

ALTER TABLE jobs 
  VALIDATE CONSTRAINT jobs_organization_id_fkey;

ALTER TABLE job_files 
  VALIDATE CONSTRAINT job_files_organization_id_fkey;

ALTER TABLE job_notes 
  VALIDATE CONSTRAINT job_notes_organization_id_fkey;

ALTER TABLE job_status_log 
  VALIDATE CONSTRAINT job_status_log_organization_id_fkey;

COMMIT;

-- Verification queries (run after migration)
-- SELECT COUNT(*) FROM jobs WHERE organization_id IS NULL; -- Should be 0
-- SELECT COUNT(*) FROM job_files WHERE organization_id IS NULL; -- Should be 0
-- SELECT COUNT(*) FROM job_notes WHERE organization_id IS NULL; -- Should be 0
-- SELECT COUNT(*) FROM job_status_log WHERE organization_id IS NULL; -- Should be 0
