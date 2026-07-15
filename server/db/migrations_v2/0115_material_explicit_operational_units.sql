-- Launch-safe bridge: retain unit_of_measure only as historical migration evidence.
ALTER TABLE "materials"
  ADD COLUMN IF NOT EXISTS "material_form" varchar(50);

-- These mappings are exact physical aliases or explicit prior material classifications.
UPDATE "materials"
SET "material_form" = CASE
  WHEN "type" = 'roll' THEN 'roll'
  WHEN "type" = 'sheet' THEN 'sheet'
  WHEN "type" = 'ink' THEN 'liquid'
  WHEN "type" = 'consumable' AND COALESCE("inventory_unit", "unit_of_measure") IN ('ml') THEN 'liquid'
  WHEN "type" = 'consumable' AND COALESCE("inventory_unit", "unit_of_measure") IN ('ea', 'each') THEN 'each'
  ELSE NULL
END
WHERE "material_form" IS NULL;

-- Canonical aliases with identical quantity semantics only. No volume conversion occurs here.
UPDATE "materials"
SET "inventory_unit" = CASE COALESCE("inventory_unit", "unit_of_measure")
  WHEN 'sqft' THEN 'square_foot'
  WHEN 'linear_ft' THEN 'linear_foot'
  WHEN 'ft' THEN 'linear_foot'
  WHEN 'ea' THEN 'each'
  WHEN 'ml' THEN 'milliliter'
  ELSE COALESCE("inventory_unit", "unit_of_measure")
END;

UPDATE "materials"
SET "consumption_unit" = CASE COALESCE("consumption_unit", "unit_of_measure")
  WHEN 'sqft' THEN 'square_foot'
  WHEN 'linear_ft' THEN 'linear_foot'
  WHEN 'ft' THEN 'linear_foot'
  WHEN 'ea' THEN 'each'
  WHEN 'ml' THEN 'milliliter'
  ELSE COALESCE("consumption_unit", "unit_of_measure")
END;

ALTER TABLE "materials"
  ALTER COLUMN "unit_of_measure" DROP NOT NULL;
