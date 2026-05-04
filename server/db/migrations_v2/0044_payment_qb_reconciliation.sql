-- Migration 0044: add QuickBooks reconciliation timestamp to payments
--
-- Imported QuickBooks open A/R invoices may have local TitanOS payments that are
-- synced to QuickBooks later. Once a refreshed QB invoice balance confirms the
-- local payment is reflected in QB, we mark it reconciled so TitanOS does not
-- subtract the same payment twice from the imported QB balance snapshot.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS qb_reconciled_at timestamptz;