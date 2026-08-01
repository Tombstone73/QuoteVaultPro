ALTER TABLE "production_runs"
  ADD COLUMN "production_file_strategy" varchar(32) NOT NULL DEFAULT 'staff_prepared';
