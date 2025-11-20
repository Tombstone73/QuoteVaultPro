-- Migration: Move volume pricing from products to product_variants
-- This allows each variant to have its own volume pricing tiers

-- Add volume_pricing column to product_variants
ALTER TABLE product_variants 
ADD COLUMN volume_pricing JSONB DEFAULT '{"enabled":false,"tiers":[]}'::jsonb NOT NULL;

-- Copy existing volume pricing from products to their variants (if any exist)
-- This ensures existing products don't lose their volume pricing configuration
UPDATE product_variants pv
SET volume_pricing = p.nesting_volume_pricing
FROM products p
WHERE pv.product_id = p.id 
  AND p.nesting_volume_pricing IS NOT NULL
  AND p.nesting_volume_pricing->>'enabled' = 'true';

-- Optional: Remove volume pricing from products table (uncomment if you want to clean up)
-- ALTER TABLE products DROP COLUMN nesting_volume_pricing;

-- Note: We're keeping nesting_volume_pricing on products for backward compatibility
-- The code will prioritize variant-level pricing over product-level pricing

