-- Migration: Add materialUsages field to quote_line_items and order_line_items
-- Purpose: Support multiple materials per line item (e.g., vinyl + laminate)
-- Date: 2025-12-02

-- Add materialUsages to quote_line_items
ALTER TABLE quote_line_items 
ADD COLUMN IF NOT EXISTS material_usages JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Add materialUsages to order_line_items  
ALTER TABLE order_line_items 
ADD COLUMN IF NOT EXISTS material_usages JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Add indexes for efficient querying by materialId
CREATE INDEX IF NOT EXISTS quote_line_items_material_usages_idx 
ON quote_line_items USING GIN (material_usages);

CREATE INDEX IF NOT EXISTS order_line_items_material_usages_idx 
ON order_line_items USING GIN (material_usages);

-- Comment the columns
COMMENT ON COLUMN quote_line_items.material_usages IS 
'Array of material usages for this line item. Structure: [{materialId: string, unitType: "sheet"|"sqft"|"linear_ft", quantity: number}]';

COMMENT ON COLUMN order_line_items.material_usages IS 
'Array of material usages for this line item. Structure: [{materialId: string, unitType: "sheet"|"sqft"|"linear_ft", quantity: number}]';
