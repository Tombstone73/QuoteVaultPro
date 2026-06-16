-- Migration 0101: Dedicated inbound email mailbox configuration
--
-- Adds org-scoped mailbox configuration for inbound intake. This is separate
-- from outbound email settings and does not create quotes, orders, proofs,
-- production jobs, invoices, fulfillment records, payments, or shipments.

CREATE TABLE IF NOT EXISTS inbound_email_mailboxes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_id varchar REFERENCES inbound_order_sources(id) ON DELETE SET NULL,
  provider varchar(50) NOT NULL DEFAULT 'gmail',
  name varchar(255) NOT NULL,
  email_address varchar(255) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT true,
  auth_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_pulled_at timestamp with time zone,
  last_pull_status varchar(50),
  last_pull_error text,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_email_mailboxes_org_enabled_idx
  ON inbound_email_mailboxes (organization_id, enabled);

CREATE INDEX IF NOT EXISTS inbound_email_mailboxes_org_provider_idx
  ON inbound_email_mailboxes (organization_id, provider);

CREATE INDEX IF NOT EXISTS inbound_email_mailboxes_org_source_idx
  ON inbound_email_mailboxes (organization_id, source_id);

CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_mailboxes_org_email_uidx
  ON inbound_email_mailboxes (organization_id, email_address);
