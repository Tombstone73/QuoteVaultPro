-- Migration: Add async artwork processing fields
-- Adds status, storage keys for derived artifacts (thumbnails, print-ready files)

-- Add processing status enum
DO $$ BEGIN
  CREATE TYPE file_processing_status AS ENUM ('uploaded', 'processing', 'ready', 'error');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add async processing columns to quote_attachments
ALTER TABLE quote_attachments
  ADD COLUMN IF NOT EXISTS processing_status file_processing_status DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS thumb_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS preview_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS derived_print_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS derived_print_filename VARCHAR(500),
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS bucket VARCHAR(100) DEFAULT 'titan-private';

-- Add index for processing status queries
CREATE INDEX IF NOT EXISTS quote_attachments_processing_status_idx 
  ON quote_attachments(processing_status);

-- Comments
COMMENT ON COLUMN quote_attachments.processing_status IS 'Processing state: uploaded, processing, ready, error';
COMMENT ON COLUMN quote_attachments.thumb_storage_key IS 'Storage key for 256px thumbnail';
COMMENT ON COLUMN quote_attachments.preview_storage_key IS 'Storage key for 1024px preview';
COMMENT ON COLUMN quote_attachments.derived_print_storage_key IS 'Storage key for print-ready PDF with injected metadata';
COMMENT ON COLUMN quote_attachments.derived_print_filename IS 'Filename for derived print-ready file download';
COMMENT ON COLUMN quote_attachments.bucket IS 'Supabase storage bucket name';

