-- Production MVP: production_jobs + production_events (append-only)
-- Flatbed ships first; modular plumbing for future views.
-- Multi-tenant: all rows scoped by organization_id.

CREATE TABLE IF NOT EXISTS production_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  total_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT production_jobs_status_chk CHECK (status IN ('queued','in_progress','done'))
);

-- Idempotent: one production job per (org, order)
CREATE UNIQUE INDEX IF NOT EXISTS production_jobs_org_order_uidx
  ON production_jobs (organization_id, order_id);

CREATE INDEX IF NOT EXISTS production_jobs_org_status_idx
  ON production_jobs (organization_id, status);

CREATE INDEX IF NOT EXISTS production_jobs_order_id_idx
  ON production_jobs (order_id);

-- Keep updated_at accurate on UPDATE (repo does not have a shared trigger helper today)
CREATE OR REPLACE FUNCTION production_jobs_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS production_jobs_set_updated_at_trg ON production_jobs;
CREATE TRIGGER production_jobs_set_updated_at_trg
BEFORE UPDATE ON production_jobs
FOR EACH ROW
EXECUTE FUNCTION production_jobs_set_updated_at();

CREATE TABLE IF NOT EXISTS production_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  production_job_id varchar NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  type varchar(40) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_events_org_job_created_idx
  ON production_events (organization_id, production_job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS production_events_org_type_created_idx
  ON production_events (organization_id, type, created_at DESC);
