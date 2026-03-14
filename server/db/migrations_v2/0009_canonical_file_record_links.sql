-- Migration 0009: Canonical file record links on business file rows
-- Adds nullable file_record_id linkage for original-file canonical reads.

DO $$ BEGIN
  ALTER TABLE quote_attachments
    ADD COLUMN IF NOT EXISTS file_record_id varchar REFERENCES file_records(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS quote_attachments_file_record_id_idx
  ON quote_attachments (file_record_id);

DO $$ BEGIN
  ALTER TABLE order_attachments
    ADD COLUMN IF NOT EXISTS file_record_id varchar REFERENCES file_records(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS order_attachments_file_record_id_idx
  ON order_attachments (file_record_id);

DO $$ BEGIN
  ALTER TABLE line_item_files
    ADD COLUMN IF NOT EXISTS file_record_id varchar REFERENCES file_records(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS line_item_files_file_record_idx
  ON line_item_files (file_record_id);