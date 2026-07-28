-- Same-order physical production runs retain the existing production-job and
-- line-item records as the canonical quantity and fulfillment aggregates.
CREATE TABLE "production_runs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "order_id" varchar NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "run_number" integer NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'draft',
  "station_key" varchar(40) NOT NULL,
  "material_id" varchar REFERENCES "materials"("id") ON DELETE SET NULL,
  "material_snapshot" jsonb,
  "sheet_width" numeric(10,2), "sheet_height" numeric(10,2),
  "planned_sheet_count" integer, "nominal_pieces_per_sheet" integer,
  "notes" text, "compatibility_override_reason" text,
  "created_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "released_at" timestamp with time zone, "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone, "canceled_at" timestamp with time zone,
  "canceled_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "cancel_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE("organization_id", "run_number")
);
CREATE INDEX "production_runs_org_order_status_idx" ON "production_runs" ("organization_id", "order_id", "status");
CREATE TABLE "production_run_members" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "production_run_id" varchar NOT NULL REFERENCES "production_runs"("id") ON DELETE CASCADE,
  "production_job_id" varchar NOT NULL REFERENCES "production_jobs"("id") ON DELETE RESTRICT,
  "order_line_item_id" varchar NOT NULL REFERENCES "order_line_items"("id") ON DELETE RESTRICT,
  "allocated_quantity" integer NOT NULL CHECK ("allocated_quantity" > 0),
  "completed_quantity" integer NOT NULL DEFAULT 0 CHECK ("completed_quantity" >= 0),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE("production_run_id", "production_job_id")
);
CREATE INDEX "production_run_members_org_job_idx" ON "production_run_members" ("organization_id", "production_job_id");
CREATE INDEX "production_run_members_line_item_idx" ON "production_run_members" ("order_line_item_id");
