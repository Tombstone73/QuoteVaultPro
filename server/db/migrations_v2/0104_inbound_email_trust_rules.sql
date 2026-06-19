-- Org-scoped trust rules for inbound Gmail attachment auto-download decisions.
-- These rules are intentionally separate from ignore rules: ignored mail controls
-- queue admission, while trust rules only control attachment download safety.

CREATE TABLE IF NOT EXISTS inbound_email_trust_rules (
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

CREATE INDEX IF NOT EXISTS inbound_email_trust_rules_org_enabled_idx
  ON inbound_email_trust_rules (organization_id, enabled);

CREATE INDEX IF NOT EXISTS inbound_email_trust_rules_org_type_value_idx
  ON inbound_email_trust_rules (organization_id, rule_type, rule_value);

CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_trust_rules_org_type_value_uidx
  ON inbound_email_trust_rules (organization_id, rule_type, rule_value);
