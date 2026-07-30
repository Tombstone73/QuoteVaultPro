ALTER TABLE "materials"
  ALTER COLUMN "stock_quantity" TYPE numeric(14, 6) USING "stock_quantity"::numeric(14, 6);

ALTER TABLE "inventory_adjustments"
  ALTER COLUMN "quantity_change" TYPE numeric(14, 6) USING "quantity_change"::numeric(14, 6),
  ALTER COLUMN "quantity_before" TYPE numeric(14, 6) USING "quantity_before"::numeric(14, 6),
  ALTER COLUMN "quantity_after" TYPE numeric(14, 6) USING "quantity_after"::numeric(14, 6);

ALTER TABLE "order_material_usage"
  ALTER COLUMN "quantity_used" TYPE numeric(14, 6) USING "quantity_used"::numeric(14, 6);

ALTER TABLE "inventory_reservations"
  ALTER COLUMN "qty" TYPE numeric(14, 6) USING "qty"::numeric(14, 6);
