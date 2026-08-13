-- Disposable-clone-only V2 experiment DDL. Do not add this to server/db/migrations_v2.
CREATE TABLE IF NOT EXISTS v2_poc_order_create_requests (
  id varchar(64) PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation varchar(64) NOT NULL,
  request_id varchar(160) NOT NULL,
  request_hash varchar(64) NOT NULL,
  order_id varchar REFERENCES orders(id) ON DELETE SET NULL,
  invoice_id varchar REFERENCES invoices(id) ON DELETE SET NULL,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT v2_poc_order_create_requests_scope_unique UNIQUE (organization_id, actor_user_id, operation, request_id)
);
