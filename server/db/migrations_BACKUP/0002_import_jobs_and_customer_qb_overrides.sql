-- Import Jobs + per-customer QB override flags
-- Safe, additive migration.

-- 1) Customers: QB field override map
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS qb_field_overrides jsonb;

-- 2) Enums (create-if-not-exists pattern)
DO $$ BEGIN
  CREATE TYPE import_resource AS ENUM ('customers', 'materials', 'products');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE import_job_status AS ENUM ('validated', 'applied', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE import_apply_mode AS ENUM ('MERGE_RESPECT_OVERRIDES', 'MERGE_AND_SET_OVERRIDES');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE import_row_status AS ENUM ('valid', 'invalid', 'applied', 'skipped', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3) import_jobs table
CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource import_resource NOT NULL,
  status import_job_status NOT NULL DEFAULT 'validated',
  apply_mode import_apply_mode NOT NULL DEFAULT 'MERGE_RESPECT_OVERRIDES',
  source_filename varchar(255),
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  summary_json jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_jobs_organization_id_idx ON import_jobs(organization_id);
CREATE INDEX IF NOT EXISTS import_jobs_resource_status_idx ON import_jobs(resource, status);
CREATE INDEX IF NOT EXISTS import_jobs_created_at_idx ON import_jobs(created_at);

-- 4) import_job_rows table
CREATE TABLE IF NOT EXISTS import_job_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  status import_row_status NOT NULL DEFAULT 'valid',
  raw_json jsonb,
  normalized_json jsonb,
  error text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_job_rows_organization_id_idx ON import_job_rows(organization_id);
CREATE INDEX IF NOT EXISTS import_job_rows_job_id_idx ON import_job_rows(job_id);
CREATE INDEX IF NOT EXISTS import_job_rows_status_idx ON import_job_rows(status);
