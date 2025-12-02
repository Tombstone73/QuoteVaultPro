-- Migration: Add pricing_formulas table and link to products
-- Description: Creates reusable pricing formula definitions that can be shared across multiple products

-- Create pricing_formulas table
CREATE TABLE IF NOT EXISTS pricing_formulas (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,
  code VARCHAR(100), -- optional slug / short key
  description TEXT,
  
  -- Which calculator profile this formula uses
  pricing_profile_key VARCHAR(100) NOT NULL,
  
  -- Optional raw expression for simple formulas
  expression TEXT,
  
  -- Calculator-specific config (sheet sizes, rotation flags, etc.)
  config JSONB,
  
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for pricing_formulas
CREATE INDEX IF NOT EXISTS pricing_formulas_org_id_idx ON pricing_formulas(organization_id);
CREATE INDEX IF NOT EXISTS pricing_formulas_code_org_idx ON pricing_formulas(organization_id, code);

-- Add pricing_formula_id column to products table
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'pricing_formula_id') THEN
    ALTER TABLE products ADD COLUMN pricing_formula_id VARCHAR REFERENCES pricing_formulas(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create index on products.pricing_formula_id
CREATE INDEX IF NOT EXISTS products_pricing_formula_id_idx ON products(pricing_formula_id);

-- Add comments explaining the new structures
COMMENT ON TABLE pricing_formulas IS 'Reusable pricing formula definitions that can be shared across multiple products';
COMMENT ON COLUMN pricing_formulas.pricing_profile_key IS 'Calculator profile: default, flat_goods, qty_only, fee';
COMMENT ON COLUMN pricing_formulas.expression IS 'Math expression for formula-based profiles (e.g., sqft * p * q)';
COMMENT ON COLUMN pricing_formulas.config IS 'Calculator-specific config (e.g., sheet dimensions for flat_goods)';
COMMENT ON COLUMN products.pricing_formula_id IS 'Reference to shared pricing formula; when set, formula config overrides product-level pricing settings';
