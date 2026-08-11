ALTER TABLE "production_runs"
  ADD COLUMN IF NOT EXISTS "sheet_progress_snapshot" jsonb;
