CREATE TABLE IF NOT EXISTS customer_portal_company_settings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  state varchar(30) NOT NULL DEFAULT 'disabled',
  enabled_at timestamptz,
  suspended_at timestamptz,
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_portal_access
  ADD COLUMN IF NOT EXISTS access_role varchar(40) NOT NULL DEFAULT 'VIEWER';

CREATE UNIQUE INDEX IF NOT EXISTS customer_portal_company_settings_org_customer_uidx
  ON customer_portal_company_settings (organization_id, customer_id);

CREATE INDEX IF NOT EXISTS customer_portal_company_settings_org_idx
  ON customer_portal_company_settings (organization_id);

CREATE INDEX IF NOT EXISTS customer_portal_company_settings_state_idx
  ON customer_portal_company_settings (state);

CREATE TABLE IF NOT EXISTS customer_portal_onboarding_batches (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status varchar(30) NOT NULL DEFAULT 'pending',
  action varchar(60) NOT NULL,
  total integer NOT NULL DEFAULT 0,
  pending integer NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  accepted integer NOT NULL DEFAULT 0,
  initiated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  summary_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_portal_onboarding_batches_org_idx
  ON customer_portal_onboarding_batches (organization_id);

CREATE INDEX IF NOT EXISTS customer_portal_onboarding_batches_status_idx
  ON customer_portal_onboarding_batches (status);

CREATE INDEX IF NOT EXISTS customer_portal_onboarding_batches_created_idx
  ON customer_portal_onboarding_batches (created_at);

CREATE TABLE IF NOT EXISTS customer_portal_onboarding_batch_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id varchar NOT NULL REFERENCES customer_portal_onboarding_batches(id) ON DELETE CASCADE,
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contact_id varchar REFERENCES customer_contacts(id) ON DELETE SET NULL,
  access_id varchar REFERENCES customer_portal_access(id) ON DELETE SET NULL,
  email varchar(255),
  access_role varchar(40),
  status varchar(30) NOT NULL DEFAULT 'pending',
  failure_code varchar(80),
  failure_message text,
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_portal_onboarding_batch_items_batch_idx
  ON customer_portal_onboarding_batch_items (batch_id);

CREATE INDEX IF NOT EXISTS customer_portal_onboarding_batch_items_org_idx
  ON customer_portal_onboarding_batch_items (organization_id);

CREATE INDEX IF NOT EXISTS customer_portal_onboarding_batch_items_status_idx
  ON customer_portal_onboarding_batch_items (status);
