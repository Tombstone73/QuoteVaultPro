-- V2 POC-only financial durability. Existing invoice/payment rows remain the
-- compatibility surface; these tables never enter the V1 migration stream.
CREATE TABLE IF NOT EXISTS v2_poc_financial_requests (
  id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, operation varchar(64) NOT NULL,
  request_id varchar(160) NOT NULL, request_hash varchar(64) NOT NULL, result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE (organization_id, actor_user_id, operation, request_id)
);
CREATE TABLE IF NOT EXISTS v2_poc_financial_refunds (
  id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  payment_id varchar NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0), method varchar(32) NOT NULL,
  provider varchar(32), provider_refund_id varchar(160), status varchar(20) NOT NULL DEFAULT 'SUCCEEDED',
  actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, provider_refund_id)
);
CREATE TABLE IF NOT EXISTS v2_poc_financial_reconciliations (
  id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, operation varchar(64) NOT NULL,
  external_key varchar(160) NOT NULL, status varchar(20) NOT NULL DEFAULT 'PENDING', attempts integer NOT NULL DEFAULT 0,
  payload_json jsonb NOT NULL, result_json jsonb, last_error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE (organization_id, operation, external_key)
);
ALTER TABLE v2_poc_financial_reconciliations ADD COLUMN IF NOT EXISTS provider varchar(32);
ALTER TABLE v2_poc_financial_reconciliations ADD COLUMN IF NOT EXISTS provider_event_id varchar(160);
ALTER TABLE v2_poc_financial_reconciliations ADD COLUMN IF NOT EXISTS provider_transaction_id varchar(160);
ALTER TABLE v2_poc_financial_reconciliations ADD COLUMN IF NOT EXISTS currency varchar(8) NOT NULL DEFAULT 'USD';
CREATE UNIQUE INDEX IF NOT EXISTS v2_poc_financial_reconciliations_provider_event_uidx
  ON v2_poc_financial_reconciliations(provider, provider_event_id) WHERE provider_event_id IS NOT NULL;
