-- Migration 0032: Add requires_proof_approval snapshot to quote_line_items
--
-- Captures the product's proof-approval requirement at quote time so that
-- quote-to-order conversion does not depend on the current (possibly changed)
-- product config.
--
-- NULL  = not yet snapshotted (legacy row; conversion falls back to live product, same as before)
-- false = snapshotted and proof approval is NOT required
-- true  = snapshotted and proof approval IS required
--
-- Nullable mirrors the existing requiresPrepress pattern on this table.

ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS requires_proof_approval boolean;
