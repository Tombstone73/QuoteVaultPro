-- Version-owned physical recipe rules.  `per_area` is expressed as square
-- feet of requested material per square foot of finished output; the existing
-- material normalizer remains the authority for physical-sheet conversion.
ALTER TABLE v2_product_recipe_components
  DROP CONSTRAINT IF EXISTS v2_product_recipe_components_recipe_material_unique;

ALTER TABLE v2_product_recipe_components
  DROP CONSTRAINT IF EXISTS v2_product_recipe_components_quantity_kind_check;

ALTER TABLE v2_product_recipe_components
  ADD CONSTRAINT v2_product_recipe_components_quantity_kind_check
  CHECK (quantity_kind IN ('fixed', 'per_line', 'per_piece', 'per_area'));

ALTER TABLE v2_product_recipe_components
  ADD COLUMN condition_option_id varchar,
  ADD COLUMN condition_choice_value varchar,
  ADD COLUMN replaces_pbv2_compatibility boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT v2_product_recipe_components_condition_pair_check
    CHECK ((condition_option_id IS NULL) = (condition_choice_value IS NULL)),
  ADD CONSTRAINT v2_product_recipe_components_area_unit_check
    CHECK (quantity_kind <> 'per_area' OR quantity_unit = 'square_foot'),
  ADD CONSTRAINT v2_product_recipe_components_pbv2_replacement_condition_check
    CHECK (NOT replaces_pbv2_compatibility OR condition_option_id IS NOT NULL);

CREATE INDEX v2_product_recipe_components_condition_idx
  ON v2_product_recipe_components(recipe_id, condition_option_id, condition_choice_value)
  WHERE condition_option_id IS NOT NULL;
