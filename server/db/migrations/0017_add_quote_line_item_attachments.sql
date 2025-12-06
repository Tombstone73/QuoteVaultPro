-- Migration: Add quoteLineItemId to quote_attachments for per-line-item artwork
-- This allows attaching artwork to specific line items instead of just the quote

-- Add quoteLineItemId column to quote_attachments
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quote_attachments' 
    AND column_name = 'quote_line_item_id'
  ) THEN
    ALTER TABLE quote_attachments 
    ADD COLUMN quote_line_item_id VARCHAR REFERENCES quote_line_items(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add index for efficient lookups by line item
CREATE INDEX IF NOT EXISTS quote_attachments_quote_line_item_id_idx 
ON quote_attachments(quote_line_item_id);

-- Comment for documentation
COMMENT ON COLUMN quote_attachments.quote_line_item_id IS 
  'Optional: links attachment to a specific line item. NULL means quote-level attachment.';
