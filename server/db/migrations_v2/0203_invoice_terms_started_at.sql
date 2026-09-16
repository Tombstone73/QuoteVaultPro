-- Accounting approval is the single durable start of an invoice payment-term
-- clock. Existing invoices remain NULL and are intentionally not backfilled.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS terms_started_at timestamptz;

COMMENT ON COLUMN invoices.terms_started_at IS
  'Timestamp of the first accounting approval that started payment terms. NULL means no approved terms clock was recorded.';
