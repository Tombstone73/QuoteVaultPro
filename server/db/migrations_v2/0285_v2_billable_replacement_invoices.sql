-- M7.8I: a billable replacement remains on its source Order but owns one
-- separately numbered canonical Billing Invoice.  The Invoice stays draft
-- until the ordinary Invoice issuance workflow is explicitly invoked.
ALTER TABLE v2_billing_invoices
  ADD COLUMN replacement_obligation_id varchar;

ALTER TABLE v2_billing_invoices
  ADD CONSTRAINT v2_billing_invoices_replacement_obligation_fk
  FOREIGN KEY(replacement_obligation_id,organization_id)
  REFERENCES v2_order_replacement_obligations(id,organization_id) ON DELETE RESTRICT;

DROP INDEX v2_billing_invoices_one_draft_per_order_uidx;
CREATE UNIQUE INDEX v2_billing_invoices_one_primary_draft_per_order_uidx
  ON v2_billing_invoices(organization_id,sales_order_document_id)
  WHERE invoice_state='draft' AND replacement_obligation_id IS NULL;
CREATE UNIQUE INDEX v2_billing_invoices_replacement_obligation_uidx
  ON v2_billing_invoices(organization_id,replacement_obligation_id)
  WHERE replacement_obligation_id IS NOT NULL;
CREATE UNIQUE INDEX v2_billing_invoices_replacement_sequence_uidx
  ON v2_billing_invoices(organization_id,sales_order_document_id,invoice_sequence)
  WHERE replacement_obligation_id IS NOT NULL;

ALTER TABLE v2_billing_invoices
  DROP CONSTRAINT v2_billing_invoices_display_number_state_chk;
ALTER TABLE v2_billing_invoices
  ADD CONSTRAINT v2_billing_invoices_display_number_state_chk CHECK (
    (invoice_state='draft' AND (
      (replacement_obligation_id IS NULL AND invoice_display_number IS NULL AND invoice_sequence IS NULL)
      OR
      (replacement_obligation_id IS NOT NULL AND invoice_display_number IS NOT NULL AND length(btrim(invoice_display_number))>0 AND invoice_sequence IS NOT NULL AND invoice_sequence BETWEEN 2 AND 26)
    ))
    OR
    (invoice_state IN ('issued','void') AND invoice_display_number IS NOT NULL AND length(btrim(invoice_display_number))>0 AND invoice_sequence IS NOT NULL AND invoice_sequence>0)
  ) NOT VALID;

ALTER TABLE v2_order_replacement_obligation_events
  DROP CONSTRAINT v2_replacement_obligation_events_kind_chk;
ALTER TABLE v2_order_replacement_obligation_events
  ADD CONSTRAINT v2_replacement_obligation_events_kind_chk CHECK(event_kind IN (
    'created','production_authority_created','production_satisfied','fulfillment_satisfied',
    'completed','cancelled','corrected','billable_invoice_created'
  ));

-- The preallocated replacement number is immutable while the Invoice remains
-- a draft and must survive the ordinary later issue operation.  This is
-- deliberately scoped to replacement-linked rows; it changes no primary
-- Invoice numbering behavior.
CREATE OR REPLACE FUNCTION v2_billing_preserve_replacement_invoice_number() RETURNS trigger AS $$
BEGIN
  IF OLD.replacement_obligation_id IS NOT NULL THEN
    IF NEW.replacement_obligation_id IS DISTINCT FROM OLD.replacement_obligation_id THEN
      RAISE EXCEPTION 'Replacement Invoice obligation identity is immutable.';
    END IF;
    IF OLD.invoice_display_number IS NOT NULL THEN
      NEW.invoice_display_number := OLD.invoice_display_number;
      NEW.invoice_sequence := OLD.invoice_sequence;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER v2_billing_preserve_replacement_invoice_number_trigger
  BEFORE UPDATE ON v2_billing_invoices
  FOR EACH ROW EXECUTE FUNCTION v2_billing_preserve_replacement_invoice_number();
