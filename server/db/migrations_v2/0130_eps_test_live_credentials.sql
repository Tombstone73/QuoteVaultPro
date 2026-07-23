-- EPS credentials are split by active environment. API keys are encrypted by
-- the application before persistence; the legacy plaintext column is not used
-- by the active credential resolver.
ALTER TABLE organization_payment_settings
  ADD COLUMN IF NOT EXISTS eps_mode varchar(8) NOT NULL DEFAULT 'test'
    CHECK (eps_mode IN ('test', 'live')),
  ADD COLUMN IF NOT EXISTS eps_test_account_number text,
  ADD COLUMN IF NOT EXISTS eps_test_encrypted_api_key text,
  ADD COLUMN IF NOT EXISTS eps_test_encryption_key_id text,
  ADD COLUMN IF NOT EXISTS eps_test_base_url text NOT NULL DEFAULT 'https://postransactions.com/cnp',
  ADD COLUMN IF NOT EXISTS eps_live_account_number text,
  ADD COLUMN IF NOT EXISTS eps_live_encrypted_api_key text,
  ADD COLUMN IF NOT EXISTS eps_live_encryption_key_id text,
  ADD COLUMN IF NOT EXISTS eps_live_base_url text NOT NULL DEFAULT 'https://postransactions.com/cnp';
