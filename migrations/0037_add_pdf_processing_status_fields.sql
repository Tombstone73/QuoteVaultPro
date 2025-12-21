-- Add PDF processing status fields to quote_attachments
-- This enables tracking page count detection and thumbnail generation status for PDFs
--
-- State transitions:
-- - pageCountStatus: unknown -> detecting -> known/failed
-- - thumbStatus: uploaded -> thumb_pending (queued) -> thumb_ready/thumb_failed

-- Create enum for page count status if not exists
DO $$ BEGIN
  CREATE TYPE page_count_status AS ENUM ('unknown', 'detecting', 'known', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add PDF processing fields to quote_attachments table
ALTER TABLE quote_attachments 
  ADD COLUMN IF NOT EXISTS page_count_status page_count_status DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS page_count_error TEXT,
  ADD COLUMN IF NOT EXISTS page_count_updated_at TIMESTAMP;

-- Add index for querying attachments that need PDF processing
CREATE INDEX IF NOT EXISTS quote_attachments_page_count_status_idx ON quote_attachments(page_count_status);

-- Add comments for documentation
COMMENT ON COLUMN quote_attachments.page_count_status IS 'PDF page count detection status: unknown (not detected yet), detecting (in progress), known (detected successfully), failed (detection error)';
COMMENT ON COLUMN quote_attachments.page_count_error IS 'Error message if page count detection failed (truncated to 500 chars)';
COMMENT ON COLUMN quote_attachments.page_count_updated_at IS 'Timestamp when page count status was last updated';

