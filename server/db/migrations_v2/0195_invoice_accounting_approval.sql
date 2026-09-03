ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS accounting_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS accounting_approved_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_approved_version integer,
  ADD COLUMN IF NOT EXISTS accounting_approval_revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS invoices_org_accounting_approval_idx
  ON invoices (organization_id, accounting_approved_version, accounting_approved_at);

COMMENT ON COLUMN invoices.accounting_approved_version IS
  'The invoice_version explicitly approved for QuickBooks/accounting export. Approval is invalid once the accounting version changes.';
