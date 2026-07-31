ALTER TABLE "production_runs"
  ADD COLUMN "sheet_plan_input_snapshot" jsonb,
  ADD COLUMN "calculated_sheet_plan_snapshot" jsonb,
  ADD COLUMN "effective_sheet_plan_snapshot" jsonb,
  ADD COLUMN "sheet_plan_override_reason" text,
  ADD COLUMN "sheet_plan_override_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "sheet_plan_override_at" timestamp with time zone,
  ADD COLUMN "sheet_plan_calculator_version" varchar(64);
