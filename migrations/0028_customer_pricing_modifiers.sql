-- Migration: Add Per-Customer Pricing Modifiers and Product Visibility
-- Description: Adds customer-specific pricing adjustments (discount, markup, margin)
--              and product visibility controls for the customer portal.
-- Date: 2025-12-03

-- ============================================================
-- CUSTOMERS TABLE: Add pricing modifier fields
-- ============================================================

DO $$ BEGIN
  -- Default discount percentage (e.g., 10 = 10% off)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'default_discount_percent'
  ) THEN
    ALTER TABLE customers ADD COLUMN default_discount_percent DECIMAL(5, 2) NULL;
  END IF;

  -- Default markup percentage (e.g., 50 = 50% markup)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'default_markup_percent'
  ) THEN
    ALTER TABLE customers ADD COLUMN default_markup_percent DECIMAL(5, 2) NULL;
  END IF;

  -- Target margin percentage (e.g., 40 = 40% margin, overrides markup/discount)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'default_margin_percent'
  ) THEN
    ALTER TABLE customers ADD COLUMN default_margin_percent DECIMAL(5, 2) NULL;
  END IF;

  -- Product visibility mode for portal
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'product_visibility_mode'
  ) THEN
    ALTER TABLE customers ADD COLUMN product_visibility_mode VARCHAR(20) NOT NULL DEFAULT 'default';
  END IF;
END $$;

-- Add check constraints for valid ranges
DO $$ BEGIN
  -- Discount: 0-100%
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'customers_default_discount_percent_check'
  ) THEN
    ALTER TABLE customers 
    ADD CONSTRAINT customers_default_discount_percent_check 
    CHECK (default_discount_percent IS NULL OR (default_discount_percent >= 0 AND default_discount_percent <= 100));
  END IF;

  -- Markup: 0-500% (reasonable upper bound)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'customers_default_markup_percent_check'
  ) THEN
    ALTER TABLE customers 
    ADD CONSTRAINT customers_default_markup_percent_check 
    CHECK (default_markup_percent IS NULL OR (default_markup_percent >= 0 AND default_markup_percent <= 500));
  END IF;

  -- Margin: 0-95% (prevent division by zero)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'customers_default_margin_percent_check'
  ) THEN
    ALTER TABLE customers 
    ADD CONSTRAINT customers_default_margin_percent_check 
    CHECK (default_margin_percent IS NULL OR (default_margin_percent >= 0 AND default_margin_percent < 95));
  END IF;

  -- Product visibility mode: 'default' or 'linked-only'
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'customers_product_visibility_mode_check'
  ) THEN
    ALTER TABLE customers 
    ADD CONSTRAINT customers_product_visibility_mode_check 
    CHECK (product_visibility_mode IN ('default', 'linked-only'));
  END IF;
END $$;

-- Add index for filtering by visibility mode
CREATE INDEX IF NOT EXISTS customers_product_visibility_mode_idx ON customers(product_visibility_mode);

-- ============================================================
-- CUSTOMER_VISIBLE_PRODUCTS TABLE: Junction for linked products
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_visible_products (
  customer_id VARCHAR NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id VARCHAR NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  PRIMARY KEY (customer_id, product_id)
);

-- Add index for fast lookup by customer
CREATE INDEX IF NOT EXISTS customer_visible_products_customer_id_idx ON customer_visible_products(customer_id);

-- Add index for reverse lookup by product
CREATE INDEX IF NOT EXISTS customer_visible_products_product_id_idx ON customer_visible_products(product_id);

-- ============================================================
-- COMMENTS for documentation
-- ============================================================

COMMENT ON COLUMN customers.default_discount_percent IS 'Optional percentage discount applied after tier-based pricing (0-100)';
COMMENT ON COLUMN customers.default_markup_percent IS 'Optional percentage markup added to tier-based pricing (0-500)';
COMMENT ON COLUMN customers.default_margin_percent IS 'Optional target profit margin based on cost (0-95, overrides markup/discount)';
COMMENT ON COLUMN customers.product_visibility_mode IS 'Portal product visibility: default (all eligible) or linked-only (restricted catalog)';

COMMENT ON TABLE customer_visible_products IS 'Junction table linking customers to specific products for linked-only visibility mode';
