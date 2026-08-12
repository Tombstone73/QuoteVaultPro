-- Repair environments where the historical 0149 allocation migration was
-- recorded/skipped without applying its order-attachment columns. The normal
-- artwork upload compatibility projection writes these columns in the same
-- transaction as canonical line_item_artwork, so their absence rolls back the
-- otherwise valid canonical relationship.
ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS production_quantity integer,
  ADD COLUMN IF NOT EXISTS production_group_id varchar(128);

ALTER TABLE order_attachments
  DROP CONSTRAINT IF EXISTS order_attachments_production_quantity_positive_chk;
ALTER TABLE order_attachments
  ADD CONSTRAINT order_attachments_production_quantity_positive_chk
  CHECK (production_quantity IS NULL OR production_quantity > 0);

CREATE INDEX IF NOT EXISTS order_attachments_production_group_idx
  ON order_attachments (order_line_item_id, production_group_id);
