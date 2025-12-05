-- Migration: Enhanced File Storage Model
-- Description: Adds fields for storing original filenames, safe disk filenames, 
--              file paths, storage provider info, and thumbnail support to 
--              quoteAttachments and orderAttachments tables.
-- Date: 2024-12-05

-- Create storage provider enum
DO $$ BEGIN
  CREATE TYPE storage_provider AS ENUM ('local', 's3', 'gcs', 'supabase');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add new columns to quote_attachments
ALTER TABLE quote_attachments
  ADD COLUMN IF NOT EXISTS original_filename VARCHAR(500),
  ADD COLUMN IF NOT EXISTS stored_filename VARCHAR(500),
  ADD COLUMN IF NOT EXISTS relative_path TEXT,
  ADD COLUMN IF NOT EXISTS storage_provider storage_provider DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS extension VARCHAR(20),
  ADD COLUMN IF NOT EXISTS size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS checksum VARCHAR(64),
  ADD COLUMN IF NOT EXISTS thumbnail_relative_path TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_generated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Add new columns to order_attachments
ALTER TABLE order_attachments
  ADD COLUMN IF NOT EXISTS original_filename VARCHAR(500),
  ADD COLUMN IF NOT EXISTS stored_filename VARCHAR(500),
  ADD COLUMN IF NOT EXISTS relative_path TEXT,
  ADD COLUMN IF NOT EXISTS storage_provider storage_provider DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS extension VARCHAR(20),
  ADD COLUMN IF NOT EXISTS size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS checksum VARCHAR(64),
  ADD COLUMN IF NOT EXISTS thumbnail_relative_path TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_generated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Backfill original_filename from file_name for existing records
UPDATE quote_attachments 
SET original_filename = file_name 
WHERE original_filename IS NULL AND file_name IS NOT NULL;

UPDATE order_attachments 
SET original_filename = file_name 
WHERE original_filename IS NULL AND file_name IS NOT NULL;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS quote_attachments_storage_provider_idx 
  ON quote_attachments(storage_provider);
  
CREATE INDEX IF NOT EXISTS order_attachments_storage_provider_idx 
  ON order_attachments(storage_provider);

-- Add comments for documentation
COMMENT ON COLUMN quote_attachments.original_filename IS 'Original filename as uploaded by user (displayed in UI)';
COMMENT ON COLUMN quote_attachments.stored_filename IS 'Sanitized filename used on disk (format: {shortId}_{slug}.{ext})';
COMMENT ON COLUMN quote_attachments.relative_path IS 'Path relative to storage root (e.g., org-{orgId}/quotes/{quoteId}/{storedFilename})';
COMMENT ON COLUMN quote_attachments.storage_provider IS 'Storage backend: local, s3, gcs, or supabase';
COMMENT ON COLUMN quote_attachments.checksum IS 'SHA256 hash for file integrity verification';

COMMENT ON COLUMN order_attachments.original_filename IS 'Original filename as uploaded by user (displayed in UI)';
COMMENT ON COLUMN order_attachments.stored_filename IS 'Sanitized filename used on disk (format: {shortId}_{slug}.{ext})';
COMMENT ON COLUMN order_attachments.relative_path IS 'Path relative to storage root (e.g., org-{orgId}/orders/{orderNum}/line-{lineItemId}/{storedFilename})';
COMMENT ON COLUMN order_attachments.storage_provider IS 'Storage backend: local, s3, gcs, or supabase';
COMMENT ON COLUMN order_attachments.checksum IS 'SHA256 hash for file integrity verification';
