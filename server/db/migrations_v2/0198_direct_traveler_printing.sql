ALTER TABLE printer_profiles
  ADD COLUMN IF NOT EXISTS location varchar(160),
  ADD COLUMN IF NOT EXISTS windows_queue_name varchar(255),
  ADD COLUMN IF NOT EXISTS print_agent_id varchar REFERENCES local_bridge_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supported_documents jsonb NOT NULL DEFAULT '["traveler"]'::jsonb,
  ADD COLUMN IF NOT EXISTS default_copies integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS trailing_feed_mm numeric(7,2) NOT NULL DEFAULT 0;

ALTER TABLE printer_profiles
  ADD CONSTRAINT printer_profiles_default_copies_check CHECK (default_copies BETWEEN 1 AND 99),
  ADD CONSTRAINT printer_profiles_trailing_feed_check CHECK (trailing_feed_mm >= 0 AND trailing_feed_mm <= 100);

CREATE TYPE direct_print_job_status AS ENUM ('queued', 'claimed', 'rendering', 'submitted', 'failed');

CREATE TABLE direct_print_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  destination_id varchar NOT NULL REFERENCES printer_profiles(id) ON DELETE RESTRICT,
  agent_id varchar NOT NULL REFERENCES local_bridge_agents(id) ON DELETE RESTRICT,
  document_type varchar(40) NOT NULL DEFAULT 'traveler',
  copies integer NOT NULL,
  print_note varchar(1000),
  trailing_feed_mm numeric(7,2) NOT NULL DEFAULT 0,
  status direct_print_job_status NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  submitted_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (copies BETWEEN 1 AND 99)
);
CREATE INDEX direct_print_jobs_agent_queue_idx ON direct_print_jobs(agent_id, status, created_at);
CREATE INDEX direct_print_jobs_org_idx ON direct_print_jobs(organization_id, created_at);
