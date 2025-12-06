-- Migration: Add label column to quotes and orders tables
-- Purpose: Free-text label field for categorization/notes

-- Add label column to quotes table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quotes' AND column_name = 'label'
  ) THEN
    ALTER TABLE quotes ADD COLUMN label TEXT;
  END IF;
END $$;

-- Add label column to orders table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'label'
  ) THEN
    ALTER TABLE orders ADD COLUMN label TEXT;
  END IF;
END $$;
