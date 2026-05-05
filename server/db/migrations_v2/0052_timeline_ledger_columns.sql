ALTER TABLE production_events
  ADD COLUMN IF NOT EXISTS order_id varchar REFERENCES orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_line_item_id varchar REFERENCES order_line_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE order_audit_log
  ADD COLUMN IF NOT EXISTS order_line_item_id varchar REFERENCES order_line_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS production_events_order_id_idx
  ON production_events (order_id);

CREATE INDEX IF NOT EXISTS production_events_order_line_item_id_idx
  ON production_events (order_line_item_id);

CREATE INDEX IF NOT EXISTS production_events_actor_user_id_idx
  ON production_events (actor_user_id);

CREATE INDEX IF NOT EXISTS order_audit_log_order_line_item_id_idx
  ON order_audit_log (order_line_item_id);