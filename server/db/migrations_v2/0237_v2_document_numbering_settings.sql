-- M6: controlled Settings configuration for the existing V2 Sales allocator.
-- This is future-only: historical V2 document display numbers are never
-- rewritten, and compatibility/V1 document allocators remain untouched.

ALTER TABLE v2_sales_document_number_counters
  ADD COLUMN IF NOT EXISTS display_prefix varchar(16),
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;

UPDATE v2_sales_document_number_counters
SET display_prefix = CASE document_kind
  WHEN 'quote' THEN 'QT-'
  WHEN 'order' THEN 'ORD-'
  ELSE display_prefix
END
WHERE display_prefix IS NULL;

ALTER TABLE v2_sales_document_number_counters
  ALTER COLUMN display_prefix SET NOT NULL,
  ADD CONSTRAINT v2_sales_document_number_counters_prefix_chk CHECK (
    length(display_prefix) <= 16
    AND display_prefix ~ '^[A-Za-z0-9_-]*$'
  ),
  ADD CONSTRAINT v2_sales_document_number_counters_revision_chk CHECK (revision > 0);
