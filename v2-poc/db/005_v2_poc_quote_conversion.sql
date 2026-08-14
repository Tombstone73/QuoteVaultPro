-- V2 POC only: durable conversion ownership outside the V1 migration stream.
CREATE TABLE IF NOT EXISTS v2_poc_quote_conversion_requests (
  id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id varchar(160) NOT NULL,
  request_hash varchar(64) NOT NULL, quote_id varchar NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  order_id varchar REFERENCES orders(id) ON DELETE SET NULL, invoice_id varchar REFERENCES invoices(id) ON DELETE SET NULL,
  result_json jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE (organization_id, actor_user_id, request_id)
);
CREATE TABLE IF NOT EXISTS v2_poc_quote_order_conversions (
  id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_id varchar NOT NULL REFERENCES quotes(id) ON DELETE CASCADE, order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT, snapshot_hash varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, quote_id), UNIQUE (organization_id, order_id)
);
