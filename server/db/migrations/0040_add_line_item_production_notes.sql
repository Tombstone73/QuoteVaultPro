-- Migration: Add production_notes field to quote_line_items and order_line_items
-- Purpose: Store internal production notes separate from customer-facing description
-- Date: 2026-02-17

-- Add production_notes to quote_line_items
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quote_line_items' 
    AND column_name = 'production_notes'
  ) THEN
    ALTER TABLE quote_line_items 
    ADD COLUMN production_notes TEXT;
  END IF;
END $$;

-- Add production_notes to order_line_items
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_line_items' 
    AND column_name = 'production_notes'
  ) THEN
    ALTER TABLE order_line_items 
    ADD COLUMN production_notes TEXT;
  END IF;
END $$;
