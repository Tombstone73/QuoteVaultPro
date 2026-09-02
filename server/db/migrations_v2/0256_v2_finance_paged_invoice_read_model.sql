-- Finance pages and A/R aggregates are tenant-scoped relational reads.  These
-- indexes support the normalized V2/compatibility projection without storing
-- a second copy of financial truth.
CREATE INDEX IF NOT EXISTS v2_billing_invoices_org_updated_id_finance_idx
  ON v2_billing_invoices(organization_id,updated_at DESC,id);
CREATE INDEX IF NOT EXISTS v2_billing_payment_allocations_org_invoice_amount_finance_idx
  ON v2_billing_payment_allocations(organization_id,invoice_id) INCLUDE(amount_cents);
CREATE INDEX IF NOT EXISTS v2_billing_refunds_org_invoice_amount_finance_idx
  ON v2_billing_refunds(organization_id,invoice_id) INCLUDE(amount_cents);
CREATE INDEX IF NOT EXISTS invoices_org_updated_id_finance_idx
  ON invoices(organization_id,updated_at DESC,id);
CREATE INDEX IF NOT EXISTS invoices_org_display_number_finance_idx
  ON invoices(organization_id,display_number);
