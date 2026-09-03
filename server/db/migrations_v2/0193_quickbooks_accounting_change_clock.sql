-- The QuickBooks stability window must follow commercial/accounting changes,
-- never queue discovery, retry, sync-status, or other generic updated_at writes.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS accounting_updated_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS accounting_updated_at timestamptz;

-- Do not make the existing backlog appear newly changed at deployment.  These
-- are the safest durable business timestamps available for legacy records.
UPDATE invoices
SET accounting_updated_at = COALESCE(issued_at, issue_date, created_at)
WHERE accounting_updated_at IS NULL;

UPDATE payments
SET accounting_updated_at = COALESCE(succeeded_at, paid_at, applied_at, created_at)
WHERE accounting_updated_at IS NULL;

ALTER TABLE invoices ALTER COLUMN accounting_updated_at SET DEFAULT now();
ALTER TABLE invoices ALTER COLUMN accounting_updated_at SET NOT NULL;
ALTER TABLE payments ALTER COLUMN accounting_updated_at SET DEFAULT now();
ALTER TABLE payments ALTER COLUMN accounting_updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_org_qb_sync_accounting_updated_idx
  ON invoices (organization_id, qb_sync_status, accounting_updated_at);
CREATE INDEX IF NOT EXISTS payments_org_qb_sync_accounting_updated_idx
  ON payments (organization_id, sync_status, accounting_updated_at);

-- A bounded lease prevents a manual force click and the automatic worker from
-- issuing concurrent duplicate remote requests for the same local record.
CREATE TABLE IF NOT EXISTS quickbooks_sync_leases (
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_type varchar(16) NOT NULL CHECK (resource_type IN ('invoice', 'payment')),
  resource_id varchar NOT NULL,
  lease_owner varchar(128) NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, resource_type, resource_id)
);
