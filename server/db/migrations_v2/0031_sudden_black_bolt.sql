-- Migration 0031: Add customer_visible_disclaimer to line_item_proof_versions
--
-- Snapshots the org's active default proof disclaimer text at the moment a
-- proof version is sent or resent. NULL means no disclaimer was configured at
-- that point in time. Once a proof version is approved this column is frozen
-- as part of the accepted proof record and must not be mutated.

ALTER TABLE line_item_proof_versions
  ADD COLUMN IF NOT EXISTS customer_visible_disclaimer text;
