CREATE TABLE IF NOT EXISTS organization_payment_settings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  provider varchar(20) NOT NULL DEFAULT 'none',
  eps_enabled boolean NOT NULL DEFAULT false,
  eps_account_number text,
  eps_api_key text,
  eps_cnp_base_url text NOT NULL DEFAULT 'https://postransactions.com/cnp',
  eps_card_present_base_url text NOT NULL DEFAULT 'https://postransactions.com/connet',
  eps_ach_base_url text NOT NULL DEFAULT 'https://postransactions.com/ach',
  eps_gift_base_url text NOT NULL DEFAULT 'https://postransactions.com/gift',
  eps_device_serial_number text,
  eps_supported_modes jsonb NOT NULL DEFAULT '["hosted_cnp","token_cnp","card_present","ach","gift_card"]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_payment_settings_org_uidx
  ON organization_payment_settings (organization_id);

CREATE INDEX IF NOT EXISTS organization_payment_settings_provider_idx
  ON organization_payment_settings (provider);

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_transaction_id text,
  ADD COLUMN IF NOT EXISTS provider_idempotency_key text,
  ADD COLUMN IF NOT EXISTS eps_ptk text,
  ADD COLUMN IF NOT EXISTS eps_hosted_payment_url text,
  ADD COLUMN IF NOT EXISTS eps_mode varchar(32),
  ADD COLUMN IF NOT EXISTS eps_method varchar(32),
  ADD COLUMN IF NOT EXISTS eps_auth_code text,
  ADD COLUMN IF NOT EXISTS eps_response_code text,
  ADD COLUMN IF NOT EXISTS eps_response_message text,
  ADD COLUMN IF NOT EXISTS eps_approved_amount_cents integer,
  ADD COLUMN IF NOT EXISTS eps_token_last4 varchar(8),
  ADD COLUMN IF NOT EXISTS eps_card_type varchar(32);

CREATE UNIQUE INDEX IF NOT EXISTS payments_org_provider_transaction_id_uidx
  ON payments (organization_id, provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_org_provider_idempotency_key_uidx
  ON payments (organization_id, provider, provider_idempotency_key)
  WHERE provider_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_eps_ptk_idx
  ON payments (organization_id, eps_ptk);
