-- Migration 0016: Add shipping_cents to quotes table
-- Purpose: Store shipping cost for quotes (in cents) to display in totals

DO $$ 
BEGIN
    -- Add shipping_cents column (nullable integer, cents)
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'quotes' 
        AND column_name = 'shipping_cents'
    ) THEN
        ALTER TABLE quotes ADD COLUMN shipping_cents INTEGER NULL;
        RAISE NOTICE 'Added shipping_cents column to quotes table';
    ELSE
        RAISE NOTICE 'shipping_cents column already exists in quotes table';
    END IF;
END $$;
