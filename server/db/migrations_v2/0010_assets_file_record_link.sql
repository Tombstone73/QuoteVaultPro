-- Migration 0010: Canonical file record link on assets
-- Adds nullable asset -> file_records linkage for canonical original-file reads.

DO $$ BEGIN
  ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS file_record_id varchar REFERENCES file_records(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS assets_file_record_id_idx
  ON assets (file_record_id);