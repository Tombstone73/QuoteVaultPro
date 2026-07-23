-- One-level parent/child bundles for quote, order, and invoice line items.
-- Existing flat rows remain standalone through the defaults below.
CREATE TYPE line_item_role AS ENUM ('standalone', 'parent', 'child');
CREATE TYPE line_item_child_display_mode AS ENUM ('hidden', 'visible_summary', 'visible_detail');
CREATE TYPE line_item_parent_price_mode AS ENUM ('sum_children', 'manual_override');

ALTER TABLE quote_line_items
  ADD COLUMN parent_line_item_id varchar REFERENCES quote_line_items(id) ON DELETE SET NULL,
  ADD COLUMN line_item_role line_item_role NOT NULL DEFAULT 'standalone',
  ADD COLUMN child_display_mode line_item_child_display_mode NOT NULL DEFAULT 'hidden',
  ADD COLUMN parent_price_mode line_item_parent_price_mode NOT NULL DEFAULT 'sum_children',
  ADD COLUMN child_calculated_total_cents integer;
CREATE INDEX quote_line_items_parent_line_item_id_idx ON quote_line_items(parent_line_item_id);
CREATE INDEX quote_line_items_role_idx ON quote_line_items(line_item_role);

ALTER TABLE order_line_items
  ADD COLUMN parent_line_item_id varchar REFERENCES order_line_items(id) ON DELETE SET NULL,
  ADD COLUMN line_item_role line_item_role NOT NULL DEFAULT 'standalone',
  ADD COLUMN child_display_mode line_item_child_display_mode NOT NULL DEFAULT 'hidden',
  ADD COLUMN parent_price_mode line_item_parent_price_mode NOT NULL DEFAULT 'sum_children',
  ADD COLUMN child_calculated_total_cents integer;
CREATE INDEX order_line_items_parent_line_item_id_idx ON order_line_items(parent_line_item_id);
CREATE INDEX order_line_items_role_idx ON order_line_items(line_item_role);

ALTER TABLE invoice_line_items
  ADD COLUMN parent_line_item_id varchar,
  ADD COLUMN line_item_role line_item_role NOT NULL DEFAULT 'standalone',
  ADD COLUMN child_display_mode line_item_child_display_mode NOT NULL DEFAULT 'hidden',
  ADD COLUMN parent_price_mode line_item_parent_price_mode NOT NULL DEFAULT 'sum_children',
  ADD COLUMN child_calculated_total_cents integer;
CREATE INDEX invoice_line_items_parent_line_item_id_idx ON invoice_line_items(parent_line_item_id);
