-- P7B: expected material requirements are immutable commercial facts, separate
-- from both the versioned recipe definition and future actual consumption.
ALTER TABLE v2_product_recipe_components
  DROP CONSTRAINT v2_product_recipe_components_quantity_kind_check;
ALTER TABLE v2_product_recipe_components
  ADD CONSTRAINT v2_product_recipe_components_quantity_kind_check
  CHECK (quantity_kind IN ('fixed', 'per_line', 'per_piece'));

CREATE TABLE v2_order_line_material_requirements (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_document_id varchar NOT NULL REFERENCES v2_sales_documents(id) ON DELETE RESTRICT,
  order_line_id varchar NOT NULL REFERENCES v2_sales_document_lines(id) ON DELETE RESTRICT,
  source_product_version_id varchar NOT NULL REFERENCES pbv2_tree_versions(id) ON DELETE RESTRICT,
  source_recipe_id varchar NOT NULL REFERENCES v2_product_recipes(id) ON DELETE RESTRICT,
  source_recipe_component_id varchar NOT NULL REFERENCES v2_product_recipe_components(id) ON DELETE RESTRICT,
  source_configuration_id varchar NOT NULL,
  material_id varchar NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  material_name_snapshot varchar NOT NULL,
  material_sku_snapshot varchar,
  quantity numeric(18, 6) NOT NULL CHECK (quantity > 0),
  quantity_unit varchar NOT NULL CHECK (quantity_unit IN ('each', 'square_foot', 'linear_foot', 'sheet', 'roll')),
  quantity_mode varchar NOT NULL CHECK (quantity_mode IN ('per_line', 'per_piece')),
  resolution_version integer NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT v2_order_line_material_requirements_line_component_unique
    UNIQUE (organization_id, order_line_id, source_recipe_component_id)
);

CREATE INDEX v2_order_line_material_requirements_order_idx
  ON v2_order_line_material_requirements(organization_id, order_document_id, order_line_id);
