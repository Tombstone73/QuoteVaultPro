-- Migration 0017: Add shipping_cents to orders table
-- Purpose: Store shipping/delivery cost for orders (in cents) to display in totals

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'orders'
        AND column_name = 'shipping_cents'
    ) THEN
        ALTER TABLE orders ADD COLUMN shipping_cents INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'Added shipping_cents column to orders table';
    ELSE
        RAISE NOTICE 'shipping_cents column already exists in orders table';
    END IF;
END $$;
