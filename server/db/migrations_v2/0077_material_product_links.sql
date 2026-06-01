CREATE TABLE IF NOT EXISTS material_product_links (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  material_id varchar NOT NULL REFERENCES materials(id) ON DELETE cascade,
  product_id varchar NOT NULL REFERENCES products(id) ON DELETE cascade,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL,
  removed_at timestamp
);

CREATE INDEX IF NOT EXISTS material_product_links_org_material_idx
  ON material_product_links (organization_id, material_id);

CREATE INDEX IF NOT EXISTS material_product_links_org_product_idx
  ON material_product_links (organization_id, product_id);

CREATE UNIQUE INDEX IF NOT EXISTS material_product_links_org_material_product_uidx
  ON material_product_links (organization_id, material_id, product_id);
