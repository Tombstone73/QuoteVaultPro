-- Disposable V2 POC only. A business request is deliberately principal-neutral:
-- retries by a staff member, delegated AI, portal user, or service share one result.
CREATE TABLE IF NOT EXISTS v2_poc_business_requests (
  id varchar(96) PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  operation varchar(64) NOT NULL,
  business_request_id varchar(160) NOT NULL,
  request_hash varchar(64) NOT NULL,
  order_id varchar REFERENCES orders(id) ON DELETE SET NULL,
  invoice_id varchar REFERENCES invoices(id) ON DELETE SET NULL,
  initiating_principal_kind varchar(16) NOT NULL,
  initiating_principal_id varchar(160) NOT NULL,
  staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT v2_poc_business_requests_scope_unique UNIQUE (organization_id, operation, business_request_id)
);
