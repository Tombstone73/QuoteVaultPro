-- Freeze the exact document bytes at queue time. Existing snapshots continue
-- to use their canonical projection as a backwards-compatible fallback.
ALTER TABLE customer_statement_snapshots
  ADD COLUMN IF NOT EXISTS pdf_bytes bytea;
