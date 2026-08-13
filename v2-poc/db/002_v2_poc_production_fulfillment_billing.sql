-- Experimental V2-only persistence. This file is installed only by the V2
-- PostgreSQL harness; it is intentionally not part of the V1 migration stream.
CREATE TABLE IF NOT EXISTS v2_poc_fulfillment_requests (
  id varchar(96) PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation varchar(80) NOT NULL,
  request_id varchar(160) NOT NULL,
  request_hash varchar(64) NOT NULL,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, actor_user_id, operation, request_id)
);

CREATE TABLE IF NOT EXISTS v2_poc_billing_reconciliations (
  id varchar(96) PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  fulfillment_event_id varchar NOT NULL REFERENCES fulfillment_events(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, fulfillment_event_id)
);
