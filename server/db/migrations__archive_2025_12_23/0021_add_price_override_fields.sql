-- Migration: Add manual price override support to quote line items
-- Adds priceOverride (JSONB) and formulaLinePrice (decimal) fields
-- Preserves calculated price for audit/revert while allowing manual overrides

-- Add price override field (stores { mode: 'unit'|'total', value: number })
ALTER TABLE quote_line_items 
ADD COLUMN IF NOT EXISTS price_override jsonb NULL;

-- Add formula line price field (preserves last calculated price)
ALTER TABLE quote_line_items 
ADD COLUMN IF NOT EXISTS formula_line_price decimal(10, 2) NULL;

-- Add index for queries filtering by override status
CREATE INDEX IF NOT EXISTS quote_line_items_price_override_idx 
ON quote_line_items ((price_override IS NOT NULL));

-- Add comment for documentation
COMMENT ON COLUMN quote_line_items.price_override IS 
'Manual price override: { mode: "unit"|"total", value: number }. Null when no override.';

COMMENT ON COLUMN quote_line_items.formula_line_price IS 
'Last calculated price from formula/calculator. Preserved when override is applied for audit/revert.';
