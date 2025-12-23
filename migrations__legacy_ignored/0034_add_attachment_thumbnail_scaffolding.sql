-- Add thumbnail scaffolding fields to quote_attachments
-- This enables async thumbnail generation without blocking uploads

-- Create enum for thumbnail status if not exists
DO $$ BEGIN
  CREATE TYPE thumb_status AS ENUM ('uploaded', 'thumb_pending', 'thumb_ready', 'thumb_failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add thumbnail fields to quote_attachments table
ALTER TABLE quote_attachments 
  ADD COLUMN IF NOT EXISTS thumb_status thumb_status DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS thumb_key TEXT,
  ADD COLUMN IF NOT EXISTS preview_key TEXT,
  ADD COLUMN IF NOT EXISTS thumb_error TEXT;

-- Add index for querying attachments that need thumbnail processing
CREATE INDEX IF NOT EXISTS quote_attachments_thumb_status_idx ON quote_attachments(thumb_status);

-- Add comment for documentation
COMMENT ON COLUMN quote_attachments.thumb_status IS 'Thumbnail generation status: uploaded (no thumbnails yet), thumb_pending (queued), thumb_ready (available), thumb_failed (error)';
COMMENT ON COLUMN quote_attachments.thumb_key IS 'Storage key for thumbnail image (small preview, typically 200x200)';
COMMENT ON COLUMN quote_attachments.preview_key IS 'Storage key for preview image (medium size, typically 800x800)';
COMMENT ON COLUMN quote_attachments.thumb_error IS 'Error message if thumbnail generation failed (for debugging)';

