-- P7E: a frozen requirement may originate in a versioned PBV2 choice
-- inventory-consumption rule as well as a P7A recipe component.  The source
-- identity is explicit so replay remains idempotent without manufacturing a
-- mutable recipe row for legacy PBV2 production semantics.
ALTER TABLE v2_order_line_material_requirements
  DROP CONSTRAINT IF EXISTS v2_order_line_material_requirements_line_component_unique;

ALTER TABLE v2_order_line_material_requirements
  ALTER COLUMN source_recipe_id DROP NOT NULL,
  ALTER COLUMN source_recipe_component_id DROP NOT NULL,
  ADD COLUMN source_definition_kind varchar NOT NULL DEFAULT 'recipe_component',
  ADD COLUMN source_definition_id varchar;

UPDATE v2_order_line_material_requirements
SET source_definition_id=source_recipe_component_id
WHERE source_definition_id IS NULL;

ALTER TABLE v2_order_line_material_requirements
  ALTER COLUMN source_definition_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS v2_order_line_material_requirements_quantity_mode_check,
  ADD CONSTRAINT v2_order_line_material_requirements_quantity_mode_check
    CHECK (quantity_mode IN ('per_line','per_piece','per_square_foot')),
  ADD CONSTRAINT v2_order_line_material_requirements_source_kind_check
    CHECK (source_definition_kind IN ('recipe_component','pbv2_inventory_consumption')),
  ADD CONSTRAINT v2_order_line_material_requirements_source_shape_check
    CHECK (
      (source_definition_kind='recipe_component' AND source_recipe_id IS NOT NULL AND source_recipe_component_id IS NOT NULL)
      OR
      (source_definition_kind='pbv2_inventory_consumption' AND source_recipe_id IS NULL AND source_recipe_component_id IS NULL)
    ),
  ADD CONSTRAINT v2_order_line_material_requirements_line_source_unique
    UNIQUE (organization_id,order_line_id,source_definition_id);

-- Preserve controlled fixture and legacy-compatible inserts that still provide
-- a recipe component but not the new explicit source fields.
CREATE OR REPLACE FUNCTION v2_order_line_material_requirement_source_defaults() RETURNS trigger AS $$
BEGIN
  IF NEW.source_definition_kind IS NULL THEN NEW.source_definition_kind := 'recipe_component'; END IF;
  IF NEW.source_definition_id IS NULL AND NEW.source_definition_kind='recipe_component' AND NEW.source_recipe_component_id IS NOT NULL THEN
    NEW.source_definition_id := NEW.source_recipe_component_id;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER v2_order_line_material_requirement_source_defaults_trigger
  BEFORE INSERT OR UPDATE ON v2_order_line_material_requirements
  FOR EACH ROW EXECUTE FUNCTION v2_order_line_material_requirement_source_defaults();
