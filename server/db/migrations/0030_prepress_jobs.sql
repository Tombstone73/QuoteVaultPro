-- Prepress Jobs Table
-- Stateless PDF preflight processor with ephemeral file storage
-- All inputs and outputs are TEMPORARY - no long-term file ownership
-- State machine: queued → running → (succeeded | failed | cancelled)

-- 1) Create enums for status and mode (safe for re-runs)
DO $$ BEGIN
  CREATE TYPE prepress_job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE prepress_job_mode AS ENUM ('check', 'check_and_fix');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Create prepress_jobs table
CREATE TABLE IF NOT EXISTS prepress_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Multi-tenant: REQUIRED when launched from TitanOS; nullable only for dev/standalone
  organization_id varchar,
  
  -- State machine
  status prepress_job_status NOT NULL DEFAULT 'queued',
  mode prepress_job_mode NOT NULL DEFAULT 'check',
  
  -- File metadata (NEVER store absolute paths - derive from jobId at runtime)
  original_filename varchar(512) NOT NULL,
  content_type varchar(255) NOT NULL,
  size_bytes bigint NOT NULL,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT NOW(),
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz NOT NULL, -- TTL for cleanup
  
  -- Results (populated on completion)
  report_summary jsonb, -- { score, counts, pageCount }
  output_manifest jsonb, -- { proof_png: true, fixed_pdf: true }
  error jsonb, -- { message, code, details }
  
  -- Progress tracking
  progress_message text
);

-- 3) Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS prepress_jobs_org_idx ON prepress_jobs (organization_id);
CREATE INDEX IF NOT EXISTS prepress_jobs_status_idx ON prepress_jobs (status);
CREATE INDEX IF NOT EXISTS prepress_jobs_created_at_idx ON prepress_jobs (created_at);
CREATE INDEX IF NOT EXISTS prepress_jobs_expires_at_idx ON prepress_jobs (expires_at);

-- 4) Add comment for documentation
COMMENT ON TABLE prepress_jobs IS 'Prepress PDF preflight jobs - all files are ephemeral and deleted after TTL expiration';
