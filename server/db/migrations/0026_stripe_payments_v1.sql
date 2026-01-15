-- Stripe Payments v1 (PaymentIntent + webhook idempotency)
-- Additive migration: extends existing payments table and adds payment_webhook_events

-- 1) Payments table: tenant + provider state + Stripe linkage
ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS organization_id varchar;

-- Backfill organization_id from invoices
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='organization_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='invoice_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='organization_id') THEN
    UPDATE payments p
      SET organization_id = i.organization_id
    FROM invoices i
    WHERE p.invoice_id = i.id
      AND p.organization_id IS NULL;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_organization_id_fkey'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_organization_id_fkey
      FOREIGN KEY (organization_id)
      REFERENCES organizations(id)
      ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

-- Provider + status + currency + Stripe intent
ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS provider varchar(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'succeeded',
  ADD COLUMN IF NOT EXISTS currency varchar(8) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS succeeded_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Allow webhook-recovery inserts (created_by_user_id optional)
ALTER TABLE IF EXISTS payments
  ALTER COLUMN created_by_user_id DROP NOT NULL;

-- Organization must be present once backfilled
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='organization_id') THEN
    -- If any nulls remain, keep column nullable (fail-soft). Webhook recovery uses metadata org.
    IF NOT EXISTS (SELECT 1 FROM payments WHERE organization_id IS NULL LIMIT 1) THEN
      ALTER TABLE payments ALTER COLUMN organization_id SET NOT NULL;
    END IF;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS payments_organization_id_idx ON payments (organization_id);
CREATE INDEX IF NOT EXISTS payments_provider_idx ON payments (provider);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);

-- Unique per-org Stripe PaymentIntent (nulls allowed)
CREATE UNIQUE INDEX IF NOT EXISTS payments_org_stripe_payment_intent_id_uidx
  ON payments (organization_id, stripe_payment_intent_id);

-- 2) Webhook events table: idempotency + audit trail
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(20) NOT NULL,
  event_id text NOT NULL,
  type text NOT NULL,
  organization_id varchar,
  status varchar(20) NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  payload jsonb NOT NULL,
  error text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_webhook_events_organization_id_fkey'
  ) THEN
    ALTER TABLE payment_webhook_events
      ADD CONSTRAINT payment_webhook_events_organization_id_fkey
      FOREIGN KEY (organization_id)
      REFERENCES organizations(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_provider_event_id_uidx
  ON payment_webhook_events (provider, event_id);

CREATE INDEX IF NOT EXISTS payment_webhook_events_org_id_idx ON payment_webhook_events (organization_id);
CREATE INDEX IF NOT EXISTS payment_webhook_events_received_at_idx ON payment_webhook_events (received_at);
CREATE INDEX IF NOT EXISTS payment_webhook_events_status_idx ON payment_webhook_events (status);
