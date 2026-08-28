-- Preserve frozen PBV2 commercial terms on customer-facing invoice snapshots.
ALTER TABLE "invoice_line_items"
  ADD COLUMN IF NOT EXISTS "pbv2_snapshot_json" jsonb;
