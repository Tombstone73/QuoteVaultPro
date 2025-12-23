-- Migration: Production Workflow MVP - Configurable job statuses and requiresProductionJob flag
-- Implements dynamic job status pipeline and production job filtering

-- 1. Add job_statuses table for configurable workflow
CREATE TABLE IF NOT EXISTS job_statuses (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  key VARCHAR(50) UNIQUE NOT NULL,
  label VARCHAR(100) NOT NULL,
  position INTEGER NOT NULL,
  badge_variant VARCHAR(50) DEFAULT 'default',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for job_statuses
CREATE INDEX IF NOT EXISTS job_statuses_position_idx ON job_statuses(position);
CREATE INDEX IF NOT EXISTS job_statuses_key_idx ON job_statuses(key);
CREATE INDEX IF NOT EXISTS job_statuses_is_default_idx ON job_statuses(is_default);

-- 2. Add requiresProductionJob flag to products table
ALTER TABLE products
ADD COLUMN IF NOT EXISTS requires_production_job BOOLEAN NOT NULL DEFAULT true;

-- 3. Update jobs table: rename status to status_key and add FK
DO $$ BEGIN
  -- Rename column if it exists
  BEGIN
    ALTER TABLE jobs RENAME COLUMN status TO status_key;
  EXCEPTION WHEN OTHERS THEN
    -- Column might already be renamed or not exist, continue
    NULL;
  END;
  
  -- Add status_key if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'jobs' AND column_name = 'status_key'
  ) THEN
    ALTER TABLE jobs ADD COLUMN status_key VARCHAR(50) NOT NULL DEFAULT 'pending_prepress';
  END IF;
END $$;

-- 4. Update job_status_log table: rename columns
DO $$ BEGIN
  BEGIN
    ALTER TABLE job_status_log RENAME COLUMN old_status TO old_status_key;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  
  BEGIN
    ALTER TABLE job_status_log RENAME COLUMN new_status TO new_status_key;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- 5. Add foreign key constraint from jobs.status_key to job_statuses.key
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'jobs' AND constraint_name = 'jobs_status_key_fk'
  ) THEN
    ALTER TABLE jobs 
    ADD CONSTRAINT jobs_status_key_fk FOREIGN KEY (status_key) 
    REFERENCES job_statuses(key) ON DELETE RESTRICT;
  END IF;
END $$;

-- 6. Update indexes on jobs table
DROP INDEX IF EXISTS jobs_status_idx;
CREATE INDEX IF NOT EXISTS jobs_status_key_idx ON jobs(status_key);

-- 7. Seed default job statuses (if not already present)
INSERT INTO job_statuses (key, label, position, is_default, created_at, updated_at)
VALUES
  ('pending_prepress', 'Pending Prepress', 0, true, NOW(), NOW()),
  ('prepress', 'Prepress', 1, false, NOW(), NOW()),
  ('queued_production', 'Queued', 2, false, NOW(), NOW()),
  ('in_production', 'In Production', 3, false, NOW(), NOW()),
  ('finishing', 'Finishing', 4, false, NOW(), NOW()),
  ('qc', 'QC', 5, false, NOW(), NOW()),
  ('complete', 'Complete', 6, false, NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE job_statuses IS 'Configurable job status pipeline for production workflow';
COMMENT ON COLUMN job_statuses.key IS 'Unique identifier for status (e.g., pending_prepress)';
COMMENT ON COLUMN job_statuses.is_default IS 'Initial status for newly created jobs';
COMMENT ON COLUMN products.requires_production_job IS 'If false, this product does not create jobs (e.g., stock items, fees)';
COMMENT ON COLUMN jobs.status_key IS 'References job_statuses.key for current job status';
