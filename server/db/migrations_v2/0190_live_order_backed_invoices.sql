-- Order-backed invoices are live receivables. Preserve their immutable
-- payment rows and remove only the obsolete manual-finalization gate.
UPDATE invoices
SET
  status = 'billed',
  issued_at = COALESCE(issued_at, issue_date, created_at),
  updated_at = NOW()
WHERE order_id IS NOT NULL
  AND LOWER(status) = 'draft'
  AND COALESCE(LOWER(import_source), '') <> 'quickbooks';

UPDATE orders
SET
  billing_status = 'billed',
  updated_at = NOW()
WHERE id IN (
  SELECT order_id
  FROM invoices
  WHERE order_id IS NOT NULL
    AND LOWER(status) = 'billed'
    AND COALESCE(LOWER(import_source), '') <> 'quickbooks'
);
