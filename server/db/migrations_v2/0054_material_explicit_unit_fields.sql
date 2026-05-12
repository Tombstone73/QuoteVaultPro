ALTER TABLE "materials"
  ADD COLUMN IF NOT EXISTS "inventory_unit" varchar(50),
  ADD COLUMN IF NOT EXISTS "sell_price_unit" varchar(50),
  ADD COLUMN IF NOT EXISTS "wholesale_price_unit" varchar(50),
  ADD COLUMN IF NOT EXISTS "vendor_cost_unit" varchar(50),
  ADD COLUMN IF NOT EXISTS "consumption_unit" varchar(50);

UPDATE "materials"
SET
  "inventory_unit" = COALESCE("inventory_unit", "unit_of_measure"),
  "sell_price_unit" = COALESCE("sell_price_unit", "unit_of_measure"),
  "wholesale_price_unit" = COALESCE("wholesale_price_unit", "sell_price_unit", "unit_of_measure"),
  "vendor_cost_unit" = COALESCE("vendor_cost_unit", "unit_of_measure"),
  "consumption_unit" = COALESCE("consumption_unit", "sell_price_unit", "unit_of_measure")
WHERE
  "inventory_unit" IS NULL
  OR "sell_price_unit" IS NULL
  OR "wholesale_price_unit" IS NULL
  OR "vendor_cost_unit" IS NULL
  OR "consumption_unit" IS NULL;
