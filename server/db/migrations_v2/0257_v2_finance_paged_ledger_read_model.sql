-- The Finance ledger is a read-only, tenant-scoped compatibility projection.
-- Source indexes keep bounded ordered pages from degrading as immutable facts grow.
CREATE INDEX IF NOT EXISTS v2_billing_payments_org_occurred_id_finance_ledger_idx
  ON v2_billing_payments(organization_id,occurred_at DESC,recorded_at DESC,id);
CREATE INDEX IF NOT EXISTS v2_billing_refunds_org_occurred_id_finance_ledger_idx
  ON v2_billing_refunds(organization_id,occurred_at DESC,recorded_at DESC,id);
CREATE INDEX IF NOT EXISTS payments_org_effective_occurred_id_finance_ledger_idx
  ON payments(organization_id,COALESCE(paid_at,applied_at,created_at AT TIME ZONE 'UTC') DESC,created_at DESC,id);
