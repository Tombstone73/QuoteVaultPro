-- P7A: Recipes are version-bound Product definitions, never mutable inventory
-- transactions. A missing recipe remains valid for service and fulfillment-only
-- Products; present recipes are immutable once their PBV2 version is ACTIVE.
CREATE TABLE v2_product_recipes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id varchar NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_version_id varchar NOT NULL REFERENCES pbv2_tree_versions(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  updated_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT v2_product_recipes_org_version_unique UNIQUE (organization_id, product_version_id)
);

CREATE INDEX v2_product_recipes_org_product_idx ON v2_product_recipes(organization_id, product_id);

CREATE TABLE v2_product_recipe_components (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipe_id varchar NOT NULL REFERENCES v2_product_recipes(id) ON DELETE CASCADE,
  material_id varchar NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  position integer NOT NULL,
  quantity numeric(18, 6) NOT NULL CHECK (quantity > 0),
  quantity_unit varchar NOT NULL CHECK (quantity_unit IN ('each', 'square_foot', 'linear_foot', 'sheet', 'roll')),
  quantity_kind varchar NOT NULL DEFAULT 'fixed' CHECK (quantity_kind = 'fixed'),
  material_name_snapshot varchar NOT NULL,
  material_sku_snapshot varchar,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT v2_product_recipe_components_recipe_position_unique UNIQUE (recipe_id, position),
  CONSTRAINT v2_product_recipe_components_recipe_material_unique UNIQUE (recipe_id, material_id)
);

CREATE INDEX v2_product_recipe_components_org_material_idx ON v2_product_recipe_components(organization_id, material_id);
