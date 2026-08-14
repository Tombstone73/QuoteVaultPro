-- Reconcile DEV databases that skipped historical migration 0149 after their
-- migration ledger had already advanced past its journal timestamp. Quote
-- attachments are the pre-conversion artwork allocation projection, so these
-- fields must exist before quote-to-order artwork carry-forward can run.
ALTER TABLE quote_attachments
  ADD COLUMN IF NOT EXISTS production_quantity integer,
  ADD COLUMN IF NOT EXISTS production_group_id varchar(128),
  ADD COLUMN IF NOT EXISTS production_role varchar(16) NOT NULL DEFAULT 'artwork';

ALTER TABLE quote_attachments
  DROP CONSTRAINT IF EXISTS quote_attachments_production_quantity_positive_chk;
ALTER TABLE quote_attachments
  ADD CONSTRAINT quote_attachments_production_quantity_positive_chk
  CHECK (production_quantity IS NULL OR production_quantity > 0);

CREATE INDEX IF NOT EXISTS quote_attachments_production_group_idx
  ON quote_attachments (quote_line_item_id, production_group_id);
