-- Add minimum price per item for nesting calculator
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_price_per_item DECIMAL(10, 2);

-- Add volume pricing tiers for nesting calculator (based on sheet count)
ALTER TABLE products ADD COLUMN IF NOT EXISTS nesting_volume_pricing JSONB DEFAULT '{"enabled":false,"tiers":[]}'::jsonb;

-- Comment the new columns
COMMENT ON COLUMN products.min_price_per_item IS 'Minimum price per item when using nesting calculator';
COMMENT ON COLUMN products.nesting_volume_pricing IS 'Volume pricing tiers for nesting calculator based on sheet count. Format: {enabled: boolean, tiers: [{minSheets: number, maxSheets?: number, pricePerSheet: number}]}';

