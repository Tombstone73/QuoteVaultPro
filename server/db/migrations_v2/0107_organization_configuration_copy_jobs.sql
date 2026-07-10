CREATE TABLE IF NOT EXISTS organization_configuration_copy_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  source_organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  destination_organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status varchar(32) NOT NULL DEFAULT 'pending',
  requested_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  entity_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_summary text,
  error_details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_configuration_copy_jobs_status_chk
    CHECK (status IN ('pending', 'copying', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS org_config_copy_jobs_source_idx
  ON organization_configuration_copy_jobs(source_organization_id);

CREATE INDEX IF NOT EXISTS org_config_copy_jobs_destination_idx
  ON organization_configuration_copy_jobs(destination_organization_id);

CREATE INDEX IF NOT EXISTS org_config_copy_jobs_status_idx
  ON organization_configuration_copy_jobs(status);

CREATE INDEX IF NOT EXISTS org_config_copy_jobs_created_at_idx
  ON organization_configuration_copy_jobs(created_at);
