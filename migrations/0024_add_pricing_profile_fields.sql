-- Migration: Add pricing profile fields to products
-- Date: 2024
-- Description: Adds pricingProfileKey and pricingProfileConfig to support multiple pricing calculators

-- Add pricing_profile_key column
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'pricing_profile_key') THEN
    ALTER TABLE products ADD COLUMN pricing_profile_key VARCHAR(100) DEFAULT 'default';
  END IF;
END $$;

-- Add pricing_profile_config JSONB column
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'pricing_profile_config') THEN
    ALTER TABLE products ADD COLUMN pricing_profile_config JSONB;
  END IF;
END $$;

-- Add comments explaining the new columns
COMMENT ON COLUMN products.pricing_profile_key IS 'Pricing calculator profile: default, flat_goods, qty_only, fee';
COMMENT ON COLUMN products.pricing_profile_config IS 'Calculator-specific configuration (e.g., sheet dimensions for flat_goods)';

-- Migrate existing products that use nesting calculator to flat_goods profile
-- This ensures backward compatibility
UPDATE products 
SET pricing_profile_key = 'flat_goods',
    pricing_profile_config = jsonb_build_object(
      'sheetWidth', COALESCE(sheet_width::numeric, 48),
      'sheetHeight', COALESCE(sheet_height::numeric, 96),
      'allowRotation', true,
      'materialType', COALESCE(material_type, 'sheet'),
      'minPricePerItem', min_price_per_item::numeric
    )
WHERE use_nesting_calculator = true 
  AND pricing_profile_key IS NULL OR pricing_profile_key = 'default';

-- Migrate service/fee products to fee profile
UPDATE products 
SET pricing_profile_key = 'fee'
WHERE is_service = true 
  AND (pricing_profile_key IS NULL OR pricing_profile_key = 'default');

-- Migrate quantity-only products (pricingMode = 'quantity') to qty_only profile
UPDATE products 
SET pricing_profile_key = 'qty_only'
WHERE pricing_mode = 'quantity' 
  AND is_service = false
  AND (pricing_profile_key IS NULL OR pricing_profile_key = 'default');
