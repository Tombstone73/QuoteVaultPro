-- Migration: Add product types table and link to products
-- Created: 2025-11-25

-- Create product types table
CREATE TABLE IF NOT EXISTS product_types (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create index for sort ordering
CREATE INDEX IF NOT EXISTS product_types_sort_order_idx ON product_types(sort_order);

-- Insert default product types
INSERT INTO product_types (id, name, description, sort_order) VALUES
  ('pt_roll', 'Roll', 'Roll-fed materials (vinyl, banner, etc.)', 1),
  ('pt_sheet', 'Sheet', 'Sheet-fed materials (foam board, coroplast, etc.)', 2),
  ('pt_digital', 'Digital Print', 'Digital printing services', 3),
  ('pt_offset', 'Offset Print', 'Offset printing services', 4),
  ('pt_finishing', 'Finishing', 'Lamination, mounting, cutting, etc.', 5),
  ('pt_wide_format', 'Wide Format', 'Large format printing', 6),
  ('pt_signage', 'Signage', 'Custom signs and displays', 7)
ON CONFLICT (name) DO NOTHING;

-- Add product_type_id column to products table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'product_type_id'
  ) THEN
    ALTER TABLE products ADD COLUMN product_type_id VARCHAR REFERENCES product_types(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_products_product_type_id ON products(product_type_id);
