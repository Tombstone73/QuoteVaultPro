-- Repair vendor purchasing columns that were introduced in the legacy migration
-- stream after the application had moved to migrations_v2. Keep legacy material
-- records valid: purchasing values are optional until a vendor conversion is set.
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS inventory_units_per_purchase_unit numeric(14,6),
  ADD COLUMN IF NOT EXISTS minimum_purchase_quantity numeric(14,6);

ALTER TABLE purchase_order_line_items
  ADD COLUMN IF NOT EXISTS inventory_units_per_purchase_unit numeric(14,6) NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'materials_inventory_units_per_purchase_unit_positive'
  ) THEN
    ALTER TABLE materials
      ADD CONSTRAINT materials_inventory_units_per_purchase_unit_positive
        CHECK (inventory_units_per_purchase_unit IS NULL OR inventory_units_per_purchase_unit > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'materials_minimum_purchase_quantity_positive'
  ) THEN
    ALTER TABLE materials
      ADD CONSTRAINT materials_minimum_purchase_quantity_positive
        CHECK (minimum_purchase_quantity IS NULL OR minimum_purchase_quantity > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_line_items_inventory_units_per_purchase_unit_positive'
  ) THEN
    ALTER TABLE purchase_order_line_items
      ADD CONSTRAINT purchase_order_line_items_inventory_units_per_purchase_unit_positive
        CHECK (inventory_units_per_purchase_unit > 0);
  END IF;
END $$;
