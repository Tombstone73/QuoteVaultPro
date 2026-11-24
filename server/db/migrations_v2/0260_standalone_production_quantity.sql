ALTER TABLE order_line_items
  ADD COLUMN standalone_production_completed_quantity integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT order_line_items_standalone_production_completed_nonnegative
    CHECK (standalone_production_completed_quantity >= 0);
