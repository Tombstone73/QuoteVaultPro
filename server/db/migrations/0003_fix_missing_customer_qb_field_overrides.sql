CREATE TYPE "public"."import_apply_mode" AS ENUM('MERGE_RESPECT_OVERRIDES', 'MERGE_AND_SET_OVERRIDES');--> statement-breakpoint
CREATE TYPE "public"."import_job_status" AS ENUM('validated', 'applied', 'error');--> statement-breakpoint
CREATE TYPE "public"."import_resource" AS ENUM('customers', 'materials', 'products');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('valid', 'invalid', 'applied', 'skipped', 'error');--> statement-breakpoint
CREATE TABLE "import_job_rows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"job_id" varchar NOT NULL,
	"row_number" integer NOT NULL,
	"status" "import_row_status" DEFAULT 'valid' NOT NULL,
	"raw_json" jsonb,
	"normalized_json" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"resource" "import_resource" NOT NULL,
	"status" "import_job_status" DEFAULT 'validated' NOT NULL,
	"apply_mode" "import_apply_mode" DEFAULT 'MERGE_RESPECT_OVERRIDES' NOT NULL,
	"source_filename" varchar(255),
	"created_by_user_id" varchar,
	"summary_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "qb_field_overrides" jsonb;--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_job_rows_organization_id_idx" ON "import_job_rows" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_job_rows_job_id_idx" ON "import_job_rows" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "import_job_rows_status_idx" ON "import_job_rows" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_jobs_organization_id_idx" ON "import_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "import_jobs_resource_status_idx" ON "import_jobs" USING btree ("resource","status");--> statement-breakpoint
CREATE INDEX "import_jobs_created_at_idx" ON "import_jobs" USING btree ("created_at");