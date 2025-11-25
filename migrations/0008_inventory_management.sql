-- ============================================================
-- MIGRATION 0008: INVENTORY MANAGEMENT SYSTEM
-- ============================================================
-- Purpose: Add materials, inventory tracking, and material usage tables
-- Dependencies: orders, orderLineItems, users tables must exist

-- Create materials table
CREATE TABLE IF NOT EXISTS materials (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) NOT NULL UNIQUE,
  type VARCHAR(50) NOT NULL, -- sheet, roll, ink, consumable
  unit_of_measure VARCHAR(50) NOT NULL, -- sheet, sqft, linear_ft, ml, ea
  width DECIMAL(10, 2), -- nullable width dimension
  height DECIMAL(10, 2), -- nullable height dimension
  thickness DECIMAL(10, 4), -- nullable thickness
  color VARCHAR(100), -- nullable color
  cost_per_unit DECIMAL(10, 4) NOT NULL,
  stock_quantity DECIMAL(10, 2) NOT NULL DEFAULT 0,
  min_stock_alert DECIMAL(10, 2) NOT NULL DEFAULT 0,
  vendor_id VARCHAR, -- nullable FK for future vendor management
  specs_json JSONB, -- router/ink/material metadata
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS materials_type_idx ON materials(type);
CREATE INDEX IF NOT EXISTS materials_sku_idx ON materials(sku);
CREATE INDEX IF NOT EXISTS materials_stock_quantity_idx ON materials(stock_quantity);

-- Create inventory_adjustments table
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id VARCHAR NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- manual_increase, manual_decrease, waste, shrinkage, job_usage
  quantity_change DECIMAL(10, 2) NOT NULL, -- positive or negative
  reason TEXT,
  order_id VARCHAR REFERENCES orders(id) ON DELETE SET NULL, -- nullable, for job usage tracking
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_adjustments_material_id_idx ON inventory_adjustments(material_id);
CREATE INDEX IF NOT EXISTS inventory_adjustments_type_idx ON inventory_adjustments(type);
CREATE INDEX IF NOT EXISTS inventory_adjustments_order_id_idx ON inventory_adjustments(order_id);
CREATE INDEX IF NOT EXISTS inventory_adjustments_created_at_idx ON inventory_adjustments(created_at);

-- Create order_material_usage table
CREATE TABLE IF NOT EXISTS order_material_usage (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id VARCHAR NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_item_id VARCHAR NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
  material_id VARCHAR NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  quantity_used DECIMAL(10, 2) NOT NULL,
  unit_of_measure VARCHAR(50) NOT NULL,
  calculated_by VARCHAR(50) NOT NULL DEFAULT 'auto', -- auto or manual
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_material_usage_order_id_idx ON order_material_usage(order_id);
CREATE INDEX IF NOT EXISTS order_material_usage_order_line_item_id_idx ON order_material_usage(order_line_item_id);
CREATE INDEX IF NOT EXISTS order_material_usage_material_id_idx ON order_material_usage(material_id);

-- Add inventory-related columns to order_line_items table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_line_items' AND column_name = 'material_id'
  ) THEN
    ALTER TABLE order_line_items ADD COLUMN material_id VARCHAR REFERENCES materials(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_line_items' AND column_name = 'material_usage_json'
  ) THEN
    ALTER TABLE order_line_items ADD COLUMN material_usage_json JSONB;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_line_items' AND column_name = 'requires_inventory'
  ) THEN
    ALTER TABLE order_line_items ADD COLUMN requires_inventory BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- Add index on material_id in order_line_items
CREATE INDEX IF NOT EXISTS order_line_items_material_id_idx ON order_line_items(material_id);
