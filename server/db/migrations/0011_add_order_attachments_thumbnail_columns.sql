-- Migration 0011: Add thumbnail support columns to order_attachments
-- This aligns order_attachments with quote_attachments thumbnail infrastructure

-- Add thumbnail key columns
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'order_attachments' AND column_name = 'thumb_key'
    ) THEN
        ALTER TABLE order_attachments ADD COLUMN thumb_key TEXT;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'order_attachments' AND column_name = 'preview_key'
    ) THEN
        ALTER TABLE order_attachments ADD COLUMN preview_key TEXT;
    END IF;
END $$;

-- Add thumb_status enum and column (matches quote_attachments pattern)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'thumb_status'
    ) THEN
        CREATE TYPE thumb_status AS ENUM ('uploaded', 'thumb_pending', 'thumb_ready', 'thumb_failed');
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'order_attachments' AND column_name = 'thumb_status'
    ) THEN
        ALTER TABLE order_attachments ADD COLUMN thumb_status thumb_status DEFAULT 'uploaded';
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'order_attachments' AND column_name = 'thumb_error'
    ) THEN
        ALTER TABLE order_attachments ADD COLUMN thumb_error TEXT;
    END IF;
END $$;

-- Add index for thumb_status filtering (performance optimization)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'order_attachments' AND indexname = 'order_attachments_thumb_status_idx'
    ) THEN
        CREATE INDEX order_attachments_thumb_status_idx ON order_attachments(thumb_status);
    END IF;
END $$;

-- Comments for documentation
COMMENT ON COLUMN order_attachments.thumb_key IS 'Storage key for small thumbnail (e.g., 320x320)';
COMMENT ON COLUMN order_attachments.preview_key IS 'Storage key for medium preview (e.g., 1600x1600)';
COMMENT ON COLUMN order_attachments.thumb_status IS 'Thumbnail generation status matching quote_attachments pattern';
COMMENT ON COLUMN order_attachments.thumb_error IS 'Error message if thumbnail generation failed';
