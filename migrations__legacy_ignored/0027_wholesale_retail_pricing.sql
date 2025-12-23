-- Migration: Add Wholesale and Retail Pricing Support
-- Description: Adds tier-specific pricing fields to materials and product_variants,
--              and pricingTier field to customers for wholesale/retail support.
-- Date: 2025-12-03

-- ============================================================
-- MATERIALS TABLE: Add wholesale/retail pricing fields
-- ============================================================

DO $$ BEGIN
  -- Wholesale base rate (price per unit for wholesale customers)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'materials' AND column_name = 'wholesale_base_rate'
  ) THEN
    ALTER TABLE materials ADD COLUMN wholesale_base_rate DECIMAL(10, 4) NULL;
  END IF;

  -- Wholesale minimum charge
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'materials' AND column_name = 'wholesale_min_charge'
  ) THEN
    ALTER TABLE materials ADD COLUMN wholesale_min_charge DECIMAL(10, 2) NULL;
  END IF;

  -- Retail base rate (price per unit for retail customers)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'materials' AND column_name = 'retail_base_rate'
  ) THEN
    ALTER TABLE materials ADD COLUMN retail_base_rate DECIMAL(10, 4) NULL;
  END IF;

  -- Retail minimum charge
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'materials' AND column_name = 'retail_min_charge'
  ) THEN
    ALTER TABLE materials ADD COLUMN retail_min_charge DECIMAL(10, 2) NULL;
  END IF;
END $$;

-- ============================================================
-- PRODUCT_VARIANTS TABLE: Add wholesale/retail pricing fields
-- ============================================================

DO $$ BEGIN
  -- Wholesale base rate (price per sqft for wholesale customers)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'product_variants' AND column_name = 'wholesale_base_rate'
  ) THEN
    ALTER TABLE product_variants ADD COLUMN wholesale_base_rate DECIMAL(10, 4) NULL;
  END IF;

  -- Wholesale minimum charge
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'product_variants' AND column_name = 'wholesale_min_charge'
  ) THEN
    ALTER TABLE product_variants ADD COLUMN wholesale_min_charge DECIMAL(10, 2) NULL;
  END IF;

  -- Retail base rate (price per sqft for retail customers)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'product_variants' AND column_name = 'retail_base_rate'
  ) THEN
    ALTER TABLE product_variants ADD COLUMN retail_base_rate DECIMAL(10, 4) NULL;
  END IF;

  -- Retail minimum charge
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'product_variants' AND column_name = 'retail_min_charge'
  ) THEN
    ALTER TABLE product_variants ADD COLUMN retail_min_charge DECIMAL(10, 2) NULL;
  END IF;
END $$;

-- ============================================================
-- CUSTOMERS TABLE: Add pricing tier field
-- ============================================================

DO $$ BEGIN
  -- Pricing tier: 'default', 'wholesale', or 'retail'
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'pricing_tier'
  ) THEN
    ALTER TABLE customers ADD COLUMN pricing_tier VARCHAR(20) NOT NULL DEFAULT 'default';
  END IF;
END $$;

-- Add check constraint to enforce valid pricing tier values
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'customers_pricing_tier_check'
  ) THEN
    ALTER TABLE customers 
    ADD CONSTRAINT customers_pricing_tier_check 
    CHECK (pricing_tier IN ('default', 'wholesale', 'retail'));
  END IF;
END $$;

-- Add index on pricing_tier for efficient filtering
CREATE INDEX IF NOT EXISTS customers_pricing_tier_idx ON customers(pricing_tier);

-- ============================================================
-- COMMENTS for documentation
-- ============================================================

COMMENT ON COLUMN materials.wholesale_base_rate IS 'Wholesale price per unit (trade/reseller rate)';
COMMENT ON COLUMN materials.wholesale_min_charge IS 'Minimum charge for wholesale jobs using this material';
COMMENT ON COLUMN materials.retail_base_rate IS 'Retail price per unit (end-user rate)';
COMMENT ON COLUMN materials.retail_min_charge IS 'Minimum charge for retail jobs using this material';

COMMENT ON COLUMN product_variants.wholesale_base_rate IS 'Wholesale price per sq ft (trade/reseller rate)';
COMMENT ON COLUMN product_variants.wholesale_min_charge IS 'Minimum charge for wholesale jobs using this variant';
COMMENT ON COLUMN product_variants.retail_base_rate IS 'Retail price per sq ft (end-user rate)';
COMMENT ON COLUMN product_variants.retail_min_charge IS 'Minimum charge for retail jobs using this variant';

COMMENT ON COLUMN customers.pricing_tier IS 'Pricing tier: default (use base pricing), wholesale, or retail';
