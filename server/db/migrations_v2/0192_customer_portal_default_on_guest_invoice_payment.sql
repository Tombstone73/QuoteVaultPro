-- Customer portal access is default-on. Legacy `disabled` company settings
-- represented rollout state; explicit `suspended` settings remain untouched.
ALTER TABLE customer_portal_company_settings
  ALTER COLUMN state SET DEFAULT 'enabled';

UPDATE customer_portal_company_settings
SET state = 'enabled',
    enabled_at = COALESCE(enabled_at, created_at, now()),
    suspended_at = NULL,
    updated_at = now()
WHERE state = 'disabled';

INSERT INTO customer_portal_company_settings (
  organization_id, customer_id, state, enabled_at, created_at, updated_at
)
SELECT c.organization_id, c.id, 'enabled', now(), now(), now()
FROM customers c
LEFT JOIN customer_portal_company_settings pcs
  ON pcs.organization_id = c.organization_id AND pcs.customer_id = c.id
WHERE pcs.id IS NULL
  AND COALESCE(c.status, 'active') <> 'archived'
ON CONFLICT (organization_id, customer_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS invoice_guest_payment_tokens (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_guest_payment_tokens_hash_uidx ON invoice_guest_payment_tokens(token_hash);
CREATE INDEX IF NOT EXISTS invoice_guest_payment_tokens_invoice_idx ON invoice_guest_payment_tokens(organization_id, invoice_id);
CREATE INDEX IF NOT EXISTS invoice_guest_payment_tokens_expires_idx ON invoice_guest_payment_tokens(expires_at);

ALTER TABLE stripe_payment_attempts DROP CONSTRAINT IF EXISTS stripe_payment_attempts_channel_check;
ALTER TABLE stripe_payment_attempts ADD CONSTRAINT stripe_payment_attempts_channel_check
  CHECK (channel IN ('staff', 'portal', 'guest'));
