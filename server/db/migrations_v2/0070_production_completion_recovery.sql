ALTER TABLE production_jobs
  ADD COLUMN IF NOT EXISTS completed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS previous_status text,
  ADD COLUMN IF NOT EXISTS previous_station text,
  ADD COLUMN IF NOT EXISTS restore_until timestamptz,
  ADD COLUMN IF NOT EXISTS restored_at timestamptz,
  ADD COLUMN IF NOT EXISTS restored_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS restore_reason text;

CREATE INDEX IF NOT EXISTS production_jobs_org_completed_at_idx
  ON production_jobs (organization_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS production_jobs_org_restore_until_idx
  ON production_jobs (organization_id, restore_until);
