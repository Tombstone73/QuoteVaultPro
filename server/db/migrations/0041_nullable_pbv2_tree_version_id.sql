-- Migration 0041: Make pbv2_tree_version_id nullable for quote_line_items
-- Fixes FK violation when tree version ID is unavailable (previously used 'MISSING' literal)
-- Created: 2026-02-18

-- Drop NOT NULL constraint on quote_line_items.pbv2_tree_version_id
-- This allows NULL values when PBV2 tree version is not available or required
-- (e.g., for simple products or when pricing override is used)
DO $$ BEGIN
  ALTER TABLE quote_line_items 
  ALTER COLUMN pbv2_tree_version_id DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN
    -- Column doesn't exist, skip
    NULL;
  WHEN others THEN
    -- Column might already be nullable, continue
    NULL;
END $$;

-- No changes needed for order_line_items.pbv2_tree_version_id - already nullable
-- No changes needed for pbv2_snapshot_json or priced_at - keep as NOT NULL for audit trail
