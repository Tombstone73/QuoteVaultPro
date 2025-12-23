-- Add page_count column to quote_attachments
-- This column stores the total number of pages for PDF files
-- Used for multi-page PDF support and thumbnail generation

ALTER TABLE quote_attachments 
  ADD COLUMN IF NOT EXISTS page_count INTEGER;

-- Add comment for documentation
COMMENT ON COLUMN quote_attachments.page_count IS 'Total number of pages for PDF files (null for non-PDF attachments)';

