-- Migration 0102: Inbound email ignore rules
--
-- Adds organization-scoped rules for skipping recurring non-order emails
-- before TEMP_INBOUND records are created.

ALTER TYPE inbound_order_record_status ADD VALUE IF NOT EXISTS 'ignored';

CREATE TABLE IF NOT EXISTS inbound_email_ignore_rules (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  rule_type varchar(50) NOT NULL,
  rule_value varchar(500) NOT NULL,
  notes text,
  match_count integer NOT NULL DEFAULT 0,
  last_matched_at timestamp with time zone,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_email_ignore_rules_org_enabled_idx
  ON inbound_email_ignore_rules (organization_id, enabled);

CREATE INDEX IF NOT EXISTS inbound_email_ignore_rules_org_type_value_idx
  ON inbound_email_ignore_rules (organization_id, rule_type, rule_value);

CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_ignore_rules_org_type_value_uidx
  ON inbound_email_ignore_rules (organization_id, rule_type, rule_value);
