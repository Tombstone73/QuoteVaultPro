-- Migration 0099: Inbound order parse attempts
--
-- Stores review-only AI parse attempts for inbound order records.
-- This migration does not create orders, quotes, customers, products,
-- artwork, production jobs, fulfillment records, invoices, or payments.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_order_parse_attempt_status') THEN
    CREATE TYPE inbound_order_parse_attempt_status AS ENUM (
      'success',
      'failed',
      'repaired',
      'fallback'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS inbound_order_parse_attempts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inbound_order_record_id varchar NOT NULL REFERENCES inbound_order_records(id) ON DELETE CASCADE,
  status inbound_order_parse_attempt_status NOT NULL,
  provider varchar(100),
  model varchar(160),
  raw_prompt_hash varchar(128),
  raw_response jsonb,
  repaired_response jsonb,
  parsed_draft jsonb,
  confidence integer,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_order_parse_attempts_org_record_created_idx
  ON inbound_order_parse_attempts (organization_id, inbound_order_record_id, created_at);

CREATE INDEX IF NOT EXISTS inbound_order_parse_attempts_org_status_created_idx
  ON inbound_order_parse_attempts (organization_id, status, created_at);
