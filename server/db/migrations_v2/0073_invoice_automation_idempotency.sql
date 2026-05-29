ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_creation_source varchar(32) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS billing_milestone varchar(64);

CREATE INDEX IF NOT EXISTS invoices_creation_source_org_idx
  ON invoices (organization_id, invoice_creation_source);

CREATE INDEX IF NOT EXISTS invoices_billing_milestone_org_idx
  ON invoices (organization_id, billing_milestone);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_automation_milestone_uidx
  ON invoices (organization_id, order_id, billing_milestone)
  WHERE invoice_creation_source = 'automation'
    AND order_id IS NOT NULL
    AND billing_milestone IS NOT NULL;
