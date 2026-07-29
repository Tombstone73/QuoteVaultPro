-- Allow final production files to be associated with a physical production run
-- without duplicating the file once per member line item.
ALTER TABLE "line_item_files"
  ADD COLUMN IF NOT EXISTS "production_run_id" varchar REFERENCES "production_runs"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "line_item_files_production_run_idx"
  ON "line_item_files" ("production_run_id");
