-- Add thumbnail key fields to order_attachments
-- This enables thumbnail generation for order attachments (images only)
-- Matches the thumbnail scaffolding added to quote_attachments in migration 0034

-- Add thumbnail key fields to order_attachments table
ALTER TABLE order_attachments 
  ADD COLUMN IF NOT EXISTS thumb_key TEXT,
  ADD COLUMN IF NOT EXISTS preview_key TEXT;

-- Add comments for documentation
COMMENT ON COLUMN order_attachments.thumb_key IS 'Storage key for thumbnail image (small preview, typically 320x320)';
COMMENT ON COLUMN order_attachments.preview_key IS 'Storage key for preview image (medium size, typically 1600x1600)';

