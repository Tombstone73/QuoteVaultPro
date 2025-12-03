-- Migration: Add roll-specific fields to materials table
-- These fields support accurate pricing and inventory for roll materials (vinyl, banners, etc.)

-- Add roll-specific columns to materials table
DO $$ BEGIN
    -- Roll length in feet
    ALTER TABLE materials ADD COLUMN IF NOT EXISTS roll_length_ft DECIMAL(10, 2);
    -- Cost per roll (vendor cost)
    ALTER TABLE materials ADD COLUMN IF NOT EXISTS cost_per_roll DECIMAL(10, 4);
    -- Edge waste per side in inches
    ALTER TABLE materials ADD COLUMN IF NOT EXISTS edge_waste_in_per_side DECIMAL(10, 2);
    -- Lead waste in feet (optional, defaults to 0)
    ALTER TABLE materials ADD COLUMN IF NOT EXISTS lead_waste_ft DECIMAL(10, 2) DEFAULT 0;
    -- Tail waste in feet (optional, defaults to 0)
    ALTER TABLE materials ADD COLUMN IF NOT EXISTS tail_waste_ft DECIMAL(10, 2) DEFAULT 0;
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

-- Add comments for documentation
COMMENT ON COLUMN materials.roll_length_ft IS 'Total roll length in feet (for roll materials only)';
COMMENT ON COLUMN materials.cost_per_roll IS 'Vendor cost per roll (for roll materials only)';
COMMENT ON COLUMN materials.edge_waste_in_per_side IS 'Edge waste per side in inches (for roll materials only)';
COMMENT ON COLUMN materials.lead_waste_ft IS 'Lead waste in feet at the start of roll (for roll materials only)';
COMMENT ON COLUMN materials.tail_waste_ft IS 'Tail waste in feet at the end of roll (for roll materials only)';
