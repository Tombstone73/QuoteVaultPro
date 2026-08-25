-- Durable Stripe refund initiation reservations. These are intentionally
-- separate from payments so an unconfirmed refund never changes an invoice
-- balance; signed webhook reconciliation remains authoritative.

CREATE TABLE IF NOT EXISTS stripe_refund_requests (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id varchar NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_id varchar NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  stripe_payment_intent_id text NOT NULL,
  stripe_account_id text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency varchar(8) NOT NULL DEFAULT 'USD',
  idempotency_key text NOT NULL,
  stripe_refund_id text,
  status varchar(20) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'submitted', 'succeeded', 'failed')),
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS stripe_refund_requests_org_idempotency_uidx
  ON stripe_refund_requests (organization_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS stripe_refund_requests_org_stripe_refund_uidx
  ON stripe_refund_requests (organization_id, stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stripe_refund_requests_payment_idx
  ON stripe_refund_requests (organization_id, payment_id);
CREATE INDEX IF NOT EXISTS stripe_refund_requests_invoice_idx
  ON stripe_refund_requests (organization_id, invoice_id);
CREATE INDEX IF NOT EXISTS stripe_refund_requests_status_idx
  ON stripe_refund_requests (status);
