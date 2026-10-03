CREATE TABLE IF NOT EXISTS material_families (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT material_families_org_name_unique UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS material_families_organization_id_idx ON material_families(organization_id);

ALTER TABLE materials ADD COLUMN IF NOT EXISTS material_family_id varchar REFERENCES material_families(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS materials_material_family_id_idx ON materials(material_family_id);

CREATE TABLE IF NOT EXISTS material_family_variant_dimensions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_family_id varchar NOT NULL REFERENCES material_families(id) ON DELETE CASCADE,
  key varchar(64) NOT NULL,
  display_name varchar(100) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT material_family_variant_dimensions_family_key_unique UNIQUE (material_family_id, key)
);
CREATE INDEX IF NOT EXISTS material_family_variant_dimensions_org_family_idx ON material_family_variant_dimensions(organization_id, material_family_id);

CREATE TABLE IF NOT EXISTS material_variant_values (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_id varchar NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  dimension_id varchar NOT NULL REFERENCES material_family_variant_dimensions(id) ON DELETE CASCADE,
  value varchar(255) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT material_variant_values_material_dimension_unique UNIQUE (material_id, dimension_id)
);
CREATE INDEX IF NOT EXISTS material_variant_values_org_material_idx ON material_variant_values(organization_id, material_id);
