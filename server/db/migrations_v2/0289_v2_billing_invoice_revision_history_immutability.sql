-- M7.8I: live Invoice projections may advance, but each recorded revision is
-- historical evidence. Reuse Billing's existing INSERT-only immutable-history
-- validator; the trigger intentionally permits INSERT and rejects UPDATE/DELETE.
CREATE TRIGGER v2_billing_invoice_revision_immutable_trigger
  BEFORE UPDATE OR DELETE ON v2_billing_invoice_revisions
  FOR EACH ROW EXECUTE FUNCTION v2_billing_invoice_checkpoint_immutable_validate();
