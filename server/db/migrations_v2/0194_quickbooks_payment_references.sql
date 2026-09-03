-- Durable, human-readable QBO PaymentRefNum fallback for payments that have no
-- operator-entered check/transaction reference. This is intentionally separate
-- from provider IDs and UUIDs, which must never be presented as QBO DocNumber.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS quickbooks_payment_reference varchar(21);

CREATE UNIQUE INDEX IF NOT EXISTS payments_org_quickbooks_payment_reference_uidx
  ON payments (organization_id, quickbooks_payment_reference)
  WHERE quickbooks_payment_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_quickbooks_payment_reference_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.quickbooks_payment_reference IS NOT NULL
    AND NEW.quickbooks_payment_reference IS DISTINCT FROM OLD.quickbooks_payment_reference THEN
    RAISE EXCEPTION 'payments.quickbooks_payment_reference is immutable once assigned';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payments_quickbooks_payment_reference_immutable_trg ON payments;
CREATE TRIGGER payments_quickbooks_payment_reference_immutable_trg
BEFORE UPDATE OF quickbooks_payment_reference ON payments
FOR EACH ROW
EXECUTE FUNCTION prevent_quickbooks_payment_reference_update();

COMMENT ON COLUMN payments.quickbooks_payment_reference IS
  'Stable organization-scoped PrintersHero reference used as QuickBooks PaymentRefNum when no valid operator-entered reference is available.';
