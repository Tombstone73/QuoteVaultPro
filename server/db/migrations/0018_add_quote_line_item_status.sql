-- Add status enum for quote line items
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quote_line_item_status') THEN
    CREATE TYPE quote_line_item_status AS ENUM ('draft', 'active', 'canceled');
  END IF;
END$$;

-- Add status column with default active
ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS status quote_line_item_status NOT NULL DEFAULT 'active';

-- Backfill existing rows to active (covers rows inserted before default existed)
UPDATE quote_line_items SET status = 'active' WHERE status IS NULL;


