-- Migration 0039: Line Item Enhancements
-- Add description, price override fields, and per-line-item dimensions support
-- Created: 2026-02-17

-- 1. Add description field to quote_line_items (orderLineItems already has it)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quote_line_items' AND column_name = 'description'
  ) THEN
    ALTER TABLE quote_line_items ADD COLUMN description TEXT;
  END IF;
END $$;

-- 2. Add price override fields to quote_line_items
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quote_line_items' AND column_name = 'override_price_cents'
  ) THEN
    ALTER TABLE quote_line_items ADD COLUMN override_price_cents INTEGER;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quote_line_items' AND column_name = 'override_at'
  ) THEN
    ALTER TABLE quote_line_items ADD COLUMN override_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quote_line_items' AND column_name = 'override_by_user_id'
  ) THEN
    ALTER TABLE quote_line_items ADD COLUMN override_by_user_id VARCHAR;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quote_line_items' AND column_name = 'override_reason'
  ) THEN
    ALTER TABLE quote_line_items ADD COLUMN override_reason TEXT;
  END IF;
END $$;

-- Add foreign key for override_by_user_id if column was just created
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'quote_line_items_override_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE quote_line_items 
    ADD CONSTRAINT quote_line_items_override_by_user_id_users_id_fk 
    FOREIGN KEY (override_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Add price override fields to order_line_items
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_line_items' AND column_name = 'override_price_cents'
  ) THEN
    ALTER TABLE order_line_items ADD COLUMN override_price_cents INTEGER;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_line_items' AND column_name = 'override_at'
  ) THEN
    ALTER TABLE order_line_items ADD COLUMN override_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_line_items' AND column_name = 'override_by_user_id'
  ) THEN
    ALTER TABLE order_line_items ADD COLUMN override_by_user_id VARCHAR;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_line_items' AND column_name = 'override_reason'
  ) THEN
    ALTER TABLE order_line_items ADD COLUMN override_reason TEXT;
  END IF;
END $$;

-- Add foreign key for override_by_user_id if column was just created
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'order_line_items_override_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE order_line_items 
    ADD CONSTRAINT order_line_items_override_by_user_id_users_id_fk 
    FOREIGN KEY (override_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Note: width_in and height_in already exist as "width" and "height" decimal columns
-- on both quote_line_items and order_line_items (per-line-item storage confirmed)
