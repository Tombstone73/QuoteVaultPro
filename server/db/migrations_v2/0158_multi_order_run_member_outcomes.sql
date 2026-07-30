ALTER TABLE "production_runs" ALTER COLUMN "order_id" DROP NOT NULL;
ALTER TABLE "production_runs" DROP CONSTRAINT IF EXISTS "production_runs_order_id_orders_id_fk";
ALTER TABLE "production_runs"
  ADD CONSTRAINT "production_runs_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX IF NOT EXISTS "production_runs_org_status_idx"
  ON "production_runs" ("organization_id", "status");

ALTER TABLE "production_run_members"
  ADD COLUMN IF NOT EXISTS "successful_quantity" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "damaged_quantity" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "remaining_quantity" integer,
  ADD COLUMN IF NOT EXISTS "outcome_status" varchar(40) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "recovery_disposition" varchar(40),
  ADD COLUMN IF NOT EXISTS "operator_note" text,
  ADD COLUMN IF NOT EXISTS "outcome_segments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "last_outcome_idempotency_key" varchar(160),
  ADD COLUMN IF NOT EXISTS "last_outcome_at" timestamp with time zone;

UPDATE "production_run_members"
SET
  "successful_quantity" = GREATEST("completed_quantity", "successful_quantity"),
  "remaining_quantity" = GREATEST("allocated_quantity" - GREATEST("completed_quantity", "successful_quantity") - "damaged_quantity", 0),
  "outcome_status" = CASE
    WHEN GREATEST("completed_quantity", "successful_quantity") >= "allocated_quantity" THEN 'completed'
    WHEN GREATEST("completed_quantity", "successful_quantity") > 0 OR "damaged_quantity" > 0 THEN 'partially_completed'
    ELSE "outcome_status"
  END
WHERE "remaining_quantity" IS NULL;

ALTER TABLE "production_run_members"
  ALTER COLUMN "remaining_quantity" SET NOT NULL,
  ALTER COLUMN "remaining_quantity" SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS "production_run_members_org_outcome_idx"
  ON "production_run_members" ("organization_id", "outcome_status");
