-- M6: Native V2 Invoice numbers are derived from the immutable Order / Job
-- display number at issuance.  Drafts intentionally have no Invoice number.
-- The issuing transaction locks the Order header before assigning the suffix.

ALTER TABLE v2_billing_invoices
  ADD COLUMN invoice_display_number varchar(80),
  ADD COLUMN invoice_sequence integer;

ALTER TABLE v2_billing_invoices
  ADD CONSTRAINT v2_billing_invoices_display_number_state_chk CHECK (
    (invoice_state = 'draft' AND invoice_display_number IS NULL AND invoice_sequence IS NULL)
    OR (invoice_state IN ('issued', 'void') AND length(btrim(invoice_display_number)) > 0 AND invoice_sequence > 0)
  ) NOT VALID;

CREATE UNIQUE INDEX v2_billing_invoices_org_display_number_uidx
  ON v2_billing_invoices (organization_id, invoice_display_number)
  WHERE invoice_display_number IS NOT NULL;
