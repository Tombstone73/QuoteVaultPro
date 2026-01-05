-- Migration 0014: Standardize organization_id Tenant Column
-- 
-- GOAL: Add organization_id directly to tables that currently only access
--       it via parent joins, ensuring fast tenant filtering at query level.
--
-- PHASE: Additive only - add columns, backfill, create indexes.
--        Do NOT drop any columns or change existing behavior.
--
-- TABLES AFFECTED:
--   1. jobs - Add organization_id, backfill from orders
--   2. job_files - Add organization_id + order_id FK, backfill from jobs
--   3. job_notes - Add organization_id, backfill from jobs
--   4. job_status_log - Add organization_id, backfill from jobs

BEGIN;

-- ============================================================
-- 1) JOBS TABLE
-- ============================================================
-- Jobs currently require joining to orders to get organizationId.
-- Add direct organization_id column for fast filtering.

ALTER TABLE jobs 
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR;

COMMENT ON COLUMN jobs.organization_id IS 
  'Tenant scope - added migration 0014 for direct filtering without order join';

-- Backfill from orders
UPDATE jobs
SET organization_id = orders.organization_id
FROM orders
WHERE jobs.order_id = orders.id
  AND jobs.organization_id IS NULL;

-- Create index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_jobs_organization_id 
  ON jobs(organization_id, created_at DESC);

-- ============================================================
-- 2) JOB_FILES TABLE
-- ============================================================
-- job_files has NO foreign key currently. Add organization_id + order_id.

-- Add organization_id column
ALTER TABLE job_files
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR;

COMMENT ON COLUMN job_files.organization_id IS
  'Tenant scope - added migration 0014';

-- Add order_id if it doesn't exist (assumes job_id -> job -> order relationship)
ALTER TABLE job_files
  ADD COLUMN IF NOT EXISTS order_id VARCHAR;

COMMENT ON COLUMN job_files.order_id IS
  'Direct order reference - added migration 0014 for consistency';

-- Backfill organization_id + order_id from jobs
UPDATE job_files
SET 
  organization_id = jobs.organization_id,
  order_id = jobs.order_id
FROM jobs
WHERE job_files.job_id = jobs.id
  AND job_files.organization_id IS NULL;

-- Create index
CREATE INDEX IF NOT EXISTS idx_job_files_organization_id
  ON job_files(organization_id, created_at DESC);

-- Add FK constraint for order_id (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'job_files_order_id_fkey'
      AND table_name = 'job_files'
  ) THEN
    ALTER TABLE job_files
      ADD CONSTRAINT job_files_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 3) JOB_NOTES TABLE
-- ============================================================
-- job_notes has job_id but no organization_id

ALTER TABLE job_notes
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR;

COMMENT ON COLUMN job_notes.organization_id IS
  'Tenant scope - added migration 0014';

-- Backfill from jobs
UPDATE job_notes
SET organization_id = jobs.organization_id
FROM jobs
WHERE job_notes.job_id = jobs.id
  AND job_notes.organization_id IS NULL;

-- Create index
CREATE INDEX IF NOT EXISTS idx_job_notes_organization_id
  ON job_notes(organization_id, created_at DESC);

-- ============================================================
-- 4) JOB_STATUS_LOG TABLE
-- ============================================================
-- job_status_log has job_id but no organization_id

ALTER TABLE job_status_log
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR;

COMMENT ON COLUMN job_status_log.organization_id IS
  'Tenant scope - added migration 0014';

-- Backfill from jobs
UPDATE job_status_log
SET organization_id = jobs.organization_id
FROM jobs
WHERE job_status_log.job_id = jobs.id
  AND job_status_log.organization_id IS NULL;

-- Create index
CREATE INDEX IF NOT EXISTS idx_job_status_log_organization_id
  ON job_status_log(organization_id, created_at DESC);

-- ============================================================
-- VERIFICATION QUERIES (for testing)
-- ============================================================
-- Run these after migration to verify backfills worked:
--
-- SELECT COUNT(*) FROM jobs WHERE organization_id IS NULL;
-- SELECT COUNT(*) FROM job_files WHERE organization_id IS NULL;
-- SELECT COUNT(*) FROM job_notes WHERE organization_id IS NULL;
-- SELECT COUNT(*) FROM job_status_log WHERE organization_id IS NULL;
--
-- All should return 0.

COMMIT;

-- ============================================================
-- PHASE 2 (Future): Add NOT NULL constraints
-- ============================================================
-- After code is updated and deployed, run:
--
-- ALTER TABLE jobs ALTER COLUMN organization_id SET NOT NULL;
-- ALTER TABLE job_files ALTER COLUMN organization_id SET NOT NULL;
-- ALTER TABLE job_notes ALTER COLUMN organization_id SET NOT NULL;
-- ALTER TABLE job_status_log ALTER COLUMN organization_id SET NOT NULL;
