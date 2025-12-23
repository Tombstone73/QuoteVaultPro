-- 0033_add_quotes_status_column.sql
-- Add status column to quotes table using the quote_status enum

-- First, ensure the quote_status enum exists (it should from earlier migrations)
DO $$ BEGIN
    CREATE TYPE quote_status AS ENUM ('draft', 'active', 'canceled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add status column with default 'active' for backward compatibility
ALTER TABLE "quotes"
ADD COLUMN IF NOT EXISTS "status" quote_status NOT NULL DEFAULT 'active';

-- Create index on status for filtering queries
CREATE INDEX IF NOT EXISTS "quotes_status_idx" ON "quotes" ("status");

