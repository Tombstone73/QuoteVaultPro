-- Migration: Add pricing mode, service flag, material linkage, and inline options to products
-- Date: 2024
-- Description: Extends products table with pricingMode, isService, primaryMaterialId, and optionsJson

-- Add pricing_mode column (area, quantity, flat)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'pricing_mode') THEN
    ALTER TABLE products ADD COLUMN pricing_mode VARCHAR(32) NOT NULL DEFAULT 'area';
  END IF;
END $$;

-- Add is_service flag (for design fees, rush fees, etc.)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'is_service') THEN
    ALTER TABLE products ADD COLUMN is_service BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Add primary_material_id foreign key to materials table
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'primary_material_id') THEN
    ALTER TABLE products ADD COLUMN primary_material_id VARCHAR;
  END IF;
END $$;

-- Add foreign key constraint for primary_material_id (if materials table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'materials') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'products_primary_material_id_fkey' 
      AND table_name = 'products'
    ) THEN
      ALTER TABLE products 
        ADD CONSTRAINT products_primary_material_id_fkey 
        FOREIGN KEY (primary_material_id) 
        REFERENCES materials(id) 
        ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- Add options_json JSONB column for inline product options
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'options_json') THEN
    ALTER TABLE products ADD COLUMN options_json JSONB;
  END IF;
END $$;

-- Create index on primary_material_id for faster lookups
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'products_primary_material_id_idx') THEN
    CREATE INDEX products_primary_material_id_idx ON products(primary_material_id);
  END IF;
END $$;

-- Add comment explaining the new columns
COMMENT ON COLUMN products.pricing_mode IS 'Pricing calculation mode: area (sqft-based), quantity (unit-based), flat (fixed fee)';
COMMENT ON COLUMN products.is_service IS 'True for service/fee products (design, rush, shipping) that are not physical products';
COMMENT ON COLUMN products.primary_material_id IS 'Primary material for cost calculations and inventory tracking';
COMMENT ON COLUMN products.options_json IS 'Inline product options stored as JSON array: [{id, label, type, priceMode, amount}]';
