
DO $$ 
BEGIN
    -- Check if order_id column exists in jobs table
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'jobs' 
        AND column_name = 'order_id'
    ) THEN
        -- Add the column if it doesn't exist
        ALTER TABLE jobs ADD COLUMN order_id VARCHAR REFERENCES orders(id) ON DELETE CASCADE;
        RAISE NOTICE 'Added order_id column to jobs table';
    ELSE
        RAISE NOTICE 'order_id column already exists in jobs table';
    END IF;

    -- Also check for order_line_item_id just in case
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'jobs' 
        AND column_name = 'order_line_item_id'
    ) THEN
        ALTER TABLE jobs ADD COLUMN order_line_item_id VARCHAR NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE;
        RAISE NOTICE 'Added order_line_item_id column to jobs table';
    END IF;
END $$;
