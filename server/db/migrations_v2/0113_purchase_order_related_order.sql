ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS related_order_id varchar REFERENCES orders(id) ON DELETE SET NULL;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS purchase_orders_related_order_id_idx
  ON purchase_orders(related_order_id);
