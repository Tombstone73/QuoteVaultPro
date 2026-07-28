-- A production quantity is a line-item/file relationship, not a filename or note.
-- Front and Back files share production_group_id when they describe the same
-- finished pieces, so their quantities are not double-counted.
ALTER TABLE quote_attachments
  ADD COLUMN IF NOT EXISTS production_quantity integer,
  ADD COLUMN IF NOT EXISTS production_group_id varchar(128),
  ADD COLUMN IF NOT EXISTS production_role varchar(16) NOT NULL DEFAULT 'artwork';
ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS production_quantity integer,
  ADD COLUMN IF NOT EXISTS production_group_id varchar(128);
ALTER TABLE line_item_files
  ADD COLUMN IF NOT EXISTS production_quantity integer,
  ADD COLUMN IF NOT EXISTS production_group_id varchar(128);

ALTER TABLE quote_attachments
  DROP CONSTRAINT IF EXISTS quote_attachments_production_quantity_positive_chk;
ALTER TABLE quote_attachments
  ADD CONSTRAINT quote_attachments_production_quantity_positive_chk
  CHECK (production_quantity IS NULL OR production_quantity > 0);
ALTER TABLE order_attachments
  DROP CONSTRAINT IF EXISTS order_attachments_production_quantity_positive_chk;
ALTER TABLE order_attachments
  ADD CONSTRAINT order_attachments_production_quantity_positive_chk
  CHECK (production_quantity IS NULL OR production_quantity > 0);
ALTER TABLE line_item_files
  DROP CONSTRAINT IF EXISTS line_item_files_production_quantity_positive_chk;
ALTER TABLE line_item_files
  ADD CONSTRAINT line_item_files_production_quantity_positive_chk
  CHECK (production_quantity IS NULL OR production_quantity > 0);

CREATE INDEX IF NOT EXISTS quote_attachments_production_group_idx
  ON quote_attachments (quote_line_item_id, production_group_id);
CREATE INDEX IF NOT EXISTS order_attachments_production_group_idx
  ON order_attachments (order_line_item_id, production_group_id);
