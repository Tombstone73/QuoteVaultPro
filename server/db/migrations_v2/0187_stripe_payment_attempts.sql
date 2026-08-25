-- Durable Stripe PaymentIntent collection attempts. A row is reserved before
-- the Stripe call so a retry reuses the same idempotency key. These rows are
-- not financial effects; signed webhook reconciliation remains authoritative.

CREATE TABLE IF NOT EXISTS stripe_payment_attempts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  channel varchar(20) NOT NULL CHECK (channel IN ('staff', 'portal')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency varchar(8) NOT NULL DEFAULT 'USD',
  stripe_account_id text NOT NULL,
  idempotency_key text NOT NULL,
  stripe_payment_intent_id text,
  payment_id varchar REFERENCES payments(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'pending', 'succeeded', 'failed', 'canceled')),
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS stripe_payment_attempts_org_idempotency_uidx
  ON stripe_payment_attempts (organization_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS stripe_payment_attempts_org_intent_uidx
  ON stripe_payment_attempts (organization_id, stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stripe_payment_attempts_one_active_invoice_uidx
  ON stripe_payment_attempts (organization_id, invoice_id)
  WHERE status IN ('reserved', 'pending');
CREATE INDEX IF NOT EXISTS stripe_payment_attempts_invoice_idx
  ON stripe_payment_attempts (organization_id, invoice_id);
CREATE INDEX IF NOT EXISTS stripe_payment_attempts_status_idx
  ON stripe_payment_attempts (status);
