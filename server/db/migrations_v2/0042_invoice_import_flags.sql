-- Migration 0042: Add QuickBooks invoice import tracking columns to invoices
-- Enables controlled QB → TitanOS invoice import with open A/R vs historical classification.
-- No production workflow side-effects: invoices marked with import_source are treated as
-- external records (no orders, no production jobs, no email auto-triggers).

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS import_source varchar(30),
  ADD COLUMN IF NOT EXISTS is_historical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qb_import_balance_due numeric(10,2),
  ADD COLUMN IF NOT EXISTS imported_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS locked_reason text,
  ADD COLUMN IF NOT EXISTS qb_doc_number text,
  ADD COLUMN IF NOT EXISTS qb_line_items_snapshot jsonb;

-- Index for querying imported invoices per org (e.g. "show all QB-imported invoices")
CREATE INDEX IF NOT EXISTS invoices_import_source_org_idx
  ON invoices (organization_id, import_source)
  WHERE import_source IS NOT NULL;

-- Index for filtering historical vs active A/R per org
CREATE INDEX IF NOT EXISTS invoices_is_historical_org_idx
  ON invoices (organization_id, is_historical);
