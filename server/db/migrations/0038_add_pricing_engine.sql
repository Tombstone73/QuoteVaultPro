-- Migration: Add pricing_engine field to products table
-- Purpose: Store which pricing engine UI mode is selected (formulaLibrary, pricingProfile, pricingFormula)
-- Date: 2025-01-22

-- Add pricing_engine column to products table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products'
    AND column_name = 'pricing_engine'
  ) THEN
    ALTER TABLE products
    ADD COLUMN pricing_engine VARCHAR(32) DEFAULT 'pricingProfile';
    
    -- Add check constraint to ensure only valid values
    ALTER TABLE products
    ADD CONSTRAINT pricing_engine_check
    CHECK (pricing_engine IN ('formulaLibrary', 'pricingProfile', 'pricingFormula'));
    
    RAISE NOTICE 'Added pricing_engine column to products table with default pricingProfile';
  ELSE
    RAISE NOTICE 'pricing_engine column already exists in products table';
  END IF;
END $$;

-- Backfill pricing_engine based on existing data patterns:
-- 1. If pricingFormulaId is set → formulaLibrary
-- 2. Otherwise → pricingProfile (default behavior)
-- Note: Custom formulas that differ from profile defaults cannot be automatically detected,
--       so they will also default to pricingProfile. Users can manually switch if needed.
DO $$ BEGIN
  UPDATE products
  SET pricing_engine = CASE
    WHEN pricing_formula_id IS NOT NULL THEN 'formulaLibrary'
    ELSE 'pricingProfile'
  END
  WHERE pricing_engine = 'pricingProfile'; -- Only update rows that still have default value
  
  RAISE NOTICE 'Backfilled pricing_engine for existing products';
END $$;
