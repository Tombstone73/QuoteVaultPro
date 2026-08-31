-- M6: each tenant is the merchant of record through its own Stripe Accounts v2
-- merchant configuration.  PrintersHero only holds the platform credentials.
CREATE TABLE v2_stripe_connect_accounts (
  organization_id varchar PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_account_id varchar(200) UNIQUE,
  mode varchar(12) NOT NULL DEFAULT 'unknown',
  state varchar(32) NOT NULL DEFAULT 'not_connected',
  account_display_name varchar(200),
  card_payments_status varchar(32),
  payouts_status varchar(32),
  requirements_due_count integer NOT NULL DEFAULT 0,
  dashboard varchar(32) NOT NULL DEFAULT 'full',
  fees_collector varchar(32) NOT NULL DEFAULT 'stripe',
  losses_collector varchar(32) NOT NULL DEFAULT 'stripe',
  configuration varchar(32) NOT NULL DEFAULT 'merchant',
  connected_at timestamptz,
  disconnected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_stripe_connect_accounts_mode_chk CHECK (mode IN ('test','live','unknown')),
  CONSTRAINT v2_stripe_connect_accounts_state_chk CHECK (state IN ('not_connected','onboarding','requirements_due','ready','reconnect_required','disconnected','error')),
  CONSTRAINT v2_stripe_connect_accounts_model_chk CHECK (dashboard='full' AND fees_collector='stripe' AND losses_collector='stripe' AND configuration='merchant')
);

CREATE TABLE v2_stripe_connect_audit_events (
  id varchar PRIMARY KEY,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_account_id varchar(200),
  event_type varchar(80) NOT NULL,
  principal_kind varchar(32),
  principal_subject varchar(160),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE v2_billing_provider_financial_operations ADD COLUMN stripe_account_id varchar(200);
ALTER TABLE v2_billing_payments ADD COLUMN stripe_account_id varchar(200);
ALTER TABLE v2_billing_refunds ADD COLUMN stripe_account_id varchar(200);
ALTER TABLE v2_billing_provider_events ADD COLUMN stripe_account_id varchar(200);
CREATE INDEX v2_billing_provider_ops_stripe_account_idx ON v2_billing_provider_financial_operations(organization_id,stripe_account_id) WHERE stripe_account_id IS NOT NULL;
