-- Make vendor purchasing quantities explicit while retaining the existing
-- vendor_cost_* columns as compatibility-safe storage for purchase price/unit.
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS inventory_units_per_purchase_unit numeric(14,6),
  ADD COLUMN IF NOT EXISTS minimum_purchase_quantity numeric(14,6);

ALTER TABLE purchase_order_line_items
  ADD COLUMN IF NOT EXISTS inventory_units_per_purchase_unit numeric(14,6) NOT NULL DEFAULT 1;

ALTER TABLE materials
  ADD CONSTRAINT materials_inventory_units_per_purchase_unit_positive
    CHECK (inventory_units_per_purchase_unit IS NULL OR inventory_units_per_purchase_unit > 0),
  ADD CONSTRAINT materials_minimum_purchase_quantity_positive
    CHECK (minimum_purchase_quantity IS NULL OR minimum_purchase_quantity > 0);

ALTER TABLE purchase_order_line_items
  ADD CONSTRAINT purchase_order_line_items_inventory_units_per_purchase_unit_positive
    CHECK (inventory_units_per_purchase_unit > 0);
