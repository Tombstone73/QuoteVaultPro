-- Migration: Add selectedOptions JSONB field to order_line_items table
-- Purpose: Store snapshot of selected product options from quotes for audit trail
-- Date: 2025-11-24

DO $$ BEGIN
  -- Add selectedOptions column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_line_items' 
    AND column_name = 'selected_options'
  ) THEN
    ALTER TABLE "order_line_items"
    ADD COLUMN "selected_options" jsonb NOT NULL DEFAULT '[]'::jsonb;
    
    RAISE NOTICE 'Added selected_options column to order_line_items table';
  ELSE
    RAISE NOTICE 'selected_options column already exists in order_line_items table';
  END IF;
END $$;

-- Add comment to document the column
COMMENT ON COLUMN "order_line_items"."selected_options" IS 'Snapshot of selected product options from quote line item for audit purposes (read-only)';
