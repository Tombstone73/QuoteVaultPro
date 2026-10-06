-- Imported invoices must never become collectible solely because no local Payment exists.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS historical_ar_state varchar(40);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS historical_ar_source_balance_cents integer;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS historical_ar_approved_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS historical_ar_approved_by_user_id varchar REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS historical_ar_approval_evidence jsonb;

ALTER TABLE invoices ADD CONSTRAINT invoices_historical_ar_state_check
  CHECK (historical_ar_state IS NULL OR historical_ar_state IN
    ('historical_closed', 'historical_open_ar_reconciled', 'historical_review_required'));
ALTER TABLE invoices ADD CONSTRAINT invoices_historical_ar_source_balance_check
  CHECK (historical_ar_source_balance_cents IS NULL OR historical_ar_source_balance_cents >= 0);
ALTER TABLE invoices ADD CONSTRAINT invoices_historical_ar_open_evidence_check
  CHECK (historical_ar_state <> 'historical_open_ar_reconciled' OR
    (import_source IS NOT NULL AND historical_ar_source_balance_cents > 0
      AND historical_ar_approved_at IS NOT NULL
      AND historical_ar_approved_by_user_id IS NOT NULL
      AND historical_ar_approval_evidence IS NOT NULL
      AND jsonb_typeof(historical_ar_approval_evidence) = 'object'
      AND historical_ar_approval_evidence ?& array['sourceInvoiceId','customerId','sourceStatus','sourceDate','paymentEvidence','originalCents','remainingCents']
      AND historical_ar_approval_evidence ->> 'customerId' = customer_id
      AND historical_ar_approval_evidence ->> 'sourceInvoiceId' = coalesce(external_accounting_id, qb_invoice_id)
      AND CASE WHEN jsonb_typeof(historical_ar_approval_evidence -> 'remainingCents') = 'number'
        THEN (historical_ar_approval_evidence ->> 'remainingCents')::numeric = historical_ar_source_balance_cents
        ELSE false END
      AND CASE WHEN jsonb_typeof(historical_ar_approval_evidence -> 'originalCents') = 'number'
        THEN (historical_ar_approval_evidence ->> 'originalCents')::numeric = total_cents
          AND (historical_ar_approval_evidence ->> 'originalCents')::numeric >= historical_ar_source_balance_cents
          AND mod((historical_ar_approval_evidence ->> 'originalCents')::numeric, 1) = 0
        ELSE false END));

-- Source-verified zero-balance QB imports can be classified without inventing
-- Payment rows. Every nonzero/ambiguous legacy import remains review-required.
UPDATE invoices SET
  historical_ar_state = CASE
    WHEN import_source = 'quickbooks' AND qb_import_balance_due IS NOT NULL
      AND qb_import_balance_due::numeric = 0 THEN 'historical_closed'
    ELSE 'historical_review_required' END,
  historical_ar_source_balance_cents = CASE
    WHEN import_source = 'quickbooks' AND qb_import_balance_due IS NOT NULL
      THEN greatest(0, round(qb_import_balance_due::numeric * 100))::integer
    ELSE NULL END
WHERE import_source IS NOT NULL AND historical_ar_state IS NULL;

CREATE INDEX IF NOT EXISTS invoices_historical_ar_state_org_idx
  ON invoices(organization_id, historical_ar_state);
