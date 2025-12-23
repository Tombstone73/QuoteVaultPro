-- Migration 0029: Tax System
-- Add sales tax fields to organizations, customers, products, quotes, orders, and line items

-- =============================================
-- 1. ORGANIZATION TAX SETTINGS
-- =============================================

DO $$ BEGIN
  -- Add default tax rate to organizations
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organizations' 
    AND column_name = 'default_tax_rate'
  ) THEN
    ALTER TABLE organizations 
    ADD COLUMN default_tax_rate DECIMAL(5, 4) DEFAULT 0 NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  -- Add tax enabled flag to organizations
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organizations' 
    AND column_name = 'tax_enabled'
  ) THEN
    ALTER TABLE organizations 
    ADD COLUMN tax_enabled BOOLEAN DEFAULT TRUE NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN organizations.default_tax_rate IS 'Default sales tax rate for the organization (e.g., 0.07 for 7%)';
COMMENT ON COLUMN organizations.tax_enabled IS 'Whether tax calculation is enabled for this organization';

-- =============================================
-- 2. CUSTOMER TAX FIELDS
-- =============================================

DO $$ BEGIN
  -- Tax exempt flag
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' 
    AND column_name = 'is_tax_exempt'
  ) THEN
    ALTER TABLE customers 
    ADD COLUMN is_tax_exempt BOOLEAN DEFAULT FALSE NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  -- Tax rate override
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' 
    AND column_name = 'tax_rate_override'
  ) THEN
    ALTER TABLE customers 
    ADD COLUMN tax_rate_override DECIMAL(5, 4) NULL;
  END IF;
END $$;

DO $$ BEGIN
  -- Tax exempt reason
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' 
    AND column_name = 'tax_exempt_reason'
  ) THEN
    ALTER TABLE customers 
    ADD COLUMN tax_exempt_reason TEXT NULL;
  END IF;
END $$;

DO $$ BEGIN
  -- Tax exempt certificate reference
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' 
    AND column_name = 'tax_exempt_certificate_ref'
  ) THEN
    ALTER TABLE customers 
    ADD COLUMN tax_exempt_certificate_ref TEXT NULL;
  END IF;
END $$;

-- Add check constraint for tax rate override (0-30%)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'customers_tax_rate_override_range'
  ) THEN
    ALTER TABLE customers 
    ADD CONSTRAINT customers_tax_rate_override_range 
    CHECK (tax_rate_override IS NULL OR (tax_rate_override >= 0 AND tax_rate_override <= 0.30));
  END IF;
END $$;

COMMENT ON COLUMN customers.is_tax_exempt IS 'Whether this customer is exempt from sales tax';
COMMENT ON COLUMN customers.tax_rate_override IS 'Optional tax rate override for this customer (0.00 - 0.30)';
COMMENT ON COLUMN customers.tax_exempt_reason IS 'Required reason when customer is tax exempt (e.g., "Resale certificate on file")';
COMMENT ON COLUMN customers.tax_exempt_certificate_ref IS 'Optional reference to tax exempt certificate (filename, URL, or ID)';

-- =============================================
-- 3. PRODUCT TAXABILITY
-- =============================================

DO $$ BEGIN
  -- Add is_taxable to products table
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' 
    AND column_name = 'is_taxable'
  ) THEN
    ALTER TABLE products 
    ADD COLUMN is_taxable BOOLEAN DEFAULT TRUE NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  -- Add is_taxable to product_variants table
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'product_variants' 
    AND column_name = 'is_taxable'
  ) THEN
    ALTER TABLE product_variants 
    ADD COLUMN is_taxable BOOLEAN DEFAULT TRUE NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN products.is_taxable IS 'Whether this product is subject to sales tax';
COMMENT ON COLUMN product_variants.is_taxable IS 'Whether this product variant is subject to sales tax';

-- =============================================
-- 4. QUOTES TAX FIELDS
-- =============================================

DO $$ BEGIN
  -- Tax rate snapshot
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quotes' 
    AND column_name = 'tax_rate'
  ) THEN
    ALTER TABLE quotes 
    ADD COLUMN tax_rate DECIMAL(5, 4) NULL;
  END IF;
END $$;

DO $$ BEGIN
  -- Tax amount total
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quotes' 
    AND column_name = 'tax_amount'
  ) THEN
    ALTER TABLE quotes 
    ADD COLUMN tax_amount DECIMAL(10, 2) DEFAULT 0 NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  -- Taxable subtotal
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quotes' 
    AND column_name = 'taxable_subtotal'
  ) THEN
    ALTER TABLE quotes 
    ADD COLUMN taxable_subtotal DECIMAL(10, 2) DEFAULT 0 NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN quotes.tax_rate IS 'Effective tax rate applied to this quote (snapshot)';
COMMENT ON COLUMN quotes.tax_amount IS 'Total tax amount for this quote';
COMMENT ON COLUMN quotes.taxable_subtotal IS 'Subtotal of taxable line items only';

-- =============================================
-- 5. ORDERS TAX FIELDS
-- =============================================

DO $$ BEGIN
  -- Tax rate snapshot
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' 
    AND column_name = 'tax_rate'
  ) THEN
    ALTER TABLE orders 
    ADD COLUMN tax_rate DECIMAL(5, 4) NULL;
  END IF;
END $$;

DO $$ BEGIN
  -- Tax amount total
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' 
    AND column_name = 'tax_amount'
  ) THEN
    ALTER TABLE orders 
    ADD COLUMN tax_amount DECIMAL(10, 2) DEFAULT 0 NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  -- Taxable subtotal
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' 
    AND column_name = 'taxable_subtotal'
  ) THEN
    ALTER TABLE orders 
    ADD COLUMN taxable_subtotal DECIMAL(10, 2) DEFAULT 0 NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN orders.tax_rate IS 'Effective tax rate applied to this order (snapshot)';
COMMENT ON COLUMN orders.tax_amount IS 'Total tax amount for this order';
COMMENT ON COLUMN orders.taxable_subtotal IS 'Subtotal of taxable line items only';

-- =============================================
-- 6. QUOTE LINE ITEMS TAX FIELDS
-- =============================================

DO $$ BEGIN
  -- Tax amount per line
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quote_line_items' 
    AND column_name = 'tax_amount'
  ) THEN
    ALTER TABLE quote_line_items 
    ADD COLUMN tax_amount DECIMAL(10, 2) DEFAULT 0 NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  -- Taxable snapshot flag
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quote_line_items' 
    AND column_name = 'is_taxable_snapshot'
  ) THEN
    ALTER TABLE quote_line_items 
    ADD COLUMN is_taxable_snapshot BOOLEAN DEFAULT TRUE NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN quote_line_items.tax_amount IS 'Tax amount for this line item';
COMMENT ON COLUMN quote_line_items.is_taxable_snapshot IS 'Whether this line item was taxable at time of quote creation';

-- =============================================
-- 7. ORDER LINE ITEMS TAX FIELDS
-- =============================================

DO $$ BEGIN
  -- Tax amount per line
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_line_items' 
    AND column_name = 'tax_amount'
  ) THEN
    ALTER TABLE order_line_items 
    ADD COLUMN tax_amount DECIMAL(10, 2) DEFAULT 0 NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  -- Taxable snapshot flag
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_line_items' 
    AND column_name = 'is_taxable_snapshot'
  ) THEN
    ALTER TABLE order_line_items 
    ADD COLUMN is_taxable_snapshot BOOLEAN DEFAULT TRUE NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN order_line_items.tax_amount IS 'Tax amount for this line item';
COMMENT ON COLUMN order_line_items.is_taxable_snapshot IS 'Whether this line item was taxable at time of order creation';

-- =============================================
-- 8. CREATE INDEXES FOR PERFORMANCE
-- =============================================

CREATE INDEX IF NOT EXISTS idx_customers_is_tax_exempt ON customers(is_tax_exempt) WHERE is_tax_exempt = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_is_taxable ON products(is_taxable);
CREATE INDEX IF NOT EXISTS idx_product_variants_is_taxable ON product_variants(is_taxable);

-- =============================================
-- MIGRATION COMPLETE
-- =============================================
