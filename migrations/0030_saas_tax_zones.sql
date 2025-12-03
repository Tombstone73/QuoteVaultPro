-- Migration 0030: SaaS Multi-State Tax System
-- Adds support for tax zones, tax categories, organization tax nexus, and tax rules

-- Tax Zones: Define geographic areas with specific tax rates
CREATE TABLE IF NOT EXISTS tax_zones (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  country TEXT NOT NULL DEFAULT 'US',
  state TEXT,
  county TEXT,
  city TEXT,
  postal_start TEXT,
  postal_end TEXT,
  combined_rate DECIMAL(10, 6) NOT NULL DEFAULT 0,
  state_rate DECIMAL(10, 6),
  county_rate DECIMAL(10, 6),
  city_rate DECIMAL(10, 6),
  district_rate DECIMAL(10, 6),
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_zones_org_state ON tax_zones(organization_id, state, active);
CREATE INDEX IF NOT EXISTS idx_tax_zones_postal ON tax_zones(organization_id, state, postal_start, postal_end);

-- Tax Categories: Product classification for tax purposes (e.g., Standard Goods, Labor, Freight)
CREATE TABLE IF NOT EXISTS tax_categories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  default_taxable BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT tax_categories_org_code_unique UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tax_categories_org_name ON tax_categories(organization_id, name);

-- Organization Tax Nexus: Defines where an organization must collect sales tax
CREATE TABLE IF NOT EXISTS organization_tax_nexus (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  country TEXT NOT NULL DEFAULT 'US',
  state TEXT NOT NULL,
  county TEXT,
  city TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_tax_nexus ON organization_tax_nexus(organization_id, state, active);

-- Tax Rules: Per-zone, per-category overrides or exemptions
CREATE TABLE IF NOT EXISTS tax_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tax_zone_id TEXT NOT NULL REFERENCES tax_zones(id) ON DELETE CASCADE,
  tax_category_id TEXT NOT NULL REFERENCES tax_categories(id) ON DELETE CASCADE,
  taxable BOOLEAN NOT NULL DEFAULT true,
  rate_override DECIMAL(10, 6),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_rules_lookup ON tax_rules(organization_id, tax_zone_id, tax_category_id);

-- Add tax_category_id to product_variants
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'product_variants' AND column_name = 'tax_category_id'
  ) THEN
    ALTER TABLE product_variants ADD COLUMN tax_category_id TEXT REFERENCES tax_categories(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_variants_tax_category ON product_variants(tax_category_id);

-- Comments for documentation
COMMENT ON TABLE tax_zones IS 'Geographic tax zones with specific tax rates for multi-state tax compliance';
COMMENT ON TABLE tax_categories IS 'Product tax categories (Standard Goods, Labor, Freight, etc.) for differential tax treatment';
COMMENT ON TABLE organization_tax_nexus IS 'States/regions where organization has tax collection obligations';
COMMENT ON TABLE tax_rules IS 'Per-zone, per-category tax rate overrides and exemptions';
COMMENT ON COLUMN tax_zones.combined_rate IS 'Total tax rate (state + county + city + district) as decimal (e.g., 0.07 for 7%)';
COMMENT ON COLUMN tax_zones.postal_start IS 'Start of postal code range (inclusive) for zone matching';
COMMENT ON COLUMN tax_zones.postal_end IS 'End of postal code range (inclusive) for zone matching';
