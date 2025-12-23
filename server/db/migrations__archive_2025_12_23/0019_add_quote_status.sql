-- Create quote status enum if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quote_status') THEN
    CREATE TYPE quote_status AS ENUM ('draft', 'active', 'canceled');
  END IF;
END$$;

-- Add status column to quotes with default 'active'
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS status quote_status NOT NULL DEFAULT 'active';

-- Backfill any NULLs or legacy data to 'active'
UPDATE quotes SET status = 'active' WHERE status IS NULL;


