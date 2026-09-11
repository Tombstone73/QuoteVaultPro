-- V2 staff-only order-line context. This is deliberately separate from
-- immutable price/tax evidence and has no document or Portal projection.
ALTER TABLE v2_sales_document_lines
  ADD COLUMN IF NOT EXISTS operational_note text;

ALTER TABLE v2_sales_document_lines
  ADD CONSTRAINT v2_sales_document_lines_operational_note_length_chk
  CHECK (operational_note IS NULL OR char_length(operational_note) <= 4000);
