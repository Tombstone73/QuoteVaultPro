-- Migration: Add 'pending_approval' to quote_status enum
-- Purpose: Support quote approval workflow with pending_approval state
-- Safe: Uses DO block to check if value exists before adding

DO $$ 
BEGIN
  -- Check if 'pending_approval' value already exists in quote_status enum
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_enum 
    WHERE enumlabel = 'pending_approval' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'quote_status')
  ) THEN
    -- Add the new enum value
    ALTER TYPE quote_status ADD VALUE 'pending_approval';
  END IF;
END $$;
