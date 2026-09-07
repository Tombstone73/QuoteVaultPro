-- M7.5I-C: a Payment is one real-world tender. Its Invoice relationships are
-- immutable allocations; `payments.invoice_id` remains a legacy compatibility
-- anchor only until old readers have been removed.
ALTER TABLE v2_billing_payment_allocations
  DROP CONSTRAINT IF EXISTS v2_billing_payment_allocations_payment_uidx;

ALTER TABLE v2_billing_payment_allocations
  ADD CONSTRAINT v2_billing_payment_allocations_payment_invoice_uidx
  UNIQUE (payment_id, invoice_id);

CREATE INDEX v2_billing_payment_allocations_invoice_history_idx
  ON v2_billing_payment_allocations(organization_id, invoice_id, created_at DESC);

-- A provider operation must carry a durable, database-owned allocation intent
-- before a provider request is made. It is recovery evidence, not provider
-- metadata and never depends on Stripe retaining a serialized allocation list.
ALTER TABLE v2_billing_provider_financial_operations
  ADD COLUMN IF NOT EXISTS allocation_intent jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE v2_billing_provider_financial_operations
  ADD CONSTRAINT v2_billing_provider_financial_operations_allocation_intent_array_chk
  CHECK (jsonb_typeof(allocation_intent) = 'array') NOT VALID;

ALTER TABLE v2_billing_provider_financial_operations
  VALIDATE CONSTRAINT v2_billing_provider_financial_operations_allocation_intent_array_chk;

COMMENT ON COLUMN v2_billing_payments.invoice_id IS
  'Compatibility anchor only. Canonical Invoice relationship is v2_billing_payment_allocations.';
COMMENT ON COLUMN v2_billing_provider_financial_operations.allocation_intent IS
  'Immutable canonical Payment allocation intent for provider payment recovery.';

-- Safe, idempotent historical backfill: every old one-invoice Payment has an
-- unambiguous source invoice. Never guess for a Payment that already has an
-- allocation; those facts remain immutable.
INSERT INTO v2_billing_payment_allocations(id, organization_id, payment_id, invoice_id, amount_cents)
SELECT
  'payalloc_backfill_' || md5(p.id),
  p.organization_id,
  p.id,
  p.invoice_id,
  p.amount_cents
FROM v2_billing_payments p
WHERE NOT EXISTS (
  SELECT 1
  FROM v2_billing_payment_allocations a
  WHERE a.organization_id=p.organization_id AND a.payment_id=p.id
)
ON CONFLICT (payment_id, invoice_id) DO NOTHING;

-- Do not silently bless a pre-existing corrupted legacy relationship.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM v2_billing_payments p
    WHERE NOT EXISTS (
      SELECT 1 FROM v2_billing_payment_allocations a
      WHERE a.organization_id=p.organization_id AND a.payment_id=p.id
    )
    OR NOT EXISTS (
      SELECT 1 FROM v2_billing_payment_allocations a
      WHERE a.organization_id=p.organization_id AND a.payment_id=p.id AND a.invoice_id=p.invoice_id
    )
    OR p.amount_cents <> (
      SELECT COALESCE(sum(a.amount_cents), 0)
      FROM v2_billing_payment_allocations a
      WHERE a.organization_id=p.organization_id AND a.payment_id=p.id
    )
  ) THEN
    RAISE EXCEPTION 'Payment allocation backfill found an ambiguous historic Payment; reconcile it before enabling multi-invoice payments.';
  END IF;
END $$;
