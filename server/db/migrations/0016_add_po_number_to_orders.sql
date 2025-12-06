-- Migration: Add PO number column to orders table
-- Purpose: Customer Purchase Order number for tracking

-- Add po_number column to orders table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'po_number'
  ) THEN
    ALTER TABLE orders ADD COLUMN po_number VARCHAR(64);
  END IF;
END $$;

-- Create index for PO number searching
CREATE INDEX IF NOT EXISTS orders_po_number_idx ON orders (po_number);
