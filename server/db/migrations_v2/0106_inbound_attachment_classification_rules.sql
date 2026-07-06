-- Migration 0106: Customer-specific inbound attachment classification rules
--
-- Staff can remember attachment classification corrections per customer so
-- future inbound email attachments are categorized before parse evidence is built.

DO $$ BEGIN
  CREATE TYPE inbound_attachment_classification_rule_match_type AS ENUM (
    'filename_contains',
    'filename_starts_with',
    'filename_ends_with',
    'filename_exact',
    'mime_type'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE inbound_attachment_classification_rule_classification AS ENUM (
    'artwork',
    'purchase_order',
    'reference',
    'junk_signature',
    'ignore'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS inbound_attachment_classification_rules (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  customer_id varchar REFERENCES customers(id) ON DELETE cascade,
  sender_domain varchar(255),
  match_type inbound_attachment_classification_rule_match_type NOT NULL,
  match_value text NOT NULL,
  classification inbound_attachment_classification_rule_classification NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  match_count integer NOT NULL DEFAULT 0,
  last_matched_at timestamptz,
  created_by_user_id varchar REFERENCES users(id) ON DELETE set null,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_attachment_class_rules_org_enabled_idx
  ON inbound_attachment_classification_rules(organization_id, enabled);

CREATE INDEX IF NOT EXISTS inbound_attachment_class_rules_org_customer_idx
  ON inbound_attachment_classification_rules(organization_id, customer_id, enabled);

CREATE INDEX IF NOT EXISTS inbound_attachment_class_rules_org_sender_domain_idx
  ON inbound_attachment_classification_rules(organization_id, sender_domain, enabled);

CREATE INDEX IF NOT EXISTS inbound_attachment_class_rules_org_match_idx
  ON inbound_attachment_classification_rules(organization_id, match_type, match_value);
