CREATE TABLE IF NOT EXISTS customer_contact_quickbooks_source_snapshots (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_mode varchar(20) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'ready',
  connected_company_name varchar(255),
  quickbooks_company_id varchar(64),
  last_successful_sync_at timestamp,
  retrieved_count integer NOT NULL DEFAULT 0,
  raw_customers_json jsonb,
  api_error text,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cc_qb_source_snapshots_org_created_idx
  ON customer_contact_quickbooks_source_snapshots (organization_id, created_at);

CREATE INDEX IF NOT EXISTS cc_qb_source_snapshots_org_status_idx
  ON customer_contact_quickbooks_source_snapshots (organization_id, status);
